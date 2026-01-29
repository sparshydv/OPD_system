/**
 * Token Controller - REST API request handling layer
 * Validates HTTP requests, calls services, returns HTTP responses
 */
import { Request, Response } from 'express';
import { TokenService, CreateTokenRequest } from '@services/AllocationService';
import { TokenSource } from '@models/enums';
import { TimeSlot } from '@models/types';

export class TokenController {
  private service: TokenService;

  constructor() {
    this.service = new TokenService();
  }

  /**
   * POST /tokens - Create a new token allocation
   */
  public async createToken(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const { patientId, doctorId, timeSlotId, source } = req.body;

      if (!patientId || !doctorId || !timeSlotId || !source) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: patientId, doctorId, timeSlotId, source',
        });
        return;
      }

      // Validate source is valid TokenSource
      if (!Object.values(TokenSource).includes(source)) {
        res.status(400).json({
          success: false,
          error: `Invalid source. Must be one of: ${Object.values(TokenSource).join(', ')}`,
        });
        return;
      }

      const tokenRequest: CreateTokenRequest = {
        patientId,
        doctorId,
        timeSlotId,
        source: source as TokenSource,
      };

      // Get available slots (in production, this would come from a repository)
      const availableSlots = this.getMockAvailableSlots(doctorId);

      const result = await this.service.createToken(tokenRequest, availableSlots);

      if (result.success) {
        res.status(201).json({
          success: true,
          data: result.data,
          message: 'Token created successfully',
        });
      } else {
        // Determine appropriate status code based on error
        const statusCode = this.getStatusCodeForError(result.code);
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
          details: result.details,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /tokens/emergency - Create emergency token with forced allocation
   */
  public async createEmergencyToken(req: Request, res: Response): Promise<void> {
    try {
      const { patientId, doctorId, timeSlotId, preferredSlotId } = req.body;

      if (!patientId || !doctorId || !timeSlotId) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: patientId, doctorId, timeSlotId',
        });
        return;
      }

      const tokenRequest: CreateTokenRequest = {
        patientId,
        doctorId,
        timeSlotId,
        source: TokenSource.EMERGENCY,
      };

      const availableSlots = this.getMockAvailableSlots(doctorId);
      const preferred = preferredSlotId || timeSlotId;

      const result = await this.service.createEmergencyToken(
        tokenRequest,
        preferred,
        availableSlots,
      );

      if (result.success) {
        res.status(201).json({
          success: true,
          data: result.data,
          message: 'Emergency token created successfully',
        });
      } else {
        const statusCode = result.code === 'EMERGENCY_SYSTEM_SATURATED' ? 503 : 
                          result.code === 'EMERGENCY_CRITICAL_FAILURE' ? 500 : 400;
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /tokens/cancel - Cancel a token
   */
  public async cancelToken(req: Request, res: Response): Promise<void> {
    try {
      const { tokenId, doctorId } = req.body;

      if (!tokenId) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: tokenId',
        });
        return;
      }

      const availableSlots = doctorId ? this.getMockAvailableSlots(doctorId) : undefined;

      const result = await this.service.cancelToken(tokenId, availableSlots);

      if (result.success) {
        res.status(200).json({
          success: true,
          data: result.data,
          message: 'Token cancelled successfully',
        });
      } else {
        const statusCode = this.getStatusCodeForError(result.code);
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /tokens/no-show - Mark token as no-show
   */
  public async markNoShow(req: Request, res: Response): Promise<void> {
    try {
      const { tokenId, doctorId } = req.body;

      if (!tokenId) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: tokenId',
        });
        return;
      }

      const availableSlots = doctorId ? this.getMockAvailableSlots(doctorId) : undefined;

      const result = await this.service.markNoShow(tokenId, availableSlots);

      if (result.success) {
        res.status(200).json({
          success: true,
          data: result.data,
          message: 'Token marked as no-show',
        });
      } else {
        const statusCode = this.getStatusCodeForError(result.code);
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /tokens/:id - Get token by ID
   */
  public async getToken(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Token ID is required',
        });
        return;
      }

      const result = await this.service.getToken(id);

      if (result.success) {
        res.status(200).json({
          success: true,
          data: result.data,
        });
      } else {
        const statusCode = this.getStatusCodeForError(result.code);
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /slots/:doctorId - Get time slots for a doctor
   */
  public async getDoctorSlots(req: Request, res: Response): Promise<void> {
    try {
      const { doctorId } = req.params;

      if (!doctorId) {
        res.status(400).json({
          success: false,
          error: 'Doctor ID is required',
        });
        return;
      }

      // Get available slots for doctor
      const slots = this.getMockAvailableSlots(doctorId);

      // Get statistics for each slot
      const slotsWithStats = await Promise.all(
        slots.map(async (slot) => {
          const stats = await this.service.getSlotStatistics(slot.id);
          const waitingQueue = await this.service.getWaitingQueue(slot.id);
          
          return {
            ...slot,
            statistics: stats.data,
            waitingQueueSize: waitingQueue.data?.length || 0,
          };
        }),
      );

      res.status(200).json({
        success: true,
        data: {
          doctorId,
          slots: slotsWithStats,
          totalSlots: slots.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /slots/:slotId/tokens - Get all tokens for a slot
   */
  public async getSlotTokens(req: Request, res: Response): Promise<void> {
    try {
      const { slotId } = req.params;

      if (!slotId) {
        res.status(400).json({
          success: false,
          error: 'Slot ID is required',
        });
        return;
      }

      const tokensResult = await this.service.getSlotTokens(slotId);
      const queueResult = await this.service.getWaitingQueue(slotId);
      const statsResult = await this.service.getSlotStatistics(slotId);

      res.status(200).json({
        success: true,
        data: {
          slotId,
          tokens: tokensResult.data || [],
          waitingQueue: queueResult.data || [],
          statistics: statsResult.data,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /events - Get event log
   */
  public async getEventLog(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.query;

      const result = await this.service.getEventLog(type as any);

      res.status(200).json({
        success: true,
        data: result.data || [],
        count: result.data?.length || 0,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Map service error codes to HTTP status codes
   * @private
   */
  private getStatusCodeForError(code?: string): number {
    const errorMap: Record<string, number> = {
      TOKEN_NOT_FOUND: 404,
      PATIENT_NOT_FOUND: 404,
      DOCTOR_NOT_FOUND: 404,
      SLOT_NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      ALREADY_CANCELLED: 400,
      ALREADY_NO_SHOW: 400,
      SLOT_FULL_NO_REALLOCATION: 409,
      ADDED_TO_WAITING_QUEUE: 202,
      SERVICE_ERROR: 500,
    };

    return errorMap[code || ''] || 400;
  }

  /**
   * Mock function to get available slots
   * In production, this would query a repository/database
   * @private
   */
  private getMockAvailableSlots(_doctorId: string): TimeSlot[] {
    // Mock implementation - returns empty array for now
    // In production, this would fetch from database
    return [];
  }
}
