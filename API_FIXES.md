# API Endpoint Fixes

## Issues Fixed

### 1. **Nurse Endpoints (404 Errors)**
   - ❌ **Problem**: `/nurse/me` and `/nurse/visits` endpoints don't exist
   - ✅ **Solution**: 
     - Use `/auth/me` for nurse profile (returns user with location data)
     - Use `/visits` for nurse visits (automatically filters by role)

### 2. **Bookings Endpoint (500 Error)**
   - ❌ **Problem**: `/bookings/me` doesn't exist, and GET `/bookings` was missing `authMiddleware`
   - ✅ **Solution**:
     - Use `/bookings` which automatically filters by role
     - Added `authMiddleware` to GET `/bookings` route
     - Fixed cancel endpoint to use PATCH instead of POST

### 3. **API Client Updates**
   - Updated `nurseApi.getProfile()` to use `/auth/me`
   - Updated `nurseApi.getMyVisits()` to use `/visits`
   - Updated `bookingsApi.getMyBookings()` to use `/bookings`
   - Updated `bookingsApi.cancel()` to use PATCH method
   - Updated `visitsApi.getMyVisits()` to use `/visits`

## Backend Changes

### `apps/backend/src/routes/bookings.ts`
- Added `authMiddleware` import
- Added `authMiddleware` to GET `/bookings` route
- Added `authMiddleware` to GET `/bookings/:id` route

### `apps/backend/src/routes/auth.ts`
- Updated `/auth/me` to include `isAvailable`, `lastKnownLat`, `lastKnownLng`, `lastLocationUpdate` fields

## Frontend Changes

### `workspace/src/lib/api.ts`
- Fixed `nurseApi.getProfile()` to use `/auth/me` and parse response correctly
- Fixed `nurseApi.getMyVisits()` to use `/visits`
- Fixed `bookingsApi.getMyBookings()` to use `/bookings`
- Fixed `bookingsApi.cancel()` to use PATCH method

### `workspace/src/app/nurse/dashboard/page.tsx`
- Updated `loadProfile()` to handle new response structure from `/auth/me`

## Testing

After these fixes, the following should work:

1. ✅ Nurse dashboard loads profile from `/auth/me`
2. ✅ Nurse dashboard loads visits from `/visits`
3. ✅ Patient dashboard loads bookings from `/bookings`
4. ✅ All endpoints properly authenticated

## Endpoints Summary

| Frontend Call | Backend Endpoint | Status |
|--------------|------------------|--------|
| `nurseApi.getProfile()` | `GET /api/auth/me` | ✅ Fixed |
| `nurseApi.getMyVisits()` | `GET /api/visits` | ✅ Fixed |
| `bookingsApi.getMyBookings()` | `GET /api/bookings` | ✅ Fixed |
| `bookingsApi.cancel()` | `PATCH /api/bookings/:id/cancel` | ✅ Fixed |
| `visitsApi.getMyVisits()` | `GET /api/visits` | ✅ Fixed |

