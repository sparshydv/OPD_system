/**
 * OPD Day Simulation Module
 * Simulates a complete day of OPD operations with multiple doctors, slots, and token sources
 */
import { TokenService, CreateTokenRequest } from '@services/AllocationService';
import { Doctor, TimeSlot, Patient, Token } from '@models/types';
import { TokenSource, TokenStatus } from '@models/enums';
import { storage } from '@utils/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  numberOfDoctors: number;
  slotsPerDoctor: number;
  slotCapacity: number;
  totalPatients: number;
  emergencyRate: number; // 0-1
  cancellationRate: number; // 0-1
  noShowRate: number; // 0-1
}

/**
 * Simulation timeline event
 */
interface TimelineEvent {
  timestamp: Date;
  eventType: string;
  description: string;
  data?: any;
}

/**
 * Simulation results
 */
export interface SimulationResults {
  totalDoctors: number;
  totalSlots: number;
  totalTokensGenerated: number;
  successfulAllocations: number;
  emergencyAllocations: number;
  cancellations: number;
  noShows: number;
  waitingQueueTotal: number;
  timeline: TimelineEvent[];
  statistics: {
    sourceDistribution: Record<TokenSource, number>;
    allocationRates: {
      direct: number;
      withEviction: number;
      withReallocation: number;
      failed: number;
    };
  };
}

export class OPDDaySimulation {
  private service: TokenService;
  private doctors: Doctor[] = [];
  private slots: TimeSlot[] = [];
  private patients: Patient[] = [];
  private timeline: TimelineEvent[] = [];
  private config: SimulationConfig;
  private simulationStartTime: Date;

  constructor(config?: Partial<SimulationConfig>) {
    this.config = {
      numberOfDoctors: 3,
      slotsPerDoctor: 4,
      slotCapacity: 30,
      totalPatients: 200,
      emergencyRate: 0.05,
      cancellationRate: 0.1,
      noShowRate: 0.08,
      ...config,
    };

    // Initialize simulation start time (will be set properly in setupTimeSlots)
    this.simulationStartTime = new Date();
    
    this.service = new TokenService(this.simulationStartTime);
  }

  /**
   * Run the complete simulation
   */
  public async runSimulation(): Promise<SimulationResults> {
    console.log('===== OPD DAY SIMULATION START =====');
    console.log(`Configuration:`, this.config);
    console.log('');

    this.timeline = [];

    // Phase 1: Setup
    this.setupDoctors();
    this.setupTimeSlots();
    this.setupPatients();

    // Phase 2: Generate and allocate tokens
    const tokenResults = await this.generateAndAllocateTokens();

    // Phase 3: Simulate emergencies
    await this.simulateEmergencies();

    // Phase 4: Simulate cancellations
    await this.simulateCancellations();

    // Phase 5: Simulate no-shows
    await this.simulateNoShows();

    // Phase 6: Generate results
    const results = this.generateResults(tokenResults);

    // Print timeline
    this.printTimeline();
    this.printResults(results);

    console.log('===== OPD DAY SIMULATION END =====');

    return results;
  }

