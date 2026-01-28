/**
 * Token Allocation Engine - Core business logic
 * Handles token allocation with priority-based eviction and cascading reallocation
 */

import { Token, TimeSlot } from '@models/types';
import { AllocationResult } from '@models/AllocationResult';
import { validateAllocationRules, RejectionReason } from './AllocationRules';
import { getPriorityScore, compareTokenPriority } from '@utils/PriorityResolver';
import { storage } from '@utils/storage';
import { v4 as uuidv4 } from 'uuid';
import { TokenSource } from '@models/enums';

/**
 * Reallocation event for logging and tracking
 */
export interface ReallocationEvent {
  tokenId: string;
  fromSlotId: string;
  toSlotId: string;
  timestamp: Date;
  success: boolean;
  reason?: string;
}

/**
 * Token event types
 */
export enum TokenEventType {
  ALLOCATED = 'ALLOCATED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  REALLOCATED = 'REALLOCATED',
  PROMOTED = 'PROMOTED',
}

/**
 * Token event for audit trail
 */
export interface TokenEvent {
  eventType: TokenEventType;
  tokenId: string;
  slotId: string;
  timestamp: Date;
  details?: any;
  promotedTokenId?: string;
  rebalanceCount?: number;
}

export class TokenAllocationEngine {
  private name: string;
  private maxEvictionRetries: number = 3;
  private reallocationLog: ReallocationEvent[] = [];
  private eventLog: TokenEvent[] = [];
  private enableLogging: boolean = true;
  private currentTime?: Date; // Optional simulation time for testing

  constructor(name: string = 'TokenAllocationEngine', enableLogging: boolean = true, currentTime?: Date) {
    this.name = name;
    this.enableLogging = enableLogging;
    this.currentTime = currentTime;
  }

  /**
   * Set the current time for time-based validations (useful for simulations)
   */
  public setCurrentTime(time: Date): void {
    this.currentTime = time;
  }

  /**
   * Initialize the engine
   */
  public initialize(): void {
    this.log(`${this.name} initialized`);
  }

