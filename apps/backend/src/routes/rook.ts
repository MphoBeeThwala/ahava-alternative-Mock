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
import { withResilientHttp } from '../services/resilientHttp';
import { mlServiceHeaders } from '../services/mlServiceAuth';

const router: Router = Router();

function envFirstNonEmpty(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || '').trim();
    if (value.length > 0) return value;
  }
  return '';
}

function resolveRookBaseUrl(): string {
  const fallback = 'https://api.rook-connect.com/api/v1';
  const raw = (process.env.ROOK_BASE_URL || '').trim();
  if (!raw) return fallback;

  // Normalize trailing slash noise.
  let normalized = raw.replace(/\/+$/, '');

  // Legacy host migration safety net.
  // Some deployments still point at deprecated rook-health domains.
  if (/rook-health\.com/i.test(normalized)) {
    const sandboxLike = /sandbox|review/i.test(normalized);
    normalized = sandboxLike
      ? 'https://api.rook-connect.review/api/v1'
      : 'https://api.rook-connect.com/api/v1';
    console.warn(`[rook] ROOK_BASE_URL used deprecated host; auto-mapped to ${normalized}`);
  }

  // If only host is supplied, add the expected API base path.
  try {
    const parsed = new URL(normalized);
    const rookHostPattern = /api\.rook-connect\.(com|review)$/i;

    // Guardrail: webhook URLs are inbound to *our* backend and cannot be used as ROOK API base URLs.
    // A common misconfiguration is setting ROOK_BASE_URL to ".../webhooks/rook".
    if (/\/webhooks\/rook(\/|$)/i.test(parsed.pathname)) {
      const inferred = 'https://api.rook-connect.review/api/v1';
      console.error(
        `[rook] ROOK_BASE_URL appears to be a webhook endpoint (${normalized}). ` +
        `Using ${inferred} instead. Set ROOK_BASE_URL to a ROOK API host.`
      );
      return inferred;
    }
    if (!rookHostPattern.test(parsed.hostname)) {
      const inferred = /sandbox|review/i.test(raw)
        ? 'https://api.rook-connect.review/api/v1'
        : 'https://api.rook-connect.com/api/v1';
      console.error(
        `[rook] ROOK_BASE_URL host "${parsed.hostname}" is not a supported ROOK API host. ` +
        `Using ${inferred}.`
      );
      return inferred;
    }

    if (
      rookHostPattern.test(parsed.hostname) &&
      !/\/api\/v1$/i.test(parsed.pathname)
    ) {
      normalized = `${parsed.origin}/api/v1`;
    }
  } catch {
    console.warn(`[rook] Invalid ROOK_BASE_URL "${raw}", using default ${fallback}`);
    return fallback;
  }

  return normalized;
}

// Current ROOK documented API hosts:
// - Production: https://api.rook-connect.com/api/v1
// - Sandbox:    https://api.rook-connect.review/api/v1
// Keep override support via ROOK_BASE_URL and legacy compatibility fallbacks.
const ROOK_CLIENT_UUID = envFirstNonEmpty('ROOK_CLIENT_UUID');
const ROOK_SECRET_KEY = envFirstNonEmpty('ROOK_SECRET_KEY', 'ROOK_API_KEY');
const ROOK_DEFAULT_DATA_SOURCE = envFirstNonEmpty('ROOK_DEFAULT_DATA_SOURCE') || 'Fitbit';
const ROOK_ENABLE_LEGACY_SESSION_FALLBACK = process.env.ROOK_ENABLE_LEGACY_SESSION_FALLBACK === 'true';

function rookHeaders() {
  const basicAuth = Buffer.from(`${ROOK_CLIENT_UUID}:${ROOK_SECRET_KEY}`).toString('base64');
  return {
    'Content-Type': 'application/json',
    // ROOK currently uses Basic auth with client_uuid:secret_key.
    Authorization: `Basic ${basicAuth}`,
    // Keep legacy headers for backward compatibility.
    'x-api-key': ROOK_SECRET_KEY,
    'x-client-uuid': ROOK_CLIENT_UUID,
    // ROOK docs specify User-Agent as mandatory.
    'User-Agent': 'Ahava-Healthcare/1.0',
  };
}

type RookApiError = {
  error?: string;
  exception?: string;
  path?: string;
  method?: string;
};

function missingRookCredentials(): boolean {
  return !ROOK_CLIENT_UUID || !ROOK_SECRET_KEY;
}

function isRookAuthFailure(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 401 || status === 403;
}

