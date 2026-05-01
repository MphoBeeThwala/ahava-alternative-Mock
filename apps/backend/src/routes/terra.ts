/**
 * Terra API wearable integration routes.
 *
 * Endpoints:
 *   POST /api/terra/connect        — Generate Terra auth URL for patient
 *   POST /api/terra/disconnect     — Revoke Terra connection
 *   GET  /api/terra/status         — Get connected devices for patient
 *   POST /webhooks/terra           — Terra data webhook (raw body, HMAC verified)
 *
 * Required env vars:
 *   TERRA_DEV_ID      — from app.tryterra.com
 *   TERRA_API_KEY     — from app.tryterra.com
 *   TERRA_WEBHOOK_SECRET — for HMAC signature verification
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth';
import prisma from '../lib/prisma';
import { mlServiceHeaders } from '../services/mlServiceAuth';

const router: Router = Router();

const TERRA_BASE_URL    = 'https://api.tryterra.co/v2';
const TERRA_DEV_ID      = process.env.TERRA_DEV_ID ?? '';
const TERRA_API_KEY     = process.env.TERRA_API_KEY ?? '';

function terraHeaders() {
  return {
    'Content-Type': 'application/json',
    'dev-id': TERRA_DEV_ID,
    'x-api-key': TERRA_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// POST /api/terra/connect — generate widget auth URL
// ---------------------------------------------------------------------------
const TERRA_USER_LIMIT = parseInt(process.env.TERRA_USER_LIMIT ?? '15', 10);

router.post('/connect', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;

    // Check if this user is already connected (doesn't count against limit)
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { terraUserId: true } });
    if (!currentUser?.terraUserId) {
      // Count currently connected Terra users
      const connectedCount = await prisma.user.count({ where: { terraUserId: { not: null } } });
      if (connectedCount >= TERRA_USER_LIMIT) {
        return res.status(429).json({
          success: false,
          error: `Wearable beta is limited to ${TERRA_USER_LIMIT} testers. Spots are currently full. Check back soon!`,
        });
      }
    }

    const body = {
      reference_id: userId,
      language: 'en',
      auth_success_redirect_url: `${process.env.FRONTEND_URL ?? ''}/patient/wearable-connected`,
      auth_failure_redirect_url: `${process.env.FRONTEND_URL ?? ''}/patient/wearable-failed`,
    };

    const terraRes = await fetch(`${TERRA_BASE_URL}/auth/generateWidgetSession`, {
      method: 'POST',
      headers: terraHeaders(),
      body: JSON.stringify(body),
    });

    if (!terraRes.ok) {
      const err = await terraRes.text();
      console.error('[terra] generateWidgetSession error:', err);
      return res.status(502).json({ success: false, error: 'Terra API error' });
    }

    const data = await terraRes.json() as { url?: string; session_id?: string };
    res.json({ success: true, url: data.url, sessionId: data.session_id });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/terra/disconnect — revoke Terra connection
// ---------------------------------------------------------------------------
router.post('/disconnect', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const user   = await prisma.user.findUnique({ where: { id: userId }, select: { terraUserId: true } });

    if (!user?.terraUserId) {
      return res.status(400).json({ success: false, error: 'No Terra connection found' });
    }

    const terraRes = await fetch(`${TERRA_BASE_URL}/auth/deauthUser?user_id=${user.terraUserId}`, {
      method: 'DELETE',
      headers: terraHeaders(),
    });

    if (!terraRes.ok) {
      console.warn('[terra] Deauth returned non-200:', await terraRes.text());
    }

    await prisma.user.update({
      where: { id: userId },
      data: { terraUserId: null, connectedDevices: [] } as any,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/terra/status — connected devices
// ---------------------------------------------------------------------------
router.get('/status', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const user   = await prisma.user.findUnique({
      where: { id: userId },
      select: { terraUserId: true, connectedDevices: true },
    } as any);

    res.json({
      success: true,
      connected: !!user?.terraUserId,
      terraUserId: user?.terraUserId ?? null,
      devices: (user as any)?.connectedDevices ?? [],
    });
  } catch (error) {
    next(error);
  }
});

export default router;

// ---------------------------------------------------------------------------
// Terra webhook handler — exported separately for registration at /webhooks/terra
// This must use raw body (no JSON body-parser) for HMAC verification.
// ---------------------------------------------------------------------------
export async function handleTerraWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signatureRequirementRaw = (process.env.WEBHOOK_SIGNATURE_REQUIRED ?? '')
      .trim()
      .toLowerCase();
    // Secure-by-default in production, but allow explicit temporary override with WEBHOOK_SIGNATURE_REQUIRED=false.
    const enforceSignedWebhooks =
      signatureRequirementRaw === 'true' ||
      (signatureRequirementRaw !== 'false' && process.env.NODE_ENV === 'production');
    if (!enforceSignedWebhooks && process.env.NODE_ENV === 'production') {
      console.warn('[terra] Webhook signature verification is DISABLED in production');
    }
    const secret    = process.env.TERRA_WEBHOOK_SECRET ?? '';
    const signature = req.headers['terra-signature'] as string | undefined;
    const rawBody   = (req as any).rawBody as Buffer | undefined;

    if (enforceSignedWebhooks && !secret) {
      console.error('[terra] TERRA_WEBHOOK_SECRET is missing while signature enforcement is enabled');
      res.status(503).json({ error: 'Webhook signature verification not configured' });
      return;
    }
    if (enforceSignedWebhooks && (!signature || !rawBody)) {
      res.status(401).json({ error: 'Missing webhook signature' });
      return;
    }

    // HMAC verification
    if (secret && signature && rawBody) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      if (signature !== expected) {
        console.warn('[terra] Webhook HMAC verification failed');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const payload = req.body;
    const event   = payload?.type as string | undefined;
    console.log(`[terra] Webhook event: ${event}`);

    switch (event) {
      case 'auth': {
        // User connected a device
        const terraUserId = payload?.user?.user_id as string;
        const referenceId = payload?.user?.reference_id as string; // = our userId
        const provider    = payload?.user?.provider as string;

        if (terraUserId && referenceId) {
          const existing = await prisma.user.findUnique({ where: { id: referenceId } });
          if (existing) {
            const devices: string[] = [...((existing as any).connectedDevices ?? [])];
            if (provider && !devices.includes(provider)) devices.push(provider);

            await prisma.user.update({
              where: { id: referenceId },
              data: { terraUserId, connectedDevices: devices } as any,
            });
            console.log(`[terra] User ${referenceId} connected ${provider} (terraId: ${terraUserId})`);
          }
        }
        break;
      }

      case 'deauth': {
        const terraUserId = payload?.user?.user_id as string;
        if (terraUserId) {
          await prisma.user.updateMany({
            where: { terraUserId } as any,
            data: { terraUserId: null, connectedDevices: [] } as any,
          });
          console.log(`[terra] User deauthorised: ${terraUserId}`);
        }
        break;
      }

      case 'body':
      case 'daily':
      case 'activity':
      case 'sleep': {
        // Forward biometric data to ML service
        await processTerraData(payload, event);
        break;
      }

      default:
        console.log(`[terra] Unhandled event type: ${event}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Map Terra payload → ML service BiometricData and ingest
// ---------------------------------------------------------------------------
async function processTerraData(payload: any, event: string): Promise<void> {
  const mlUrl = process.env.ML_SERVICE_URL;
  if (!mlUrl) return;

  const terraUserId = payload?.user?.user_id as string;
  if (!terraUserId) return;

  const user = await prisma.user.findFirst({
    where: { terraUserId } as any,
    select: { id: true },
  });
  if (!user) return;

  let biometricData: Record<string, any> | null = null;

  if (event === 'daily' || event === 'body') {
    const data = payload?.data?.[0];
    if (!data) return;

    biometricData = {
      timestamp:            new Date().toISOString(),
      heart_rate_resting:   data?.heart_data?.heart_rate_data?.summary?.avg_hr_bpm ?? 70,
      hrv_rmssd:            data?.heart_data?.hrv_data?.rmssd ?? 40,
      spo2:                 data?.oxygen_data?.avg_saturation_percentage ?? 97,
      skin_temp_offset:     data?.temperature_data?.skin?.avg ?? 0,
      respiratory_rate:     data?.breathing_data?.avg_breaths_per_min ?? 15,
      step_count:           data?.distance_data?.steps ?? 0,
      active_calories:      data?.calories_data?.net_activity_calories ?? 0,
      sleep_duration_hours: data?.sleep_durations_data?.asleep?.duration_asleep_state_seconds
                            ? data.sleep_durations_data.asleep.duration_asleep_state_seconds / 3600
                            : 0,
    };
  }

  if (event === 'sleep' && payload?.data?.[0]) {
    const sleep = payload.data[0];
    biometricData = {
      timestamp:            new Date().toISOString(),
      heart_rate_resting:   sleep?.biometrics?.avg_hr_bpm ?? 70,
      hrv_rmssd:            sleep?.biometrics?.avg_hrv_rmssd ?? 40,
      spo2:                 sleep?.biometrics?.avg_spo2_percentage ?? 97,
      skin_temp_offset:     0,
      respiratory_rate:     sleep?.biometrics?.avg_breaths_per_min ?? 15,
      step_count:           0,
      active_calories:      0,
      sleep_duration_hours: sleep?.sleep_durations?.asleep?.duration_asleep_state_seconds
                            ? sleep.sleep_durations.asleep.duration_asleep_state_seconds / 3600
                            : 0,
    };
  }

  if (!biometricData) return;

  try {
    const ingestRes = await fetch(
      `${mlUrl}/ingest?user_id=${encodeURIComponent(user.id)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...mlServiceHeaders() },
        body: JSON.stringify(biometricData),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!ingestRes.ok) {
      console.warn(`[terra] ML ingest failed: ${ingestRes.status}`);
      return;
    }

    const result = await ingestRes.json() as { alert_level?: string; anomalies?: string[] };

    // Persist to BiometricReading table
    await prisma.biometricReading.create({
      data: {
        userId:              user.id,
        heartRateResting:    biometricData.heart_rate_resting,
        hrvRmssd:            biometricData.hrv_rmssd,
        oxygenSaturation:    biometricData.spo2,
        skinTempOffset:      biometricData.skin_temp_offset,
        respiratoryRate:     biometricData.respiratory_rate,
        stepCount:           biometricData.step_count,
        activeCalories:      biometricData.active_calories,
        sleepDurationHours:  biometricData.sleep_duration_hours,
        source:              'wearable',
        deviceType:          payload?.user?.provider ?? 'terra',
        alertLevel:          result.alert_level ?? 'GREEN',
        anomalies:           result.anomalies ?? [],
      },
    });

    console.log(`[terra] Ingested ${event} data for user ${user.id}: ${result.alert_level}`);
  } catch (err) {
    console.error('[terra] ML ingest error:', err);
  }
}
