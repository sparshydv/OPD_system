/**
 * Token allocation routes
 */
import { Router } from 'express';
import { TokenController } from '@controllers/AllocationController';

const router = Router();
const controller = new TokenController();

/**
 * POST /api/v1/tokens - Create a new token allocation
 */
router.post('/tokens', (req, res) => controller.createToken(req, res));

/**
 * POST /api/v1/tokens/emergency - Create emergency token
 */
router.post('/tokens/emergency', (req, res) => controller.createEmergencyToken(req, res));

/**
 * POST /api/v1/tokens/cancel - Cancel a token
 */
router.post('/tokens/cancel', (req, res) => controller.cancelToken(req, res));

/**
 * POST /api/v1/tokens/no-show - Mark token as no-show
 */
router.post('/tokens/no-show', (req, res) => controller.markNoShow(req, res));

/**
 * GET /api/v1/tokens/:id - Get token by ID
 */
router.get('/tokens/:id', (req, res) => controller.getToken(req, res));

/**
 * GET /api/v1/slots/:doctorId - Get slots for a doctor
 */
router.get('/slots/:doctorId', (req, res) => controller.getDoctorSlots(req, res));

/**
 * GET /api/v1/slots/:slotId/tokens - Get tokens for a slot
 */
router.get('/slots/:slotId/tokens', (req, res) => controller.getSlotTokens(req, res));

/**
 * GET /api/v1/events - Get event log
 */
router.get('/events', (req, res) => controller.getEventLog(req, res));

export default router;
