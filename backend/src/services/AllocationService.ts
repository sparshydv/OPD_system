/**
 * Token Service - Business logic orchestration layer
 * Coordinates token creation, validation, and allocation
 * Framework-agnostic - no HTTP details
 */
import { TokenAllocationEngine, TokenEventType } from '@engines/AllocationEngine';
import { Token, TimeSlot, Patient, Doctor } from '@models/types';
import { AllocationResult } from '@models/AllocationResult';
import { TokenSource, TokenStatus } from '@models/enums';
import { getPriorityScore } from '@utils/PriorityResolver';
import { storage } from '@utils/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Token creation request
 */
export interface CreateTokenRequest {
  patientId: string;
  doctorId: string;
  timeSlotId: string;
  source: TokenSource;
}

/**
 * Service response wrapper
 */
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: any;
}

/**
 * Token allocation response
 */
export interface TokenAllocationResponse {
  token: Token;
  allocation: AllocationResult;
  waitingQueuePosition?: number;
}

export class TokenService {
  private engine: TokenAllocationEngine;

  constructor(currentTime?: Date) {
    this.engine = new TokenAllocationEngine('TokenAllocationEngine', true, currentTime);
    this.engine.initialize();
  }

  /**
   * Update the simulation time for time-based validations
   */
  public setCurrentTime(time: Date): void {
    this.engine.setCurrentTime(time);
  }

