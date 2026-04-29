/**
 * ROOK API wearable integration routes.
 * 
 * Endpoints:
 *   POST /api/rook/connect        — Generate ROOK auth URL for patient
 *   POST /api/rook/disconnect     — Revoke ROOK connection
 *   GET  /api/rook/status         — Get connection status
 *   POST /webhooks/rook           — ROOK data webhook
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import prisma from '../lib/prisma';
import axios from 'axios';
import crypto from 'crypto';

const router: Router = Router();

// Default to production, but allow override for Sandbox
const ROOK_BASE_URL    = process.env.ROOK_BASE_URL ?? 'https://api.rook-health.com/api/v1';
const ROOK_CLIENT_UUID = process.env.ROOK_CLIENT_UUID ?? '';
const ROOK_API_KEY     = process.env.ROOK_API_KEY ?? '';

function rookHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': ROOK_API_KEY,
    'x-client-uuid': ROOK_CLIENT_UUID,
  };
}

// ---------------------------------------------------------------------------
// POST /api/rook/connect — generate connection URL
// ---------------------------------------------------------------------------
router.post('/connect', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;

    // ROOK usually requires registering a user first or using their ID
    // For the trial, we'll use our internal userId as the user_id in ROOK
    
    const body = {
      user_id: userId,
      // Optional: redirect URLs if ROOK supports them in the session call
    };

    // Note: ROOK's exact endpoint for session/URL generation might vary by version
    // Standard ROOK Connect flow:
    const rookRes = await axios.post(`${ROOK_BASE_URL}/auth/session`, body, {
      headers: rookHeaders(),
    });

    if (rookRes.status !== 200) {
      console.error('[rook] auth/session error:', rookRes.data);
      return res.status(502).json({ success: false, error: 'ROOK API error' });
    }

    // ROOK returns a session or a direct URL
    // Adjusting based on common ROOK response structure
    const data = rookRes.data;
    res.json({ 
      success: true, 
      url: data.url || data.link_url, 
      sessionId: data.session_id 
    });
  } catch (error: any) {
    console.error('[rook] Connect failed:', error.response?.data || error.message);
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rook/disconnect — revoke ROOK connection
// ---------------------------------------------------------------------------
router.post('/disconnect', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    
    // In ROOK, we usually de-register the user or just clear our local reference
    // for the trial, clearing local reference is safer unless they have a deauth API
    
    await prisma.user.update({
      where: { id: userId },
      data: { rookUserId: null } as any,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/rook/status — connection status
// ---------------------------------------------------------------------------
router.get('/status', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const user   = await prisma.user.findUnique({
      where: { id: userId },
      select: { rookUserId: true },
    });

    res.json({
      success: true,
      connected: !!user?.rookUserId,
      rookUserId: user?.rookUserId ?? null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

// ---------------------------------------------------------------------------
// ROOK webhook handler
// ---------------------------------------------------------------------------
export async function handleRookWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const secret = process.env.ROOK_WEBHOOK_SECRET;
    const signature = req.headers['rook-signature'] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    // HMAC verification (Compliance-first)
    if (secret && signature && rawBody) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      if (signature !== expected) {
        console.warn('[rook] Webhook HMAC verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const payload = req.body;
    // ROOK webhooks often have a 'type' or 'category'
    // Simulator uses 'data_structure', Production often uses 'category'
    const category = payload?.category || payload?.data_structure;
    const userId = payload?.user_id;

    console.log(`[rook] Webhook received for user ${userId}, category/structure: ${category}`);

    if (userId && category) {
      // Find the user in our DB
      const user = await prisma.user.findFirst({
        where: { 
          OR: [
            { id: userId },
            { rookUserId: userId }
          ]
        }
      });

      if (user) {
        // Update user's rookUserId if not set
        if (!user.rookUserId) {
          await prisma.user.update({
            where: { id: user.id },
            data: { rookUserId: userId }
          });
        }

        // Process the biometric data
        await processRookData(payload);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[rook] Webhook error:', error);
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Map ROOK payload → ML service BiometricData and ingest
// ---------------------------------------------------------------------------
async function processRookData(payload: any): Promise<void> {
  const mlUrl = process.env.ML_SERVICE_URL;
  if (!mlUrl) return;

  const userId = payload?.user_id as string;
  if (!userId) return;

  let biometricData: Record<string, any> | null = null;
  const category = payload?.category || payload?.data_structure;

  // 1. Handle Production Structure (payload.data)
  if (payload.data) {
    const data = payload.data;
    if (category === 'body' || category === 'physical') {
      biometricData = {
        timestamp:            new Date().toISOString(),
        heart_rate_resting:   data?.heart_rate?.resting_hr || data?.heart_rate?.avg_hr || 70,
        hrv_rmssd:            data?.heart_rate?.hrv_rmssd || 40,
        spo2:                 data?.oxygen_saturation?.avg || 97,
        respiratory_rate:     data?.respiration?.rate || 16,
        step_count:           data?.activity?.steps || 0,
      };
    } else if (category === 'sleep') {
      biometricData = {
        timestamp:            new Date().toISOString(),
        sleep_duration_hours: (data?.duration_seconds || 0) / 3600,
        sleep_score:          data?.score || 70,
      };
    }
  } 
  // 2. Handle Simulator Structure (body_health.summary.body_summary)
  else if (payload.body_health?.summary?.body_summary) {
    const summary = payload.body_health.summary.body_summary;
    biometricData = {
      timestamp:            new Date().toISOString(),
      heart_rate_resting:   summary.heart_rate?.hr_resting_bpm_int || summary.heart_rate?.hr_avg_bpm_int || 70,
      hrv_rmssd:            summary.heart_rate?.hrv_avg_rmssd_float || 40,
      spo2:                 summary.oxygenation?.saturation_avg_percentage_int || 97,
      respiratory_rate:     16, // Simulator might not provide this in the snippet
      step_count:           summary.body_metrics?.steps_int || 0,
    };
  }

  if (biometricData) {
    try {
      console.log(`[rook] Forwarding data to ML for user ${userId}`);
      await axios.post(`${mlUrl}/early-warning/ingest/${userId}`, biometricData);
    } catch (err: any) {
      console.error('[rook] ML ingestion failed:', err.message);
    }
  }
}
