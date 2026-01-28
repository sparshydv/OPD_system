/**
 * Allocation Rules Module
 * Defines business rules for token allocation
 */

import { Token, TimeSlot } from '@models/types';
import { TokenStatus } from '@models/enums';

/**
 * Rejection reason enumeration
 * Structured reasons why a token allocation is rejected
 */
export enum RejectionReason {
  SLOT_AT_CAPACITY = 'SLOT_AT_CAPACITY',
  SLOT_INACTIVE = 'SLOT_INACTIVE',
  INVALID_SLOT = 'INVALID_SLOT',
  INVALID_PATIENT = 'INVALID_PATIENT',
  DUPLICATE_ALLOCATION = 'DUPLICATE_ALLOCATION',
  REALLOCATION_NOT_ALLOWED = 'REALLOCATION_NOT_ALLOWED',
  INVALID_SOURCE = 'INVALID_SOURCE',
  PAST_TIME_SLOT = 'PAST_TIME_SLOT',
  DOCTOR_UNAVAILABLE = 'DOCTOR_UNAVAILABLE',
  PATIENT_DUPLICATE_SAME_DAY = 'PATIENT_DUPLICATE_SAME_DAY',
}

/**
 * Structured validation result
 */
export interface ValidationResult {
  isAllowed: boolean;
  rejectionReason?: RejectionReason;
  details?: string;
  code?: number;
}

/**
 * Hard capacity enforcement
 * Checks if a slot has reached its maximum capacity
 *
 * @param slot - The time slot to check
 * @returns true if slot is at capacity
 */
export function isSlotAtCapacity(slot: TimeSlot): boolean {
  return slot.currentTokenCount >= slot.maxCapacity;
}

/**
 * Get available capacity in a slot
 *
 * @param slot - The time slot to check
 * @returns Number of available slots
 */
export function getAvailableCapacity(slot: TimeSlot): number {
  return Math.max(0, slot.maxCapacity - slot.currentTokenCount);
}

/**
 * Check if reallocation is allowed for an existing token
 *
 * Rules:
 * - Token must be ACTIVE
 * - Cannot reallocate CANCELLED or NO_SHOW tokens
 * - Reallocations allowed only within 24 hours of original slot time
 *
 * @param existingToken - The token to reallocate
 * @param newSlotTime - The new slot time
 * @returns ValidationResult
 */
export function canReallocateToken(
  existingToken: Token,
  newSlotTime: Date,
): ValidationResult {
  // Check token status
  if (existingToken.status !== TokenStatus.ACTIVE) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.REALLOCATION_NOT_ALLOWED,
      details: `Cannot reallocate token with status: ${existingToken.status}`,
    };
  }

  // Check reallocation window (24 hours from original slot)
  const originalSlotTime = existingToken.createdAt;
  const hoursSinceOriginal =
    (Date.now() - originalSlotTime.getTime()) / (1000 * 60 * 60);

  if (hoursSinceOriginal > 24) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.REALLOCATION_NOT_ALLOWED,
      details: `Reallocation window expired. ${hoursSinceOriginal.toFixed(1)} hours since original allocation.`,
    };
  }

  return { isAllowed: true };
}

/**
 * Validate slot capacity and availability
 *
 * @param slot - The time slot
 * @param currentTime - Optional current time for simulation (defaults to now)
 * @returns ValidationResult
 */
export function validateSlotCapacity(slot: TimeSlot, currentTime?: Date): ValidationResult {
  if (!slot) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.INVALID_SLOT,
      details: 'Slot does not exist',
    };
  }

  if (isSlotAtCapacity(slot)) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.SLOT_AT_CAPACITY,
      details: `Slot capacity reached. Current: ${slot.currentTokenCount}/${slot.maxCapacity}`,
    };
  }

  // Check if slot time is in the past (use provided time or current time)
  const referenceTime = currentTime || new Date();
  if (slot.endTime < referenceTime) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.PAST_TIME_SLOT,
      details: `Slot time has already passed: ${slot.endTime.toISOString()}`,
    };
  }

  return { isAllowed: true };
}