function toRookErrorPayload(err: unknown): RookApiError | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data;
  if (data && typeof data === 'object') {
    return data as RookApiError;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// POST /api/rook/connect — generate connection URL
// ---------------------------------------------------------------------------
router.post('/connect', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rookBaseUrl = resolveRookBaseUrl();

    if (missingRookCredentials()) {
      return res.status(503).json({
        success: false,
        error: 'ROOK is not configured on server',
        code: 'ROOK_CONFIG_MISSING',
        hint: 'Set ROOK_CLIENT_UUID and ROOK_SECRET_KEY in backend environment variables',
      });
    }

    const userId = (req as any).user.id;
    const dataSource: string = req.body?.dataSource || ROOK_DEFAULT_DATA_SOURCE;
    const redirectBase =
      process.env.ROOK_REDIRECT_URL ||
      (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/patient/wearable-connected` : undefined);

    // Preferred current flow: /authorizer endpoint per ROOK docs.
    try {
      const url = `${rookBaseUrl}/user_id/${encodeURIComponent(userId)}/data_source/${encodeURIComponent(dataSource)}/authorizer`;
      const rookRes = await withResilientHttp('rook-authorizer', (timeoutMs) =>
        axios.get(url, {
          headers: rookHeaders(),
          params: redirectBase ? { redirect_url: redirectBase } : undefined,
          timeout: timeoutMs,
        })
      );
      const data = rookRes.data || {};
      const authorizationUrl = data.authorization_url || data.url || data.link_url;

      if (authorizationUrl) {
        res.json({
          success: true,
          url: authorizationUrl,
          dataSource,
          authorized: Boolean(data.authorized),
        });
        return;
      }

      // Some ROOK responses indicate the user is already authorized and do not
      // include a new authorization URL. Treat this as a successful connected state.
      if (Boolean(data.authorized)) {
        await prisma.user.update({
          where: { id: userId },
          data: { rookUserId: userId } as any,
        });

        return res.json({
          success: true,
          url: null,
          dataSource,
          authorized: true,
          alreadyConnected: true,
        });
      }

      return res.status(502).json({
        success: false,
        error: 'ROOK did not return an authorization URL',
        code: 'ROOK_AUTHORIZE_URL_MISSING',
      });
    } catch (authorizerError: any) {
      const rookError = toRookErrorPayload(authorizerError);
      if (isRookAuthFailure(authorizerError)) {
        console.error(`[rook] Authorizer auth failed on ${rookBaseUrl}:`, rookError || authorizerError.message);
        return res.status(502).json({
          success: false,
          error: 'ROOK credentials rejected by upstream API',
          code: 'ROOK_INVALID_CREDENTIALS',
          hint: 'Verify ROOK_CLIENT_UUID and ROOK_SECRET_KEY match the selected ROOK environment (Sandbox vs Production)',
          upstream: {
            error: rookError?.error,
            exception: rookError?.exception,
            path: rookError?.path,
          },
        });
      }

      // Optional legacy fallback for older integrations only.
      if (!ROOK_ENABLE_LEGACY_SESSION_FALLBACK) {
        console.error(`[rook] /authorizer failed on ${rookBaseUrl}:`, rookError || authorizerError.message);
        return res.status(502).json({
          success: false,
          error: 'Failed to create ROOK authorizer URL',
          code: 'ROOK_AUTHORIZE_FAILED',
          hint: 'Check ROOK_BASE_URL and ROOK credentials',
          upstream: {
            error: rookError?.error,
            exception: rookError?.exception,
            path: rookError?.path,
          },
        });
      }

      console.warn(`[rook] /authorizer failed on ${rookBaseUrl}; attempting legacy /auth/session fallback`);
    }

    // Legacy fallback flow (older ROOK integrations). Disabled by default.
    const legacyBody = { user_id: userId };
    const legacyRes = await withResilientHttp('rook-legacy-session', (timeoutMs) =>
      axios.post(`${rookBaseUrl}/auth/session`, legacyBody, {
        headers: rookHeaders(),
        timeout: timeoutMs,
      })
    );
    const legacyData = legacyRes.data || {};
    const legacyUrl = legacyData.url || legacyData.link_url;

    if (!legacyUrl) {
      return res.status(502).json({ success: false, error: 'ROOK authorization URL missing from response' });
    }

    res.json({
      success: true,
      url: legacyUrl,
      sessionId: legacyData.session_id,
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
    const signatureRequirementRaw = (process.env.WEBHOOK_SIGNATURE_REQUIRED ?? '')
      .trim()
      .toLowerCase();
    // Secure-by-default in production, but allow explicit temporary override with WEBHOOK_SIGNATURE_REQUIRED=false.
    const enforceSignedWebhooks =
      signatureRequirementRaw === 'true' ||
      (signatureRequirementRaw !== 'false' && process.env.NODE_ENV === 'production');
    if (!enforceSignedWebhooks && process.env.NODE_ENV === 'production') {
      console.warn('[rook] Webhook signature verification is DISABLED in production');
    }
    // ROOK sends HMAC in X-ROOK-HASH header. Keep legacy support for rook-signature.
    const signatureRaw =
      (req.headers['x-rook-hash'] as string | undefined) ||
      (req.headers['rook-signature'] as string | undefined);
    const signature = (signatureRaw || '').trim();

    // Prefer explicit webhook secret, but also keep ROOK API secret as fallback.
    // Some ROOK setups sign with API secret; others with explicit webhook secret.
    const candidateSecrets = [
      (process.env.ROOK_WEBHOOK_SECRET || '').trim(),
      (ROOK_SECRET_KEY || '').trim(),
    ].filter(Boolean);
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (enforceSignedWebhooks && candidateSecrets.length === 0) {
      console.error('[rook] Missing ROOK secret for webhook signature verification');
      res.status(503).json({ error: 'ROOK webhook signature verification is not configured' });
      return;
    }
    if (enforceSignedWebhooks && (!signature || !rawBody)) {
      res.status(401).json({ error: 'Missing webhook signature' });
      return;
    }

    // HMAC verification (Compliance-first)
    if (candidateSecrets.length > 0 && signature && rawBody) {
      const signatureNormalized = signature.toLowerCase().startsWith('sha256=')
        ? signature.slice(7)
        : signature;

      let signaturesMatch = false;

      for (const secret of candidateSecrets) {
        const expectedHex = crypto
          .createHmac('sha256', secret)
          .update(rawBody)
          .digest('hex');

        const expectedB64 = crypto
          .createHmac('sha256', secret)
          .update(rawBody)
          .digest('base64');

        const candidates = [expectedHex, expectedB64];
        for (const candidate of candidates) {
          const signatureBuffer = Buffer.from(signatureNormalized);
          const expectedBuffer = Buffer.from(candidate);
          if (
            signatureBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
          ) {
            signaturesMatch = true;
            break;
          }
        }

        if (signaturesMatch) break;
      }

      if (!signaturesMatch) {
        console.warn(
          `[rook] Webhook HMAC verification failed (sig_len=${signatureNormalized.length}, raw_len=${rawBody.length})`
        );
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
  const category = String(payload?.category || payload?.data_structure || '').toLowerCase();

  // 1. Handle Production Structure (payload.data)
  if (payload.data) {
    const data = payload.data;
    if (
      category === 'body' ||
      category === 'physical' ||
      category === 'body_summary' ||
      category === 'physical_summary' ||
      category === 'activity' ||
      category === 'activity_event' ||
      category === 'steps_event'
    ) {
      biometricData = {
        timestamp:            new Date().toISOString(),
        heart_rate_resting:   data?.heart_rate?.resting_hr || data?.heart_rate?.avg_hr || 70,
        hrv_rmssd:            data?.heart_rate?.hrv_rmssd || 40,
        spo2:                 data?.oxygen_saturation?.avg || 97,
        respiratory_rate:     data?.respiration?.rate || 16,
        step_count:           data?.activity?.steps || data?.steps || data?.step_count || 0,
        active_calories:      data?.activity?.active_calories || data?.active_calories || 0,
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
      step_count:           summary.body_metrics?.steps_int || summary.activity?.steps_int || 0,
      active_calories:      summary.nutrition?.calories_intake_kcal_float || 0,
    };
  }

  if (biometricData) {
    try {
      console.log(`[rook] Forwarding data to ML for user ${userId}`);
      await withResilientHttp('rook-ml-ingest', (timeoutMs) =>
        axios.post(`${mlUrl}/ingest?user_id=${encodeURIComponent(userId)}`, biometricData, {
          headers: mlServiceHeaders(),
          timeout: timeoutMs,
        }),
        {
          retries: 1,
          circuitThreshold: 3,
          circuitOpenMs: 10000,
        }
      );
    } catch (err: any) {
      console.error('[rook] ML ingestion failed:', err.message);
    }
  }
}
