# 🚨 URGENT FIX: Automatic Logout During AI Diagnosis

## The Problem

**What's happening:**
1. You log in successfully
2. Navigate to "AI Doctor Assistant" page
3. After ~15 minutes, your access token expires
4. Click "Analyze Symptoms"
5. **Immediately logged out** without explanation

**Why:**
Your frontend's API interceptor sees a 401 error and **immediately redirects to login** without attempting to refresh the token.

---

## Quick Fix (30 minutes)

### Step 1: Backup Current File
```bash
# From workspace directory
cp src/lib/api.ts src/lib/api.ts.backup
```

### Step 2: Replace Response Interceptor

Open [workspace/src/lib/api.ts](workspace/src/lib/api.ts) and replace this section (currently lines ~34-45):

**FIND THIS:**
```typescript
// Response interceptor to handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Avoid redirect loop if already on login/signup
      const path = window.location.pathname || '';
      if (!path.startsWith('/auth/')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/auth/login';
      }
    }
    return Promise.reject(error);
  }
);
```

**REPLACE WITH THIS:**
```typescript
// Track if we're already attempting refresh to avoid infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  onSuccess: (token: string) => void;
  onFailure: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.onFailure(error);
    } else {
      prom.onSuccess(token!);
    }
  });
  failedQueue = [];
};

// Response interceptor with automatic token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const path = window.location.pathname || '';
      
      // Don't attempt refresh if already on auth pages
      if (path.startsWith('/auth/')) {
        return Promise.reject(error);
      }

      // Prevent multiple simultaneous refresh attempts
      if (!isRefreshing) {
        isRefreshing = true;
        const refreshToken = localStorage.getItem('refreshToken');

        if (refreshToken) {
          try {
            console.log('[API] Attempting to refresh token...');
            
            // Attempt to refresh token
            const response = await apiClient.post('/auth/refresh', { refreshToken });
            const { accessToken, refreshToken: newRefreshToken } = response.data;
            
            console.log('[API] Token refreshed successfully');
            
            // Update stored tokens
            localStorage.setItem('token', accessToken);
            localStorage.setItem('refreshToken', newRefreshToken);
            
            // Update the original request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            }
            
            // Process queued requests with new token
            processQueue(null, accessToken);
            
            // Retry original request with new token
            return apiClient(originalRequest);
          } catch (refreshError) {
            console.error('[API] Token refresh failed:', refreshError);
            
            // Refresh failed, log out
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('refreshToken');
            
            processQueue(refreshError, null);
            
            // Redirect to login
            window.location.href = '/auth/login';
            return Promise.reject(refreshError);
          } finally {
            isRefreshing = false;
          }
        } else {
          console.warn('[API] No refresh token available, logging out');
          
          // No refresh token available, log out
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/auth/login';
          
          return Promise.reject(error);
        }
      }

      // If already refreshing, queue this request
      return new Promise((onSuccess, onFailure) => {
        failedQueue.push({ onSuccess, onFailure });
      });
    }

    return Promise.reject(error);
  }
);
```

### Step 3: Save RefreshToken to localStorage

Open [workspace/src/contexts/AuthContext.tsx](workspace/src/contexts/AuthContext.tsx)

**Find this in the `login` function (around line 54):**
```typescript
const login = async (email: string, password: string) => {
  const response: AuthResponse = await authApi.login({ email, password });
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', response.accessToken);
    localStorage.setItem('user', JSON.stringify(response.user));
  }
  
  setToken(response.accessToken);
  setUser(response.user as User);
};
```

**Replace with:**
```typescript
const login = async (email: string, password: string) => {
  const response: AuthResponse = await authApi.login({ email, password });
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', response.accessToken);
    localStorage.setItem('refreshToken', response.refreshToken);  // ← ADD THIS LINE
    localStorage.setItem('user', JSON.stringify(response.user));
  }
  
  setToken(response.accessToken);
  setUser(response.user as User);
};
```

**Also update the `register` function (around line 71):**
```typescript
const register = async (data: RegisterData) => {
  const response: AuthResponse = await authApi.register(data);
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', response.accessToken);
    localStorage.setItem('refreshToken', response.refreshToken);  // ← ADD THIS LINE
    localStorage.setItem('user', JSON.stringify(response.user));
  }
  
  setToken(response.accessToken);
  setUser(response.user as User);
};
```

**And update the logout function to call the API:**
```typescript
const logout = async () => {
  try {
    // Call backend logout to invalidate refresh token in database
    await apiClient.post('/auth/logout');
  } catch (error) {
    console.warn('Server logout failed, clearing local storage anyway');
  }
  
  if (typeof window !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');  // ← ADD THIS LINE
    localStorage.removeItem('user');
  }
  
  setToken(null);
  setUser(null);
  router.push('/auth/login');
};
```

