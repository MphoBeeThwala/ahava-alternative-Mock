import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, requireRole } from '../middleware/auth';
import { MapsUnavailableError, autocompleteAddress, mapsEnabled, placeDetails } from '../services/googleMaps';

/**
 * Address search for booking, proxied so the Google key stays on the server.
 * Every route degrades the same way: when maps are off, capped or failing, the
 * client gets { available: false } and keeps the manual address field.
 */
const router = Router();

// Per signed-in user, on top of the monthly cap in services/googleMaps.ts.
const perUser = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthenticatedRequest).user?.id ?? 'anonymous',
  message: { error: 'Too many address lookups. Please type the full address instead.' },
});

const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

// Lets the client decide whether to show the search box at all.
router.get('/config', (_req, res) => res.json({ success: true, enabled: mapsEnabled() }));

router.get('/autocomplete', requireRole([UserRole.PATIENT]), perUser, async (req, res, next) => {
  try {
    const input = typeof req.query.input === 'string' ? req.query.input.trim() : '';
    const sessionToken = typeof req.query.sessionToken === 'string' ? req.query.sessionToken : '';
    if (input.length < 4 || input.length > 200) return res.status(400).json({ error: 'Type at least 4 characters of the address' });
    if (!SESSION_TOKEN.test(sessionToken)) return res.status(400).json({ error: 'Invalid session token' });
    try {
      return res.json({ success: true, available: true, suggestions: await autocompleteAddress(input, sessionToken) });
    } catch (err) {
      if (err instanceof MapsUnavailableError) return res.json({ success: true, available: false, suggestions: [] });
      throw err;
    }
  } catch (error) { return next(error); }
});

router.get('/details', requireRole([UserRole.PATIENT]), perUser, async (req, res, next) => {
  try {
    const placeId = typeof req.query.placeId === 'string' ? req.query.placeId : '';
    const sessionToken = typeof req.query.sessionToken === 'string' ? req.query.sessionToken : '';
    if (!PLACE_ID.test(placeId)) return res.status(400).json({ error: 'Invalid place' });
    if (!SESSION_TOKEN.test(sessionToken)) return res.status(400).json({ error: 'Invalid session token' });
    try {
      return res.json({ success: true, available: true, place: await placeDetails(placeId, sessionToken) });
    } catch (err) {
      if (err instanceof MapsUnavailableError) return res.json({ success: true, available: false });
      throw err;
    }
  } catch (error) { return next(error); }
});

export default router;
