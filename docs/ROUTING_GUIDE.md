# Routing & API Error Prevention Guide

## Overview
This document explains how the platform prevents routing conflicts and API errors.

## Architecture

### 1. API Routes (Worker)
- **Location**: All `/api/*` routes are handled by `src/worker/index.ts`
- **Handler**: Cloudflare Workers via `@cloudflare/vite-plugin`
- **Behavior**: API routes are processed BEFORE React Router sees them
- **No React Router interference**: API routes should NEVER be defined in React Router

### 2. Frontend Routes (React Router)
- **Location**: `src/react-app/App.tsx`
- **Handler**: React Router (BrowserRouter)
- **Routes**: Only frontend routes (no `/api/*` routes)
- **Catch-all**: `*` route handles unmatched routes

## Key Principles

### ✅ DO:
1. **API calls**: Use `src/react-app/lib/api.ts` utility
2. **Error handling**: API utility handles 401, redirects, etc.
3. **Auth**: Always include `credentials: "include"` (handled by API utility)
4. **Redirects**: Let the API utility handle redirects automatically

### ❌ DON'T:
1. **Never add `/api/*` routes to React Router**
2. **Don't use raw `fetch()` - use API utility**
3. **Don't manually handle redirects - API utility does it**

## API Utility (`src/react-app/lib/api.ts`)

### Features:
- ✅ Automatic cookie handling (`credentials: "include"`)
- ✅ Redirect handling (302/307/301)
- ✅ 401 error handling (auto-redirect to home)
- ✅ Proper error messages
- ✅ Type-safe responses

### Usage:
```typescript
import { apiGet, apiPost } from "@/react-app/lib/api";

// GET request
const data = await apiGet<Profile>("/api/profile");

// POST request
const result = await apiPost<Response>("/api/appointments", { data });
```

## OAuth Flow

### How it works:
1. User clicks "Sign In" → calls `/api/auth/sign-in/google?json=true`
2. Worker returns redirect URL as JSON
3. Client redirects to Google OAuth
4. Google redirects to `/api/auth/callback/google?code=...&state=...`
5. **Worker handles callback** (NOT React Router)
6. Worker redirects to `/onboarding` (HTML redirect)
7. Client navigates to onboarding

### Important:
- `/api/auth/callback/google` is **NOT** in React Router
- Worker handles it and returns HTML redirect
- This prevents React Router from intercepting API routes

## Error Handling

### 401 Unauthorized:
- API utility automatically redirects to `/` if 401
- User can re-authenticate

### 404 Not Found:
- React Router catch-all (`*` route) shows NotFound component
- Only applies to frontend routes
- API routes return JSON errors

### Network Errors:
- API utility throws `ApiError` with message, status, and data
- Components can catch and display errors

## Testing Checklist

- [ ] API routes work without React Router interference
- [ ] OAuth callback redirects correctly
- [ ] 401 errors redirect to home
- [ ] 404 routes show NotFound page
- [ ] All API calls use the API utility
- [ ] No `/api/*` routes in React Router
- [ ] Cookies are included in all requests
- [ ] Redirects work correctly

## Common Issues & Solutions

### Issue: "No routes matched location /api/..."
**Solution**: Remove `/api/*` routes from React Router. API routes are handled by the worker.

### Issue: 401 errors on protected routes
**Solution**: Ensure API utility is used (includes cookies automatically). Check auth middleware in worker.

### Issue: OAuth callback shows blank page
**Solution**: Ensure `/api/auth/callback/google` is NOT in React Router. Worker handles it.

### Issue: Redirects not working
**Solution**: Use API utility - it handles redirects automatically.

## Files Modified

1. **`src/react-app/lib/api.ts`** - Centralized API client
2. **`src/react-app/App.tsx`** - Removed `/api/*` routes, added catch-all
3. **`src/react-app/pages/AuthCallback.tsx`** - Uses API utility
4. **`src/worker/index.ts`** - OAuth callback returns HTML redirect
5. **`src/react-app/components/NotFound.tsx`** - 404 page component