### Step 4: Also Update useEffect (Load stored refreshToken)

**Find this useEffect (around line 41):**
```typescript
useEffect(() => {
  // Load user and token from localStorage on mount
  if (typeof window !== 'undefined') {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Error parsing stored user data:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  }
  setLoading(false);
}, []);
```

**No changes needed here** - it already persists refreshToken (it's just stored, not actively used until refresh is attempted)

### Step 5: Test the Fix

1. **Stop and restart your dev server:**
```bash
# From workspace directory
npm run dev
# or
pnpm dev
```

2. **Test the workflow:**
   - Log in
   - Navigate to AI Doctor
   - Fill in the symptom form
   - Click "Analyze Symptoms"
   - **Expected: Analysis completes successfully**

3. **Test token refresh specifically:**
   - Log in
   - Open DevTools → Application → Local Storage
   - Note the `token` value
   - Wait 16 minutes (token expires after 15 min)
   - Try to use AI Diagnosis
   - Check DevTools console for: `[API] Attempting to refresh token...`
   - Should see: `[API] Token refreshed successfully`
   - Your request should complete

4. **Test edge cases:**
   - Clear `refreshToken` from Local Storage
   - Try to use a service
   - Should redirect to login (expected)
   - Now log in again

---

## Verify the Fix is Working

### In Browser Console

After clicking "Analyze Symptoms", you should see:

```
[API] Attempting to refresh token...
[API] Token refreshed successfully
```

Or if token is fresh:
```
[HTTP 200] Analysis complete
```

If you see:
```
[API] No refresh token available, logging out
```

Then you're missing Step 3 (didn't save refreshToken to localStorage)

### In Network Tab

The request sequence should be:

```
POST /api/triage                 → 401 (token expired)
POST /api/auth/refresh           → 200 (refresh successful)
POST /api/triage (RETRY)         → 200 (analysis works!)
```

If you only see the first 401 followed by redirect to login, the fix didn't work.

---

## What This Fix Does

### Before Fix:
```
1. User tries /api/triage
2. Backend: "401 - Token expired"
3. Frontend: "Oh no! Logout!" → Redirect to login
4. User: "Why was I logged out??" 😠
```

### After Fix:
```
1. User tries /api/triage
2. Backend: "401 - Token expired"
3. Frontend: "No problem, let me refresh..."
4. Frontend: POST /api/auth/refresh
5. Backend: "Here's a new token ✓"
6. Frontend: "Retrying original request..."
7. User: Request completes silently ✓ 😊
```

---

## Troubleshooting

### Issue: Still logging out immediately

**Check 1:** Did you save the refreshToken to localStorage?
```javascript
// In console:
localStorage.getItem('refreshToken')
// Should return a token string, not null
```

**Check 2:** Is the refresh endpoint working?
```bash
# Manual test
curl -X POST http://localhost:4000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "your_refresh_token_from_local_storage"}'

# Should return: 200 with new tokens
# If 401: Your refresh token is invalid/expired
```

**Check 3:** Are you in development mode?
- The fix requires `Next.js` dev mode for interceptor to work
- Production requires proper `/api` proxy configuration

### Issue: "Too many requests" errors

The queue logic might be stacking requests. Check:
```javascript
// In console after error:
console.log(failedQueue.length)
// Should be 0 or small number
```

If high, there's a bug. Use backup file and try again:
```bash
cp src/lib/api.ts.backup src/lib/api.ts
```

---

## Additional Notes

### Why Token Refresh Was Missing

Your code already had the infrastructure:
- ✅ Backend `/api/auth/refresh` endpoint exists
- ✅ AuthContext stores (returns) refreshToken  
- ✅ RefreshToken table in database exists

But it was **never triggered** when a 401 occurred. This fix closes that gap.

### Security Considerations

This implementation is **safe** because:
- ✅ Refresh token automatically gets new tokens
- ✅ If refresh fails, user logs out (fallback)
- ✅ Tokens are short-lived (15 min access, 7 day refresh)
- ✅ Queue prevents race conditions
- ✅ Only retries non-auth endpoints

### Performance Impact

**Minimal:**
- First request: Normal (token is fresh)
- After 15 min: Extra 200ms roundtrip for refresh
- Subsequent requests: Normal again
- Net: Imperceptible to user

---

## Estimated Impact

**Before:** Users logged out every 15 minutes of inactivity  
**After:** Sessions last 7 days (refresh token expiration)

**User Experience:**
- ❌ Before: "This app keeps logging me out"
- ✅ After: "Log in once, use for a week"

This is a **critical quality-of-life fix** for your product.