  /**
   * Log message with timestamp
   * @private
   */
  private log(message: string, data?: any): void {
    if (!this.enableLogging) return;

    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[${timestamp}] ${this.name}: ${message}`, data);
    } else {
      console.log(`[${timestamp}] ${this.name}: ${message}`);
    }
  }

  /**
   * Allocate a token to a time slot
   *
   * Algorithm:
   * 1. Validate allocation rules
   * 2. If slot has capacity, allocate directly
   * 3. If slot is full, attempt cascading reallocation
   * 4. If reallocation succeeds, allocate new token
   * 5. Hard capacity is NEVER violated
   *
   * @param token - The token to allocate
   * @param slot - The target time slot
   * @param availableSlots - List of all available slots for the doctor (for reallocation)
   * @returns AllocationResult with success/failure status
   */
  public allocateToken(token: Token, slot: TimeSlot, availableSlots?: TimeSlot[]): AllocationResult {
    try {
      this.log(`Attempting allocation for patient ${token.patientId} to slot ${slot.id}`);

      // Get all existing tokens for this slot
      const slotTokens = this.getTokensForSlot(slot.id);

      // Validate allocation rules
      const validationResult = validateAllocationRules({
        slot,
        patientId: token.patientId,
        doctorId: token.doctorId,
        existingTokens: slotTokens,
        currentTime: this.currentTime,
      });

      // If validation fails (excluding capacity), reject
      if (
        !validationResult.isAllowed &&
        validationResult.rejectionReason !== RejectionReason.SLOT_AT_CAPACITY
      ) {
        this.log(`Allocation rejected: ${validationResult.rejectionReason}`, {
          details: validationResult.details,
        });
        return {
          success: false,
          message: validationResult.details || 'Allocation validation failed',
          code: validationResult.rejectionReason || 'VALIDATION_FAILED',
        };
      }

      // Check if slot has capacity
      if (!this.isSlotFull(slot)) {
        this.log(`Direct allocation to slot ${slot.id} (available capacity)`);
        return this.performAllocation(token, slot);
      }

      // Slot is full, attempt cascading reallocation
      this.log(`Slot ${slot.id} is at capacity. Attempting cascading reallocation.`, {
        currentCapacity: slot.currentTokenCount,
        maxCapacity: slot.maxCapacity,
      });

      return this.allocateWithReallocation(token, slot, slotTokens, availableSlots);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Allocation error: ${errorMsg}`);
      return {
        success: false,
        message: `Allocation error: ${errorMsg}`,
        code: 'ALLOCATION_ERROR',
      };
    }
  }

  /**
   * Attempt allocation by cascading reallocation of lower-priority tokens
   *
   * @private
   */
  private allocateWithReallocation(
    token: Token,
    slot: TimeSlot,
    slotTokens: Token[],
    availableSlots?: TimeSlot[],
  ): AllocationResult {
    // Find the lowest priority token that can be evicted
    const evictableToken = this.findEvictableToken(token, slotTokens);

    if (!evictableToken) {
      this.log(`No lower-priority token found for eviction in slot ${slot.id}`);
      return {
        success: false,
        message: `Slot is at capacity and no lower-priority tokens available for reallocation`,
        code: 'SLOT_FULL_NO_REALLOCATION',
      };
    }

    this.log(`Found evictable token: ${evictableToken.id}`, {
      evictableScore: getPriorityScore(evictableToken.source),
      incomingScore: getPriorityScore(token.source),
    });

    // Attempt cascading reallocation
    if (availableSlots && availableSlots.length > 0) {
      const reallocResult = this.attemptCascadingReallocation(evictableToken, slot, availableSlots);

      if (reallocResult.success) {
        this.log(`Cascading reallocation successful for token ${evictableToken.id}`);

        // Decrement slot's current token count after reallocation
        slot.currentTokenCount = Math.max(0, slot.currentTokenCount - 1);

        // Now allocate the new token
        const allocationResult = this.performAllocation(token, slot);

        return {
          ...allocationResult,
          evictedTokenId: evictableToken.id,
          evictionReason: `Token reallocated to different slot. Lower priority (score: ${getPriorityScore(evictableToken.source)}) vs incoming (score: ${getPriorityScore(token.source)})`,
        };
      }
    }

    this.log(
      `Cascading reallocation failed or no available slots. Direct eviction will occur.`,
    );

    // Fallback to direct eviction (no reallocation)
    this.evictToken(evictableToken);
    slot.currentTokenCount = Math.max(0, slot.currentTokenCount - 1);

    const allocationResult = this.performAllocation(token, slot);

    return {
      ...allocationResult,
      evictedTokenId: evictableToken.id,
      evictionReason: `Lower priority token evicted (no available slots for reallocation)`,
    };
  }

  /**
   * Attempt to cascade reallocate a token through available slots
   * Uses BFS-like approach to find first available slot
   *
   * @private
   */
  private attemptCascadingReallocation(
    tokenToReallocate: Token,
    fromSlot: TimeSlot,
    availableSlots: TimeSlot[],
  ): { success: boolean; toSlotId?: string } {
    // Sort available slots by time (deterministic ordering)
    const sortedSlots = availableSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    this.log(`Attempting to reallocate token ${tokenToReallocate.id} to available slots`, {
      availableSlotCount: sortedSlots.length,
    });

    // Try each slot in deterministic order
    for (const targetSlot of sortedSlots) {
      // Skip the slot we're trying to free from
      if (targetSlot.id === fromSlot.id) {
        continue;
      }

      // Check if target slot has capacity
      if (!this.isSlotFull(targetSlot)) {
        this.log(`Found available slot for reallocation: ${targetSlot.id}`);

        // Reallocate token
        return this.reallocateToken(tokenToReallocate, fromSlot, targetSlot);
      }

      // Target slot is full, try to cascade reallocate from it
      this.log(`Target slot ${targetSlot.id} is full. Attempting cascade.`);

      const targetSlotTokens = this.getTokensForSlot(targetSlot.id);
      const cascadeEvictableToken = this.findEvictableToken(tokenToReallocate, targetSlotTokens);

      if (cascadeEvictableToken) {
        this.log(`Found cascadeable token in slot ${targetSlot.id}: ${cascadeEvictableToken.id}`);

        // Recursively attempt cascading for the cascade-evictable token
        const cascadeResult = this.attemptCascadingReallocation(
          cascadeEvictableToken,
          targetSlot,
          availableSlots,
        );

        if (cascadeResult.success) {
          // Now we have space, reallocate our original token
          this.log(`Cascade successful. Reallocating original token: ${tokenToReallocate.id}`);
          return this.reallocateToken(tokenToReallocate, fromSlot, targetSlot);
        }
      }
    }

    this.log(
      `Cascading reallocation failed: no suitable slot found for token ${tokenToReallocate.id}`,
    );
    return { success: false };
  }

  /**
   * Reallocate a token from one slot to another
   * Updates token's timeSlotId and slot counters
   *
   * @private
   */
  private reallocateToken(
    token: Token,
    fromSlot: TimeSlot,
    toSlot: TimeSlot,
  ): { success: boolean; toSlotId?: string } {
    try {
      const storageInstance = storage.getStorage();

      // Update token's slot assignment
      const reallocatedToken: Token = {
        ...token,
        timeSlotId: toSlot.id,
        updatedAt: new Date(),
      };

      storageInstance.tokens.set(token.id, reallocatedToken);

      // Update slot counters
      fromSlot.currentTokenCount = Math.max(0, fromSlot.currentTokenCount - 1);
      toSlot.currentTokenCount += 1;

      // Create REALLOCATED event
      const reallocatedEvent: TokenEvent = {
        eventType: TokenEventType.REALLOCATED,
        tokenId: token.id,
        slotId: toSlot.id,
        timestamp: new Date(),
        details: {
          fromSlotId: fromSlot.id,
          toSlotId: toSlot.id,
        },
      };
      this.eventLog.push(reallocatedEvent);

      // 
      // Log reallocation event
      const event: ReallocationEvent = {
        tokenId: token.id,
        fromSlotId: fromSlot.id,
        toSlotId: toSlot.id,
        timestamp: new Date(),
        success: true,
      };
      this.reallocationLog.push(event);

      this.log(`Token reallocated: ${token.id}`, {
        fromSlot: fromSlot.id,
        toSlot: toSlot.id,
      });

      return { success: true, toSlotId: toSlot.id };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Reallocation failed for token ${token.id}: ${errorMsg}`);

      const event: ReallocationEvent = {
        tokenId: token.id,
        fromSlotId: fromSlot.id,
        toSlotId: toSlot.id,
        timestamp: new Date(),
        success: false,
        reason: errorMsg,
      };
      this.reallocationLog.push(event);

      return { success: false };
    }
  }

  /**
   * Perform direct token allocation
   * Assumes all validations have passed and capacity is available
   *
   * @private
   */
  private performAllocation(token: Token, slot: TimeSlot): AllocationResult {
    const allocatedToken: Token = {
      ...token,
      id: token.id || uuidv4(),
      priorityScore: getPriorityScore(token.source),
      createdAt: token.createdAt || new Date(),
      updatedAt: new Date(),
    };

    // Store token
    const storageInstance = storage.getStorage();
    storageInstance.tokens.set(allocatedToken.id, allocatedToken);

    // Create ALLOCATED event
    const allocatedEvent: TokenEvent = {
      eventType: TokenEventType.ALLOCATED,
      tokenId: allocatedToken.id,
      slotId: slot.id,
      timestamp: new Date(),
      details: {
        patientId: allocatedToken.patientId,
        tokenNumber: allocatedToken.tokenNumber,
        priorityScore: allocatedToken.priorityScore,
      },
    };
    this.eventLog.push(allocatedEvent);

    // 
    // Increment slot's current token count
    slot.currentTokenCount += 1;

    this.log(`Token allocated successfully: ${allocatedToken.id}`, {
      tokenNumber: allocatedToken.tokenNumber,
      slotId: slot.id,
    });

    return {
      success: true,
      tokenId: allocatedToken.id,
      message: `Token allocated successfully to slot ${slot.id}`,
      code: 'ALLOCATED',
    };
  }

  /**
   * Find a token eligible for eviction
   * Returns the lowest priority token with a lower score than the incoming token
   *
   * @private
   */
  private findEvictableToken(incomingToken: Token, slotTokens: Token[]): Token | null {
    const incomingScore = getPriorityScore(incomingToken.source);

    // Filter tokens with lower priority
    const lowerPriorityTokens = slotTokens.filter(
      (t) => getPriorityScore(t.source) < incomingScore,
    );

    if (lowerPriorityTokens.length === 0) {
      return null;
    }

    // Sort by priority (ascending) then by creation time (descending)
    // This ensures we evict the lowest priority, and among those, the oldest one
    lowerPriorityTokens.sort((a, b) => {
      const scoreDiff = getPriorityScore(a.source) - getPriorityScore(b.source);
      if (scoreDiff !== 0) return scoreDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return lowerPriorityTokens[0];
  }

  /**
   * Evict a token from a slot
   * Marks token as CANCELLED and removes from active allocation
   *
   * @private
   */
  private evictToken(token: Token): void {
    const storageInstance = storage.getStorage();
    const evictedToken: Token = {
      ...token,
      status: 'CANCELLED' as any,
      cancelledAt: new Date(),
      cancelReason: 'EVICTED_FOR_HIGHER_PRIORITY',
      updatedAt: new Date(),
    };

    storageInstance.tokens.set(evictedToken.id, evictedToken);
    this.log(`Token evicted: ${token.id}`);
  }

  /**
   * Check if a slot is at its hard capacity limit
   *
   * @private
   */
  private isSlotFull(slot: TimeSlot): boolean {
    return slot.currentTokenCount >= slot.maxCapacity;
  }

  /**
   * Get all tokens allocated to a specific slot
   *
   * @private
   */
  private getTokensForSlot(slotId: string): Token[] {
    const storageInstance = storage.getStorage();
    const tokens: Token[] = [];

    storageInstance.tokens.forEach((token) => {
      if (token.timeSlotId === slotId) {
        tokens.push(token);
      }
    });

    return tokens;
  }

  /**
   * Deallocate a token from a slot
   * Used for cancellations
   *
   * @public
   */
  public deallocateToken(tokenId: string): AllocationResult {
    const storageInstance = storage.getStorage();
    const token = storageInstance.tokens.get(tokenId);

    if (!token) {
      this.log(`Token not found for deallocation: ${tokenId}`);
      return {
        success: false,
        message: `Token not found: ${tokenId}`,
        code: 'TOKEN_NOT_FOUND',
      };
    }

    // Mark as cancelled
    const cancelledToken: Token = {
      ...token,
      status: 'CANCELLED' as any,
      cancelledAt: new Date(),
      cancelReason: 'MANUAL_CANCELLATION',
      updatedAt: new Date(),
    };

    storageInstance.tokens.set(tokenId, cancelledToken);

    this.log(`Token deallocated: ${tokenId}`);

    return {
      success: true,
      tokenId,
      message: `Token deallocated successfully`,
      code: 'DEALLOCATED',
    };
  }

  /**
   * Get allocation statistics for a slot
   *
   * @public
   */
  public getSlotStats(slotId: string): {
    totalAllocated: number;
    activeTokens: number;
    cancelledTokens: number;
    noShowTokens: number;
  } {
    const slotTokens = this.getTokensForSlot(slotId);

    return {
      totalAllocated: slotTokens.length,
      activeTokens: slotTokens.filter((t) => t.status === 'ACTIVE').length,
      cancelledTokens: slotTokens.filter((t) => t.status === 'CANCELLED').length,
      noShowTokens: slotTokens.filter((t) => t.status === 'NO_SHOW').length,
    };
  }

  /**
   * Get reallocation log
   *
   * @public
   */
  public getReallocationLog(): ReallocationEvent[] {
    return [...this.reallocationLog];
  }

  /**
   * Clear reallocation log
   *
   * @public
   */
  public clearReallocationLog(): void {
    this.reallocationLog = [];
    this.log(`Reallocation log cleared`);
  }

  /**no-show event
   * Event-based approach: record event, update state, trigger promotion/rebalancing
   *
   * Algorithm:
   * 1. Validate token exists and is eligible for no-show
   * 2. Create NO_SHOW event
   * 3. Mark token as NO_SHOW
   * 4. Free slot capacity
   * 5. Promote waiting token or rebalance
   *
   * @param tokenId - ID of the token to mark as no-show
   * @param availableSlots - Optional list of slots for rebalancing
   * @returns AllocationResult with no-show handling details
   */
  public handleNoShow(tokenId: string, availableSlots?: TimeSlot[]): AllocationResult {
    try {
      const storageInstance = storage.getStorage();
      const token = storageInstance.tokens.get(tokenId);

      if (!token) {
        this.log(`No-show handling failed: Token not found ${tokenId}`);
        return {
          success: false,
          message: `Token not found: ${tokenId}`,
          code: 'TOKEN_NOT_FOUND',
        };
      }

      // Validate token is eligible for no-show marking
      if (token.status === 'NO_SHOW') {
        this.log(`Token already marked as no-show: ${tokenId}`);
        return {
          success: false,
          message: `Token is already marked as no-show`,
          code: 'ALREADY_NO_SHOW',
        };
      }

      const slotId = token.timeSlotId;

      if (token.status === 'CANCELLED') {
        return {
          success: false,
          message: `Cannot mark cancelled token as no-show`,
          code: 'TOKEN_CANCELLED',
        };
      }

      // Create NO_SHOW event
      const noShowEvent: TokenEvent = {
        eventType: TokenEventType.NO_SHOW,
        tokenId,
        slotId,
        timestamp: new Date(),
        details: {
          patientId: token.patientId,
          tokenNumber: token.tokenNumber,
          originalStatus: token.status,
        },
      };

      this.eventLog.push(noShowEvent);
      this.log(`NO_SHOW event created for token ${tokenId}`);

      // Mark token as NO_SHOW (immutable update)
      const noShowToken: Token = {
        ...token,
        status: 'NO_SHOW' as any,
        updatedAt: new Date(),
      };

      storageInstance.tokens.set(tokenId, noShowToken);

      // Find the slot and decrement capacity
      const slot = this.findSlotById(slotId, availableSlots);
      if (slot) {
        slot.currentTokenCount = Math.max(0, slot.currentTokenCount - 1);
        this.log(`Slot ${slotId} capacity freed: ${slot.currentTokenCount}/${slot.maxCapacity}`);
      }

      // Try to promote a waiting token
      const promotedToken = this.promoteFromWaitingQueue(slotId, slot);

      if (promotedToken) {
        // Create PROMOTED event
        const promotedEvent: TokenEvent = {
          eventType: TokenEventType.PROMOTED,
          tokenId: promotedToken.id,
          slotId,
          timestamp: new Date(),
          details: {
            reason: 'NO_SHOW_VACANCY',
            originalNoShowTokenId: tokenId,
          },
        };
        this.eventLog.push(promotedEvent);

        this.log(`Promoted waiting token ${promotedToken.id} after no-show`);
        return {
          success: true,
          tokenId,
          message: `Token marked as no-show and waiting token ${promotedToken.tokenNumber} promoted`,
          code: 'NO_SHOW_WITH_PROMOTION',
        };
      }

      // No waiting tokens, attempt rebalancing if slots provided
      if (availableSlots && availableSlots.length > 0 && slot) {
        const rebalanceResult = this.attemptSlotRebalancing(slot, availableSlots);

        if (rebalanceResult.rebalanced) {
          noShowEvent.rebalanceCount = rebalanceResult.movedCount;
          
          this.log(`Slot rebalancing completed after no-show`);
          return {
            success: true,
            tokenId,
            message: `Token marked as no-show and slot rebalanced. ${rebalanceResult.movedCount} token(s) redistributed.`,
            code: 'NO_SHOW_WITH_REBALANCE',
          };
        }
      }

      this.log(`Token marked as no-show: ${tokenId} (no promotion or rebalancing needed)`);
      return {
        success: true,
        tokenId,
        message: `Token marked as no-show`,
        code: 'NO_SHOW',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`No-show handling error for token ${tokenId}: ${errorMsg}`);
      return {
        success: false,
        message: `No-show handling error: ${errorMsg}`,
        code: 'NO_SHOW_ERROR',
      };
    }
  }

  /**
   * Batch no-show detection and handling
   * Process multiple tokens at once (e.g., end-of-day processing)
   *
   * @param tokenIds - Array of token IDs to mark as no-show
   * @param availableSlots - Optional list of slots for rebalancing
   * @returns Summary of batch processing
   */
  public handleBatchNoShow(
    tokenIds: string[],
    availableSlots?: TimeSlot[],
  ): {
    success: boolean;
    processed: number;
    promoted: number;
    rebalanced: number;
    failed: string[];
  } {
    this.log(`Processing batch no-show for ${tokenIds.length} tokens`);

    let processed = 0;
    let promoted = 0;
    let rebalanced = 0;
    const failed: string[] = [];

    for (const tokenId of tokenIds) {
      const result = this.handleNoShow(tokenId, availableSlots);

      if (result.success) {
        processed++;
        if (result.code === 'NO_SHOW_WITH_PROMOTION') {
          promoted++;
        } else if (result.code === 'NO_SHOW_WITH_REBALANCE') {
          rebalanced++;
        }
      } else {
        failed.push(tokenId);
      }
    }

    this.log(`Batch no-show completed`, {
      total: tokenIds.length,
      processed,
      promoted,
      rebalanced,
      failed: failed.length,
    });

    return {
      success: failed.length === 0,
      processed,
      promoted,
      rebalanced,
      failed,
    };
  }

  /**
   * Get event log
   * Returns chronological list of all token events
   *
   * @public
   */
  public getEventLog(filterByType?: TokenEventType): TokenEvent[] {
    if (filterByType) {
      return this.eventLog.filter((e) => e.eventType === filterByType);
    }
    return [...this.eventLog];
  }

  /**
   * Get events for a specific token
   *
   * @public
   */
  public getTokenEvents(tokenId: string): TokenEvent[] {
    return this.eventLog.filter((e) => e.tokenId === tokenId);
  }

  /**
   * Clear event log
   *
   * @public
   */
  public clearEventLog(): void {
    this.eventLog = [];
    this.log(`Event log cleared`);
  }

  /**
   * Insert emergency token with forced allocation
   * Emergency tokens bypass normal allocation rules and can preempt any lower-priority token
   *
   * Rules:
   * 1. Validate token is emergency source
   * 2. Attempt immediate allocation to preferred slot
   * 3. If full, force eviction of lowest-priority token
   * 4. Trigger cascading reallocation for evicted token
   * 5. If system cannot accommodate, log critical failure
   *
   * @param token - The emergency token to insert
   * @param preferredSlot - Preferred time slot for emergency
   * @param availableSlots - All available slots for reallocation
   * @returns AllocationResult with emergency allocation status
   */
  public insertEmergencyToken(
    token: Token,
    preferredSlot: TimeSlot,
    availableSlots?: TimeSlot[],
  ): AllocationResult {
    try {
      this.log(`EMERGENCY TOKEN INSERTION: ${token.id} for patient ${token.patientId}`, {
        preferredSlot: preferredSlot.id,
        source: token.source,
      });

      // Validate this is actually an emergency token
      if (token.source !== TokenSource.EMERGENCY) {
        this.log(`CRITICAL: Non-emergency token attempted emergency insertion`, {
          tokenId: token.id,
          actualSource: token.source,
        });
        return {
          success: false,
          message: `Only emergency tokens can use emergency insertion. Token source: ${token.source}`,
          code: 'NOT_EMERGENCY_TOKEN',
        };
      }

      // Get emergency priority score (should be highest)
      const emergencyScore = getPriorityScore(TokenSource.EMERGENCY);
      this.log(`Emergency priority score: ${emergencyScore}`);

      // Basic validation (excluding capacity)
      const slotTokens = this.getTokensForSlot(preferredSlot.id);
      const validationResult = validateAllocationRules({
        slot: preferredSlot,
        patientId: token.patientId,
        doctorId: token.doctorId,
        existingTokens: slotTokens.filter(t => t.id !== token.id),
        isReallocation: false,
        currentTime: this.currentTime,
      });

      // If validation fails (non-capacity reasons), still try to force allocation
      if (
        !validationResult.isAllowed &&
        validationResult.rejectionReason !== RejectionReason.SLOT_AT_CAPACITY
      ) {
        this.log(`EMERGENCY: Validation failed but attempting forced allocation`, {
          reason: validationResult.rejectionReason,
        });
      }

      // Check if preferred slot has capacity
      if (!this.isSlotFull(preferredSlot)) {
        this.log(`EMERGENCY: Direct allocation to preferred slot ${preferredSlot.id}`);
        const result = this.performAllocation(token, preferredSlot);
        
        const emergencyEvent: TokenEvent = {
          eventType: TokenEventType.ALLOCATED,
          tokenId: token.id,
          slotId: preferredSlot.id,
          timestamp: new Date(),
          details: {
            critical: true,
            emergencyDirect: true,
            patientId: token.patientId,
          },
        };
        this.eventLog.push(emergencyEvent);

        return {
          ...result,
          message: `EMERGENCY token allocated directly to preferred slot`,
          code: 'EMERGENCY_ALLOCATED',
        };
      }

      // Preferred slot is full - force preemption
      this.log(`EMERGENCY: Preferred slot full. Initiating forced preemption.`, {
        currentCapacity: preferredSlot.currentTokenCount,
        maxCapacity: preferredSlot.maxCapacity,
      });

      return this.forceEmergencyPreemption(token, preferredSlot, slotTokens, availableSlots);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`CRITICAL FAILURE: Emergency token insertion failed`, {
        error: errorMsg,
        tokenId: token.id,
      });

      return {
        success: false,
        message: `CRITICAL: Emergency token insertion failed - ${errorMsg}`,
        code: 'EMERGENCY_CRITICAL_FAILURE',
      };
    }
  }

  /**
   * Force preemption for emergency token
   */
  private forceEmergencyPreemption(
    emergencyToken: Token,
    preferredSlot: TimeSlot,
    slotTokens: Token[],
    availableSlots?: TimeSlot[],
  ): AllocationResult {
    const emergencyScore = getPriorityScore(TokenSource.EMERGENCY);

    const sortedTokens = [...slotTokens].sort(
      (a, b) => getPriorityScore(a.source) - getPriorityScore(b.source),
    );

    const lowestPriorityToken = sortedTokens[0];

    if (!lowestPriorityToken) {
      this.log(`CRITICAL: No tokens found in full slot for preemption`, {
        slotId: preferredSlot.id,
      });
      return {
        success: false,
        message: `CRITICAL: Slot is full but contains no tokens (data inconsistency)`,
        code: 'EMERGENCY_DATA_INCONSISTENCY',
      };
    }

    const lowestScore = getPriorityScore(lowestPriorityToken.source);

    this.log(`EMERGENCY: Found preemption candidate`, {
      candidateToken: lowestPriorityToken.id,
      candidateScore: lowestScore,
      emergencyScore,
    });

    // Check if all tokens are emergency
    if (lowestScore >= emergencyScore) {
      this.log(`CRITICAL: All tokens in slot are emergency priority. Cannot preempt.`, {
        slotId: preferredSlot.id,
        activeEmergencies: slotTokens.filter(t => t.source === TokenSource.EMERGENCY).length,
      });

      if (availableSlots) {
        const alternativeResult = this.findAlternativeSlotForEmergency(
          emergencyToken,
          availableSlots,
        );
        if (alternativeResult.success) {
          return alternativeResult;
        }
      }

      return {
        success: false,
        message: `CRITICAL: Cannot accommodate emergency token - all slots at emergency capacity`,
        code: 'EMERGENCY_SYSTEM_SATURATED',
      };
    }

    // Attempt cascading reallocation
    if (availableSlots && availableSlots.length > 0) {
      this.log(`EMERGENCY: Attempting forced reallocation of preempted token ${lowestPriorityToken.id}`);
      
      const reallocationResult = this.attemptCascadingReallocation(
        lowestPriorityToken,
        preferredSlot,
        availableSlots,
      );

      if (reallocationResult.success) {
        preferredSlot.currentTokenCount = Math.max(0, preferredSlot.currentTokenCount - 1);
        const allocResult = this.performAllocation(emergencyToken, preferredSlot);

        this.log(`EMERGENCY: Successfully preempted and reallocated`, {
          preemptedToken: lowestPriorityToken.id,
          reallocatedTo: reallocationResult.toSlotId,
          emergencyToken: emergencyToken.id,
        });

        return {
          ...allocResult,
          evictedTokenId: lowestPriorityToken.id,
          evictionReason: `Preempted for emergency token. Reallocated to slot ${reallocationResult.toSlotId}`,
          message: `EMERGENCY token allocated. Lower-priority token reallocated.`,
          code: 'EMERGENCY_PREEMPTED_REALLOCATED',
        };
      }
    }

    // Forced eviction
    this.log(`EMERGENCY: Forced eviction of token ${lowestPriorityToken.id} (no reallocation possible)`);

    this.evictToken(lowestPriorityToken);
    preferredSlot.currentTokenCount = Math.max(0, preferredSlot.currentTokenCount - 1);
    this.addToWaitingQueue(lowestPriorityToken, preferredSlot.id);

    const allocResult = this.performAllocation(emergencyToken, preferredSlot);

    this.log(`EMERGENCY: Token allocated after forced eviction`, {
      emergencyToken: emergencyToken.id,
      evictedToken: lowestPriorityToken.id,
      evictedAddedToQueue: true,
    });

    return {
      ...allocResult,
      evictedTokenId: lowestPriorityToken.id,
      evictionReason: `Forcefully evicted for emergency token. Added to waiting queue.`,
      message: `EMERGENCY token allocated. Lower-priority token evicted and queued.`,
      code: 'EMERGENCY_FORCED_EVICTION',
    };
  }

  /**
   * Find alternative slot for emergency token
   */
  private findAlternativeSlotForEmergency(
    emergencyToken: Token,
    availableSlots: TimeSlot[],
  ): AllocationResult {
    this.log(`EMERGENCY: Searching for alternative slot`);

    const sortedSlots = [...availableSlots].sort((a, b) => {
      const capacityDiff = (b.maxCapacity - b.currentTokenCount) - (a.maxCapacity - a.currentTokenCount);
      if (capacityDiff !== 0) return capacityDiff;
      return a.startTime.getTime() - b.startTime.getTime();
    });

    for (const alternativeSlot of sortedSlots) {
      if (!this.isSlotFull(alternativeSlot)) {
        this.log(`EMERGENCY: Found alternative slot with capacity`, {
          slotId: alternativeSlot.id,
          availableCapacity: alternativeSlot.maxCapacity - alternativeSlot.currentTokenCount,
        });

        const result = this.performAllocation(emergencyToken, alternativeSlot);
        return {
          ...result,
          message: `EMERGENCY token allocated to alternative slot ${alternativeSlot.id}`,
          code: 'EMERGENCY_ALTERNATIVE_SLOT',
        };
      }

      const slotTokens = this.getTokensForSlot(alternativeSlot.id);
      const preemptResult = this.forceEmergencyPreemption(
        emergencyToken,
        alternativeSlot,
        slotTokens,
        availableSlots,
      );

      if (preemptResult.success) {
        return preemptResult;
      }
    }

    this.log(`CRITICAL: No alternative slots available for emergency token`);
    return {
      success: false,
      message: `CRITICAL: No available slots for emergency token`,
      code: 'EMERGENCY_NO_ALTERNATIVE',
    };
  }

  /**
   * Handle
   * Handle token cancellation with promotion and rebalancing
   *
   * Algorithm:
   * 1. Mark token as cancelled
   * 2. Decrement slot capacity
   * 3. Promote highest-priority waiting token for that slot
   * 4. If no waiting tokens, attempt rebalancing across doctor's slots
   *
   * @param tokenId - ID of the token to cancel
   * @param availableSlots - Optional list of slots for rebalancing
   * @returns AllocationResult with cancellation details
   */
  public handleCancellation(tokenId: string, availableSlots?: TimeSlot[]): AllocationResult {
    try {
      const storageInstance = storage.getStorage();
      const token = storageInstance.tokens.get(tokenId);

      if (!token) {
        this.log(`Cancellation failed: Token not found ${tokenId}`);
        return {
          success: false,
          message: `Token not found: ${tokenId}`,
          code: 'TOKEN_NOT_FOUND',
        };
      }

      // Check if token is already cancelled
      if (token.status === 'CANCELLED') {
        this.log(`Token already cancelled: ${tokenId}`);
        return {
          success: false,
          message: `Token is already cancelled`,
          code: 'ALREADY_CANCELLED',
        };
      }

      const slotId = token.timeSlotId;
      this.log(`Processing cancellation for token ${tokenId} in slot ${slotId}`);

      // Mark token as cancelled
      const cancelledToken: Token = {
        ...token,
        status: 'CANCELLED' as any,
        cancelledAt: new Date(),
        cancelReason: 'MANUAL_CANCELLATION',
        updatedAt: new Date(),
      };

      storageInstance.tokens.set(tokenId, cancelledToken);

      // Find the slot and decrement capacity
      const slot = this.findSlotById(slotId, availableSlots);
      if (slot) {
        slot.currentTokenCount = Math.max(0, slot.currentTokenCount - 1);
        this.log(`Slot ${slotId} capacity decreased to ${slot.currentTokenCount}/${slot.maxCapacity}`);
      }

      // Try to promote a waiting token
      const promotedToken = this.promoteFromWaitingQueue(slotId, slot);

      if (promotedToken) {
        this.log(`Promoted waiting token ${promotedToken.id} to slot ${slotId}`);
        return {
          success: true,
          tokenId,
          message: `Token cancelled and waiting token ${promotedToken.tokenNumber} promoted`,
          code: 'CANCELLED_WITH_PROMOTION',
        };
      }

      // No waiting tokens, attempt rebalancing if slots provided
      if (availableSlots && availableSlots.length > 0 && slot) {
        const rebalanceResult = this.attemptSlotRebalancing(slot, availableSlots);
        
        if (rebalanceResult.rebalanced) {
          this.log(`Slot rebalancing completed after cancellation`);
          return {
            success: true,
            tokenId,
            message: `Token cancelled and slot rebalanced. ${rebalanceResult.movedCount} token(s) redistributed.`,
            code: 'CANCELLED_WITH_REBALANCE',
          };
        }
      }

      this.log(`Token cancelled successfully: ${tokenId} (no promotion or rebalancing needed)`);
      return {
        success: true,
        tokenId,
        message: `Token cancelled successfully`,
        code: 'CANCELLED',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Cancellation error for token ${tokenId}: ${errorMsg}`);
      return {
        success: false,
        message: `Cancellation error: ${errorMsg}`,
        code: 'CANCELLATION_ERROR',
      };
    }
  }

  /**
   * Promote highest-priority token from waiting queue
   * Removes token from queue and allocates it to the slot
   *
   * @private
   */
  private promoteFromWaitingQueue(slotId: string, slot?: TimeSlot): Token | null {
    const storageInstance = storage.getStorage();
    const waitingTokens = storageInstance.waitingQueue.get(slotId) || [];

    if (waitingTokens.length === 0) {
      this.log(`No waiting tokens in queue for slot ${slotId}`);
      return null;
    }

    // Sort waiting tokens by priority (descending), then by created time (ascending - FIFO)
    waitingTokens.sort((a, b) =>
      compareTokenPriority(a.source, a.createdAt, b.source, b.createdAt),
    );

    // Get highest priority waiting token
    const highestPriorityToken = waitingTokens[0];

    // Remove from waiting queue
    const updatedQueue = waitingTokens.slice(1);
    storageInstance.waitingQueue.set(slotId, updatedQueue);

    // Allocate the token
    if (slot) {
      const promotedToken: Token = {
        ...highestPriorityToken,
        status: 'ACTIVE' as any,
        updatedAt: new Date(),
      };

      storageInstance.tokens.set(promotedToken.id, promotedToken);
      slot.currentTokenCount += 1;

      this.log(`Promoted token ${promotedToken.id} from waiting queue`, {
        priorityScore: getPriorityScore(promotedToken.source),
        remainingInQueue: updatedQueue.length,
      });

      return promotedToken;
    }

    return null;
  }

  /**
   * Attempt to rebalance tokens across slots
   * Moves tokens from fuller slots to emptier slots for better distribution
   *
   * @private
   */
  private attemptSlotRebalancing(
    cancelledSlot: TimeSlot,
    availableSlots: TimeSlot[],
  ): { rebalanced: boolean; movedCount: number } {
    this.log(`Attempting slot rebalancing after cancellation in slot ${cancelledSlot.id}`);

    let movedCount = 0;

    // Find slots with low utilization (including the cancelled slot)
    const sortedSlots = [...availableSlots].sort(
      (a, b) => a.currentTokenCount - b.currentTokenCount,
    );

    // Try to move tokens from fuller slots to the cancelled slot (now with capacity)
    for (const fullSlot of sortedSlots) {
      if (fullSlot.id === cancelledSlot.id) continue;
      if (cancelledSlot.currentTokenCount >= cancelledSlot.maxCapacity) break;

      const fullSlotTokens = this.getTokensForSlot(fullSlot.id);

      // Sort by priority (ascending) to move lower-priority tokens
      const sortedTokens = fullSlotTokens.sort(
        (a, b) => getPriorityScore(a.source) - getPriorityScore(b.source),
      );

      for (const tokenToMove of sortedTokens) {
        if (cancelledSlot.currentTokenCount >= cancelledSlot.maxCapacity) break;

        // Check if we can move this token
        if (tokenToMove.status === 'ACTIVE') {
          const moveResult = this.reallocateToken(tokenToMove, fullSlot, cancelledSlot);

          if (moveResult.success) {
            movedCount++;
            this.log(`Rebalanced: moved token ${tokenToMove.id} from ${fullSlot.id} to ${cancelledSlot.id}`);
          }
        }
      }
    }

    return {
      rebalanced: movedCount > 0,
      movedCount,
    };
  }

  /**
   * Add token to waiting queue for a slot
   * Used when allocation fails due to capacity
   *
   * @public
   */
  public addToWaitingQueue(token: Token, slotId: string): void {
    const storageInstance = storage.getStorage();
    const waitingTokens = storageInstance.waitingQueue.get(slotId) || [];

    waitingTokens.push(token);
    storageInstance.waitingQueue.set(slotId, waitingTokens);

    this.log(`Token ${token.id} added to waiting queue for slot ${slotId}`, {
      queueLength: waitingTokens.length,
      priorityScore: getPriorityScore(token.source),
    });
  }

  /**
   * Get waiting queue for a slot
   *
   * @public
   */
  public getWaitingQueue(slotId: string): Token[] {
    const storageInstance = storage.getStorage();
    return storageInstance.waitingQueue.get(slotId) || [];
  }

  /**
   * Clear waiting queue for a slot
   *
   * @public
   */
  public clearWaitingQueue(slotId: string): void {
    const storageInstance = storage.getStorage();
    storageInstance.waitingQueue.delete(slotId);
    this.log(`Waiting queue cleared for slot ${slotId}`);
  }

  /**
   * Find a slot by ID from available slots
   *
   * @private
   */
  private findSlotById(slotId: string, availableSlots?: TimeSlot[]): TimeSlot | null {
    if (!availableSlots) return null;
    return availableSlots.find((s) => s.id === slotId) || null;
  }
}