  /**
   * Create and allocate a new token
   * 
   * @param request - Token creation request
   * @param availableSlots - Available slots for reallocation
   * @returns ServiceResponse with token allocation result
   */
  public async createToken(
    request: CreateTokenRequest,
    availableSlots?: TimeSlot[],
  ): Promise<ServiceResponse<TokenAllocationResponse>> {
    try {
      // Validate request
      const validationResult = this.validateTokenRequest(request);
      if (!validationResult.success) {
        return validationResult;
      }

      // Find the target slot
      const slot = this.findSlot(request.timeSlotId, availableSlots);
      if (!slot) {
        return {
          success: false,
          error: 'Time slot not found',
          code: 'SLOT_NOT_FOUND',
        };
      }

      // Validate patient and doctor exist
      const patientValidation = this.validatePatient(request.patientId);
      if (!patientValidation.success) {
        return patientValidation;
      }

      const doctorValidation = this.validateDoctor(request.doctorId);
      if (!doctorValidation.success) {
        return doctorValidation;
      }

      // Create token entity
      const token = this.buildToken(request);

      // Attempt allocation
      const allocationResult = this.engine.allocateToken(token, slot, availableSlots);

      if (allocationResult.success) {
        return {
          success: true,
          data: {
            token,
            allocation: allocationResult,
          },
          code: allocationResult.code,
        };
      }

      // Allocation failed - add to waiting queue if appropriate
      if (allocationResult.code === 'SLOT_FULL_NO_REALLOCATION') {
        this.engine.addToWaitingQueue(token, request.timeSlotId);
        const queuePosition = this.engine.getWaitingQueue(request.timeSlotId).length;

        return {
          success: false,
          error: 'Slot is full. Token added to waiting queue.',
          code: 'ADDED_TO_WAITING_QUEUE',
          details: {
            queuePosition,
            token,
          },
        };
      }

      return {
        success: false,
        error: allocationResult.message,
        code: allocationResult.code,
      };
    } catch (error) {
      return {
        success: false,
        error: `Token creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Create and insert emergency token with forced allocation
   * 
   * @param request - Token creation request (must be emergency source)
   * @param preferredSlotId - Preferred time slot
   * @param availableSlots - All available slots
   * @returns ServiceResponse with emergency allocation result
   */
  public async createEmergencyToken(
    request: CreateTokenRequest,
    preferredSlotId: string,
    availableSlots?: TimeSlot[],
  ): Promise<ServiceResponse<TokenAllocationResponse>> {
    try {
      // Validate emergency source
      if (request.source !== TokenSource.EMERGENCY) {
        return {
          success: false,
          error: 'Only emergency tokens can use emergency insertion',
          code: 'NOT_EMERGENCY_TOKEN',
        };
      }

      const validationResult = this.validateTokenRequest(request);
      if (!validationResult.success) {
        return validationResult;
      }

      const preferredSlot = this.findSlot(preferredSlotId, availableSlots);
      if (!preferredSlot) {
        return {
          success: false,
          error: 'Preferred time slot not found',
          code: 'SLOT_NOT_FOUND',
        };
      }

      const token = this.buildToken(request);

      const allocationResult = this.engine.insertEmergencyToken(
        token,
        preferredSlot,
        availableSlots,
      );

      return {
        success: allocationResult.success,
        data: allocationResult.success
          ? {
              token,
              allocation: allocationResult,
            }
          : undefined,
        error: allocationResult.success ? undefined : allocationResult.message,
        code: allocationResult.code,
      };
    } catch (error) {
      return {
        success: false,
        error: `Emergency token creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Cancel a token
   * 
   * @param tokenId - Token ID to cancel
   * @param availableSlots - Available slots for rebalancing
   * @returns ServiceResponse with cancellation result
   */
  public async cancelToken(
    tokenId: string,
    availableSlots?: TimeSlot[],
  ): Promise<ServiceResponse<AllocationResult>> {
    try {
      const result = this.engine.handleCancellation(tokenId, availableSlots);

      return {
        success: result.success,
        data: result.success ? result : undefined,
        error: result.success ? undefined : result.message,
        code: result.code,
      };
    } catch (error) {
      return {
        success: false,
        error: `Cancellation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Mark token as no-show
   * 
   * @param tokenId - Token ID
   * @param availableSlots - Available slots for rebalancing
   * @returns ServiceResponse with no-show result
   */
  public async markNoShow(
    tokenId: string,
    availableSlots?: TimeSlot[],
  ): Promise<ServiceResponse<AllocationResult>> {
    try {
      const result = this.engine.handleNoShow(tokenId, availableSlots);

      return {
        success: result.success,
        data: result.success ? result : undefined,
        error: result.success ? undefined : result.message,
        code: result.code,
      };
    } catch (error) {
      return {
        success: false,
        error: `No-show marking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Batch mark tokens as no-show
   * 
   * @param tokenIds - Array of token IDs
   * @param availableSlots - Available slots
   * @returns ServiceResponse with batch result
   */
  public async batchMarkNoShow(
    tokenIds: string[],
    availableSlots?: TimeSlot[],
  ): Promise<ServiceResponse<any>> {
    try {
      const result = this.engine.handleBatchNoShow(tokenIds, availableSlots);

      return {
        success: result.success,
        data: result,
        error: result.success ? undefined : `${result.failed.length} tokens failed`,
        code: result.success ? 'BATCH_NO_SHOW_SUCCESS' : 'BATCH_NO_SHOW_PARTIAL',
      };
    } catch (error) {
      return {
        success: false,
        error: `Batch no-show failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Get token by ID
   * 
   * @param tokenId - Token ID
   * @returns ServiceResponse with token data
   */
  public async getToken(tokenId: string): Promise<ServiceResponse<Token>> {
    try {
      const storageInstance = storage.getStorage();
      const token = storageInstance.tokens.get(tokenId);

      if (!token) {
        return {
          success: false,
          error: 'Token not found',
          code: 'TOKEN_NOT_FOUND',
        };
      }

      return {
        success: true,
        data: token,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Get tokens for a specific slot
   * 
   * @param slotId - Slot ID
   * @returns ServiceResponse with tokens array
   */
  public async getSlotTokens(slotId: string): Promise<ServiceResponse<Token[]>> {
    try {
      const storageInstance = storage.getStorage();
      const tokens: Token[] = [];

      storageInstance.tokens.forEach((token) => {
        if (token.timeSlotId === slotId) {
          tokens.push(token);
        }
      });

      return {
        success: true,
        data: tokens,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve slot tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Get waiting queue for a slot
   * 
   * @param slotId - Slot ID
   * @returns ServiceResponse with waiting queue
   */
  public async getWaitingQueue(slotId: string): Promise<ServiceResponse<Token[]>> {
    try {
      const queue = this.engine.getWaitingQueue(slotId);

      return {
        success: true,
        data: queue,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve waiting queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Get event log
   * 
   * @param filterByType - Optional event type filter
   * @returns ServiceResponse with events
   */
  public async getEventLog(filterByType?: TokenEventType): Promise<ServiceResponse<any[]>> {
    try {
      const events = this.engine.getEventLog(filterByType);

      return {
        success: true,
        data: events,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve event log: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Get statistics for a slot
   * 
   * @param slotId - Slot ID
   * @returns ServiceResponse with slot statistics
   */
  public async getSlotStatistics(slotId: string): Promise<ServiceResponse<any>> {
    try {
      const stats = this.engine.getSlotStats(slotId);
      const waitingQueue = this.engine.getWaitingQueue(slotId);

      return {
        success: true,
        data: {
          ...stats,
          waitingCount: waitingQueue.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve slot statistics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SERVICE_ERROR',
      };
    }
  }

  /**
   * Validate token creation request
   * 
   * @private
   */
  private validateTokenRequest(request: CreateTokenRequest): ServiceResponse {
    if (!request.patientId || request.patientId.trim() === '') {
      return {
        success: false,
        error: 'Patient ID is required',
        code: 'VALIDATION_ERROR',
      };
    }

    if (!request.doctorId || request.doctorId.trim() === '') {
      return {
        success: false,
        error: 'Doctor ID is required',
        code: 'VALIDATION_ERROR',
      };
    }

    if (!request.timeSlotId || request.timeSlotId.trim() === '') {
      return {
        success: false,
        error: 'Time slot ID is required',
        code: 'VALIDATION_ERROR',
      };
    }

    if (!Object.values(TokenSource).includes(request.source)) {
      return {
        success: false,
        error: 'Invalid token source',
        code: 'VALIDATION_ERROR',
      };
    }

    return { success: true };
  }

  /**
   * Validate patient exists
   * 
   * @private
   */
  private validatePatient(patientId: string): ServiceResponse {
    const storageInstance = storage.getStorage();
    const patient = storageInstance.patients.get(patientId);

    if (!patient) {
      return {
        success: false,
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND',
      };
    }

    return { success: true };
  }

  /**
   * Validate doctor exists
   * 
   * @private
   */
  private validateDoctor(doctorId: string): ServiceResponse {
    // For now, we'll skip actual doctor validation since we don't have a doctors map
    // In production, this would check storage.doctors
    return { success: true };
  }

  /**
   * Find slot by ID
   * 
   * @private
   */
  private findSlot(slotId: string, availableSlots?: TimeSlot[]): TimeSlot | null {
    if (!availableSlots) return null;
    return availableSlots.find((s) => s.id === slotId) || null;
  }

  /**
   * Build token entity from request
   * 
   * @private
   */
  private buildToken(request: CreateTokenRequest): Token {
    const tokenNumber = this.generateTokenNumber(request.source);
    const priorityScore = getPriorityScore(request.source);

    return {
      id: uuidv4(),
      tokenNumber,
      patientId: request.patientId,
      doctorId: request.doctorId,
      timeSlotId: request.timeSlotId,
      source: request.source,
      priorityScore,
      status: TokenStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Generate token number
   * Format: {SOURCE}-{TIMESTAMP}-{RANDOM}
   * 
   * @private
   */
  private generateTokenNumber(source: TokenSource): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    const prefix = source.substring(0, 3).toUpperCase();

    return `${prefix}-${timestamp}-${random}`;
  }
}
