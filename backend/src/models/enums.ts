/**
 * Domain Enums for OPD Token Allocation System
 */

/**
 * Token source enumeration
 * Defines how a token was allocated
 */
export enum TokenSource {
  ONLINE = 'ONLINE',
  WALKIN = 'WALKIN',
  PAID = 'PAID',
  FOLLOW_UP = 'FOLLOW_UP',
  EMERGENCY = 'EMERGENCY',
}

/**
 * Token status enumeration
 * Tracks the current state of a token
 */
export enum TokenStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

/**
 * Slot status enumeration
 * Indicates availability of appointment slots
 */
export enum SlotStatus {
  OPEN = 'OPEN',
  FULL = 'FULL',
}

/**
 * Type exports for convenient usage
 */
export type TokenSourceType = keyof typeof TokenSource;
export type TokenStatusType = keyof typeof TokenStatus;
export type SlotStatusType = keyof typeof SlotStatus;