/**
 * Check if patient has already been allocated a token for the same doctor on the same day
 *
 * @param patientId - Patient ID
 * @param doctorId - Doctor ID
 * @param allocatedTokens - List of existing allocated tokens
 * @returns ValidationResult
 */
export function checkPatientDuplicateAllocations(
  patientId: string,
  doctorId: string,
  allocatedTokens: Token[],
): ValidationResult {
  const duplicateToken = allocatedTokens.find((token) => {
    // Check same patient, same doctor
    if (token.patientId !== patientId || token.doctorId !== doctorId) {
      return false;
    }

    // Check same day
    const tokenDate = new Date(token.createdAt);
    const today = new Date();

    const sameDay =
      tokenDate.getFullYear() === today.getFullYear() &&
      tokenDate.getMonth() === today.getMonth() &&
      tokenDate.getDate() === today.getDate();

    // Check token is active (not cancelled)
    return sameDay && token.status === TokenStatus.ACTIVE;
  });

  if (duplicateToken) {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.PATIENT_DUPLICATE_SAME_DAY,
      details: `Patient already has an active token for this doctor today: ${duplicateToken.tokenNumber}`,
    };
  }

  return { isAllowed: true };
}

/**
 * Comprehensive allocation validation
 * Checks all business rules
 *
 * @param params - Validation parameters
 * @returns ValidationResult
 */
export function validateAllocationRules(params: {
  slot: TimeSlot;
  patientId: string;
  doctorId: string;
  existingTokens: Token[];
  isReallocation?: boolean;
  existingToken?: Token;
  currentTime?: Date; // Optional simulation time for testing
}): ValidationResult {
  const { slot, patientId, doctorId, existingTokens, isReallocation, existingToken, currentTime } = params;

  // Validate slot capacity
  const capacityResult = validateSlotCapacity(slot, currentTime);
  if (!capacityResult.isAllowed) {
    return capacityResult;
  }

  // Validate patient is not null/undefined
  if (!patientId || patientId.trim() === '') {
    return {
      isAllowed: false,
      rejectionReason: RejectionReason.INVALID_PATIENT,
      details: 'Patient ID is required',
    };
  }

  // Check for duplicate same-day allocations
  const duplicateResult = checkPatientDuplicateAllocations(patientId, doctorId, existingTokens);
  if (!duplicateResult.isAllowed) {
    return duplicateResult;
  }

  // If reallocation, validate reallocation rules
  if (isReallocation && existingToken) {
    const reallocResult = canReallocateToken(existingToken, slot.startTime);
    if (!reallocResult.isAllowed) {
      return reallocResult;
    }
  }

  return { isAllowed: true };
}

/**
 * Get human-readable rejection message
 *
 * @param reason - RejectionReason enum value
 * @returns Human-readable message
 */
export function getRejectioMessage(reason: RejectionReason): string {
  const messages: Record<RejectionReason, string> = {
    [RejectionReason.SLOT_AT_CAPACITY]: 'This time slot is fully booked.',
    [RejectionReason.SLOT_INACTIVE]: 'This time slot is currently inactive.',
    [RejectionReason.INVALID_SLOT]: 'Invalid time slot.',
    [RejectionReason.INVALID_PATIENT]: 'Invalid patient information.',
    [RejectionReason.DUPLICATE_ALLOCATION]: 'Patient already has an allocation.',
    [RejectionReason.REALLOCATION_NOT_ALLOWED]:
      'This token cannot be reallocated at this time.',
    [RejectionReason.INVALID_SOURCE]: 'Invalid token source.',
    [RejectionReason.PAST_TIME_SLOT]: 'Cannot allocate to a past time slot.',
    [RejectionReason.DOCTOR_UNAVAILABLE]: 'Doctor is not available.',
    [RejectionReason.PATIENT_DUPLICATE_SAME_DAY]:
      'Patient already has an active token for this doctor today.',
  };

  return messages[reason] || 'Allocation request rejected.';
}
