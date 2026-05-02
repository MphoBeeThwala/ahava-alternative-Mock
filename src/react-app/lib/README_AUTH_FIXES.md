# Authentication Fixes Implementation

## Problems Fixed

### 1. Token Refresh Race Condition
**Problem**: Multiple simultaneous API calls were getting 401s and triggering multiple token refresh attempts simultaneously.

**Solution**: Implemented singleton token refresh in `tokenManager.ts`:
- `refreshPromise` ensures only one refresh request runs at a time
- All subsequent refresh calls wait for the existing promise
- Promise is reset after completion (success or failure)

### 2. Request Queue During Token Refresh
**Problem**: Failed requests during token refresh were not being retried.

**Solution**: Implemented request queue in `apiInterceptor.ts`:
- `failedQueue` holds pending requests during refresh
- `isRefreshing` flag prevents multiple refresh cycles
- All queued requests are retried automatically after successful refresh
- Clean error handling and forced logout on refresh failure

### 3. "Already on Patient Page" Bug
**Problem**: App was rendering routes before authentication state was validated, causing users to land on patient page without being logged in.

**Solution**: Added `AuthGuard` component in `App.tsx`:
- `authReady` state in auth context prevents rendering until auth is validated
- Loading screen shows during auth validation
- Routes only render after auth state is confirmed

### 4. Deprecated Feature Collector Warning
**Status**: Third-party issue - feature_collector.js appears to be loaded from external service
**Note**: This needs to be addressed by updating the third-party analytics service to use the new initialization format

## New Architecture

### Token Manager (`tokenManager.ts`)
```typescript
// Singleton refresh pattern
export async function refreshTokenOnce(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  // ... refresh logic
}
```

### API Interceptor (`apiInterceptor.ts`)
```typescript
// Automatic retry with queue
export async function authenticatedFetch(url: string, options: RequestInit) {
  // ... handles 401s, queues requests, retries after refresh
}
```

### Auth Context Updates
- Added `authReady` state to prevent premature rendering
- Uses `apiCall` from interceptor for all API requests
- Validates auth state before allowing route rendering

### App Router Guard
```typescript
function AuthGuard({ children }) {
  const { authReady } = useAuth();
  if (!authReady) return <LoadingScreen />;
  return <>{children}</>;
}
```

## Migration Guide

### For New API Calls
Use the new `apiCall` helper instead of raw fetch:

```typescript
// Before
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
});

// After
import { apiCall } from './apiInterceptor';
const data = await apiCall<ResponseType>(url, options);
```

### For Existing API Calls
The auth context has been updated to use the new interceptor automatically. No changes needed for existing auth methods.

## Testing

1. **Token Refresh Race Condition**: 
   - Open multiple tabs simultaneously
   - Verify only one refresh request is made
   - Check that all tabs recover after refresh

2. **Auth Guard**:
   - Clear localStorage and refresh
   - Verify loading screen shows before routes
   - Confirm no direct access to protected routes

3. **Request Queue**:
   - Trigger multiple API calls with expired token
   - Verify all requests are queued and retried after refresh

## Files Modified

- `src/react-app/lib/tokenManager.ts` (new)
- `src/react-app/lib/apiInterceptor.ts` (new)
- `src/react-app/lib/auth-context.tsx` (updated)
- `src/react-app/App.tsx` (updated)

## Benefits

1. **No more 401 storms** - Single refresh request handles all expired tokens
2. **Automatic retry** - Failed requests are transparently retried
3. **Clean auth flow** - Users never see partial auth states
4. **Better UX** - Loading screens instead of broken pages
5. **Robust error handling** - Graceful logout on auth failures
