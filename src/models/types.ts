/**
 * Domain Models for OPD Token Allocation System
 * Framework-agnostic type definitions
 */

import { TokenSource, TokenStatus } from './enums';

/**
 * Patient domain model
 * Represents a patient in the OPD system
 */
export interface Patient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: 'M' | 'F' | 'O';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Doctor domain model
 * Represents a doctor managing OPD consultations
 */
export interface Doctor {
  id: string;
  name: string;
  specialization: string;
  email?: string;
  phone?: string;
  licenseNumber: string;
  department?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * TimeSlot domain model
 * Represents an appointment slot under a doctor
 */
export interface TimeSlot {
  id: string;
  doctorId: string;
  startTime: Date;
  endTime: Date;
  maxCapacity: number;
  currentTokenCount: number;
  dayOfWeek?: number; // 0-6 for recurring slots
  isRecurring: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Token domain model
 * Represents an OPD appointment token
 */
export interface Token {
  id: string;
  tokenNumber: string;
  patientId: string;
  doctorId: string;
  timeSlotId: string;
  source: TokenSource;
  priorityScore: number;
  status: TokenStatus;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
  cancelReason?: string;
}

/**
 * Allocation domain model
 * Represents the result of token allocation operation
 */
export interface Allocation {
  id: string;
  patientId: string;
  tokenId: string;
  doctorId: string;
  timeSlotId: string;
  allocatedAt: Date;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}