  /**
   * Setup doctors
   */
  private setupDoctors(): void {
    const specializations = ['Cardiology', 'Orthopedics', 'Pediatrics', 'Dermatology', 'ENT'];

    for (let i = 0; i < this.config.numberOfDoctors; i++) {
      const doctor: Doctor = {
        id: `DOC-${i + 1}`,
        name: `Dr. ${['Sharma', 'Patel', 'Singh', 'Verma', 'Gupta'][i % 5]}`,
        specialization: specializations[i % specializations.length],
        licenseNumber: `LIC-${1000 + i}`,
        email: `doctor${i + 1}@hospital.com`,
        phone: `555-010${i}`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.doctors.push(doctor);
    }

    this.logEvent('SETUP', `Created ${this.doctors.length} doctors`);
  }

  /**
   * Setup time slots
   */
  private setupTimeSlots(): void {
    const baseDate = new Date();
    baseDate.setHours(9, 0, 0, 0); // Start at 9 AM

    for (const doctor of this.doctors) {
      for (let i = 0; i < this.config.slotsPerDoctor; i++) {
        const startTime = new Date(baseDate);
        startTime.setHours(baseDate.getHours() + i * 2); // 2-hour slots

        const endTime = new Date(startTime);
        endTime.setHours(startTime.getHours() + 2);

        const slot: TimeSlot = {
          id: `SLOT-${doctor.id}-${i + 1}`,
          doctorId: doctor.id,
          startTime,
          endTime,
          maxCapacity: this.config.slotCapacity,
          currentTokenCount: 0,
          isRecurring: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        this.slots.push(slot);
      }
    }

    // Set simulation start time to 30 minutes before the earliest slot
    const earliestSlot = this.slots.reduce((earliest, slot) => 
      slot.startTime < earliest ? slot.startTime : earliest, 
      this.slots[0].startTime
    );
    
    this.simulationStartTime = new Date(earliestSlot.getTime() - 30 * 60 * 1000); // 30 minutes before
    
    // Update the service's allocation engine with the correct simulation time
    this.service.setCurrentTime(this.simulationStartTime);
    
    this.logEvent('SETUP', `Created ${this.slots.length} time slots`);
    this.logEvent('SETUP', `Simulation start time set to: ${this.simulationStartTime.toISOString()}`);
    this.logEvent('SETUP', `Earliest slot starts at: ${earliestSlot.toISOString()}`);
  }

  /**
   * Setup patients
   */
  private setupPatients(): void {
    const firstNames = ['Sparsh', 'Ayush', 'Arjun', 'Priya', 'Rohan', 'Ananya', 'Rahul', 'Divya'];
    const lastNames = ['Sharma', 'Patel', 'Singh', 'Verma', 'Gupta', 'Kumar', 'Joshi'];

    for (let i = 0; i < this.config.totalPatients; i++) {
      const patient: Patient = {
        id: `PAT-${i + 1}`,
        name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
        email: `patient${i + 1}@email.com`,
        phone: `555-${2000 + i}`,
        gender: i % 2 === 0 ? 'M' : 'F',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.patients.push(patient);

      // Store in storage
      const storageInstance = storage.getStorage();
      storageInstance.patients.set(patient.id, patient);
    }

    this.logEvent('SETUP', `Created ${this.patients.length} patients`);
  }

  /**
   * Generate and allocate tokens from various sources
   */
  private async generateAndAllocateTokens(): Promise<{
    successful: number;
    failed: number;
    queued: number;
  }> {
    let successful = 0;
    let failed = 0;
    let queued = 0;

    const sources = [
      TokenSource.ONLINE,
      TokenSource.WALKIN,
      TokenSource.PAID,
      TokenSource.FOLLOW_UP,
    ];

    // Distribute patients across slots and sources
    for (let i = 0; i < this.patients.length * 0.9; i++) {
      // 90% allocation rate
      const patient = this.patients[i];
      const slot = this.slots[i % this.slots.length];
      const source = sources[i % sources.length];

      const request: CreateTokenRequest = {
        patientId: patient.id,
        doctorId: slot.doctorId,
        timeSlotId: slot.id,
        source,
      };

      const result = await this.service.createToken(request, this.slots);

      if (result.success) {
        successful++;
        this.logEvent('ALLOCATION', `Token allocated: ${source} for ${patient.name}`, {
          slotId: slot.id,
          code: result.code,
        });
      } else if (result.code === 'ADDED_TO_WAITING_QUEUE') {
        queued++;
        this.logEvent(
          'WAITING_QUEUE',
          `Token queued: ${source} for ${patient.name}`,
          result.details,
        );
      } else {
        failed++;
        this.logEvent('ALLOCATION_FAILED', `Failed to allocate token for ${patient.name}`, {
          error: result.error,
          code: result.code,
        });
      }
    }

    return { successful, failed, queued };
  }

  /**
   * Simulate emergency arrivals
   */
  private async simulateEmergencies(): Promise<void> {
    const emergencyCount = Math.floor(this.config.totalPatients * this.config.emergencyRate);

    this.logEvent('EMERGENCY_PHASE', `Simulating ${emergencyCount} emergencies`);

    for (let i = 0; i < emergencyCount; i++) {
      const patientIndex = this.patients.length - 1 - i;
      const patient = this.patients[patientIndex];
      const slot = this.slots[Math.floor(Math.random() * this.slots.length)];

      const request: CreateTokenRequest = {
        patientId: patient.id,
        doctorId: slot.doctorId,
        timeSlotId: slot.id,
        source: TokenSource.EMERGENCY,
      };

      const result = await this.service.createEmergencyToken(request, slot.id, this.slots);

      if (result.success) {
        this.logEvent(
          'EMERGENCY',
          `🚨 Emergency token allocated for ${patient.name}`,
          {
            code: result.code,
            evicted: result.data?.allocation.evictedTokenId,
          },
        );
      } else {
        this.logEvent('EMERGENCY_FAILED', `❌ Emergency allocation failed for ${patient.name}`, {
          error: result.error,
          code: result.code,
        });
      }
    }
  }

  /**
   * Simulate token cancellations
   */
  private async simulateCancellations(): Promise<void> {
    const storageInstance = storage.getStorage();
    const allTokens: Token[] = Array.from(storageInstance.tokens.values());
    const activeTokens = allTokens.filter((t) => t.status === TokenStatus.ACTIVE);

    const cancellationCount = Math.floor(activeTokens.length * this.config.cancellationRate);

    this.logEvent('CANCELLATION_PHASE', `Simulating ${cancellationCount} cancellations`);

    for (let i = 0; i < cancellationCount && i < activeTokens.length; i++) {
      const token = activeTokens[i];

      const result = await this.service.cancelToken(token.id, this.slots);

      if (result.success) {
        this.logEvent('CANCELLATION', `Token cancelled: ${token.tokenNumber}`, {
          code: result.data?.code,
          promoted: result.data?.message.includes('promoted'),
        });
      }
    }
  }

  /**
   * Simulate no-shows
   */
  private async simulateNoShows(): Promise<void> {
    const storageInstance = storage.getStorage();
    const allTokens: Token[] = Array.from(storageInstance.tokens.values());
    const activeTokens = allTokens.filter((t) => t.status === TokenStatus.ACTIVE);

    const noShowCount = Math.floor(activeTokens.length * this.config.noShowRate);

    this.logEvent('NO_SHOW_PHASE', `Simulating ${noShowCount} no-shows`);

    const tokenIds = activeTokens.slice(0, noShowCount).map((t) => t.id);
    const result = await this.service.batchMarkNoShow(tokenIds, this.slots);

    this.logEvent('NO_SHOW_BATCH', `Batch no-show completed`, {
      processed: result.data?.processed,
      promoted: result.data?.promoted,
      rebalanced: result.data?.rebalanced,
    });
  }

  /**
   * Generate simulation results
   */
  private generateResults(tokenResults: {
    successful: number;
    failed: number;
    queued: number;
  }): SimulationResults {
    const storageInstance = storage.getStorage();
    const allTokens: Token[] = Array.from(storageInstance.tokens.values());

    // Source distribution
    const sourceDistribution: Record<TokenSource, number> = {
      [TokenSource.ONLINE]: 0,
      [TokenSource.WALKIN]: 0,
      [TokenSource.PAID]: 0,
      [TokenSource.FOLLOW_UP]: 0,
      [TokenSource.EMERGENCY]: 0,
    };

    allTokens.forEach((token) => {
      sourceDistribution[token.source]++;
    });

    // Count by status
    const activeTokens = allTokens.filter((t) => t.status === TokenStatus.ACTIVE).length;
    const cancelledTokens = allTokens.filter((t) => t.status === TokenStatus.CANCELLED).length;
    const noShowTokens = allTokens.filter((t) => t.status === 'NO_SHOW').length;
    const emergencyTokens = allTokens.filter((t) => t.source === TokenSource.EMERGENCY).length;

    // Count waiting queue
    let waitingQueueTotal = 0;
    this.slots.forEach((slot) => {
      const queue = storageInstance.waitingQueue.get(slot.id) || [];
      waitingQueueTotal += queue.length;
    });

    return {
      totalDoctors: this.doctors.length,
      totalSlots: this.slots.length,
      totalTokensGenerated: allTokens.length,
      successfulAllocations: tokenResults.successful,
      emergencyAllocations: emergencyTokens,
      cancellations: cancelledTokens,
      noShows: noShowTokens,
      waitingQueueTotal,
      timeline: this.timeline,
      statistics: {
        sourceDistribution,
        allocationRates: {
          direct: tokenResults.successful,
          withEviction: 0, // Would need event log analysis
          withReallocation: 0, // Would need event log analysis
          failed: tokenResults.failed,
        },
      },
    };
  }

  /**
   * Log an event to timeline
   */
  private logEvent(eventType: string, description: string, data?: any): void {
    const event: TimelineEvent = {
      timestamp: new Date(),
      eventType,
      description,
      data,
    };
    this.timeline.push(event);
  }

  /**
   * Print timeline to console
   */
  private printTimeline(): void {
    console.log('\n===== SIMULATION TIMELINE =====');
    this.timeline.forEach((event, index) => {
      console.log(
        `[${index + 1}] ${event.timestamp.toISOString()} - ${event.eventType}: ${event.description}`,
      );
      if (event.data) {
        console.log(`    Data:`, event.data);
      }
    });
  }

  /**
   * Print simulation results
   */
  private printResults(results: SimulationResults): void {
    console.log('\n===== SIMULATION RESULTS =====');
    console.log(`Total Doctors: ${results.totalDoctors}`);
    console.log(`Total Slots: ${results.totalSlots}`);
    console.log(`Total Tokens Generated: ${results.totalTokensGenerated}`);
    console.log(`Successful Allocations: ${results.successfulAllocations}`);
    console.log(`Emergency Allocations: ${results.emergencyAllocations}`);
    console.log(`Cancellations: ${results.cancellations}`);
    console.log(`No-Shows: ${results.noShows}`);
    console.log(`Waiting Queue Total: ${results.waitingQueueTotal}`);
    console.log('\nSource Distribution:');
    Object.entries(results.statistics.sourceDistribution).forEach(([source, count]) => {
      console.log(`  ${source}: ${count}`);
    });
    console.log('\nAllocation Rates:');
    console.log(`  Direct: ${results.statistics.allocationRates.direct}`);
    console.log(`  Failed: ${results.statistics.allocationRates.failed}`);
  }

  /**
   * Reset simulation state
   */
  public reset(): void {
    this.doctors = [];
    this.slots = [];
    this.patients = [];
    this.timeline = [];
    storage.reset();
  }
}
