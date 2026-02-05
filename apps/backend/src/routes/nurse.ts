import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import Joi from 'joi';

const router = Router();
const prisma = new PrismaClient();

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
router.post('/availability', authMiddleware, rateLimiter, async (req, res, next) => {
    try {
        const { error, value } = updateLocationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { lat, lng, isAvailable } = value;
        const userId = (req as any).user.userId;

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

        // Fetch all active nurses
        // Note: For production with millions of users, use PostGIS. 
        // For MVP with <1000 nurses, fetching all active nurses and filtering in memory is acceptable.
        const nurses = await prisma.user.findMany({
            where: {
                role: 'NURSE',
                isAvailable: true,
                isActive: true,
                lastKnownLat: { not: null },
                lastKnownLng: { not: null },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
                lastKnownLat: true,
                lastKnownLng: true,
            },
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
