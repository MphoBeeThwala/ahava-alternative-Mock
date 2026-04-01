import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import Joi from 'joi';
import prisma from '../lib/prisma';

const router: Router = Router();

// Validation
const updateLocationSchema = Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    isAvailable: Joi.boolean().optional(),
});

const searchSchema = Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
    radiusKm: Joi.number().default(10), // Default 10km
});

// Toggle Availability & Update Location
router.post('/availability', rateLimiter, authMiddleware, async (req, res, next) => {
    try {
        const { error, value } = updateLocationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { lat, lng, isAvailable } = value;
        const userId = (req as AuthenticatedRequest).user!.id;

        // Update user
        const user = await prisma.user.update({
            where: { id: userId },
            data: {
                lastKnownLat: lat,
                lastKnownLng: lng,
                lastLocationUpdate: new Date(),
                ...(isAvailable !== undefined && { isAvailable }),
            },
            select: {
                id: true,
                isAvailable: true,
                lastLocationUpdate: true,
            },
        });

        res.json({ success: true, user });
    } catch (error) {
        next(error);
    }
});

// Find nearby nurses
router.get('/nearby', authMiddleware, async (req, res, next) => {
    try {
        const { error, value } = searchSchema.validate(req.query);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { lat, lng, radiusKm } = value;
        const latDelta = radiusKm / 111;
        const cosLat = Math.cos((lat * Math.PI) / 180);
        const lngDelta = radiusKm / (111 * (Math.abs(cosLat) < 0.00001 ? 0.00001 : cosLat));
        const minLat = Math.max(-90, lat - latDelta);
        const maxLat = Math.min(90, lat + latDelta);
        const minLng = Math.max(-180, lng - lngDelta);
        const maxLng = Math.min(180, lng + lngDelta);
        const maxAgeMinutes = Math.max(1, parseInt(process.env.NURSE_LOCATION_MAX_AGE_MINUTES ?? '30', 10) || 30);
        const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

        const nurses = await prisma.user.findMany({
            where: {
                role: 'NURSE',
                isAvailable: true,
                isActive: true,
                lastKnownLat: { not: null, gte: minLat, lte: maxLat },
                lastKnownLng: { not: null, gte: minLng, lte: maxLng },
                lastLocationUpdate: { gte: since },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
                lastKnownLat: true,
                lastKnownLng: true,
                lastLocationUpdate: true,
            },
            take: 1000,
        });

        // Filter by Haversine distance
        const nearbyNurses = nurses.map(nurse => {
            const distance = getDistanceFromLatLonInKm(lat, lng, nurse.lastKnownLat!, nurse.lastKnownLng!);
            return { ...nurse, distance };
        }).filter(n => n.distance <= radiusKm)
            .sort((a, b) => a.distance - b.distance);

        res.json({ success: true, count: nearbyNurses.length, nurses: nearbyNurses });
    } catch (error) {
        next(error);
    }
});

// Haversine Formula
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg: number) {
    return deg * (Math.PI / 180);
}

export default router;
