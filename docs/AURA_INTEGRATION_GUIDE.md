# Aura Sandbox API Integration Guide

## Overview

The Ahava Healthcare Platform integrates with the Aura Sandbox API for real-time emergency alerts. When a healthcare worker triggers the panic button, the system sends an alert to Aura's emergency dispatch system with precise location data and user information.

---

## Configuration

### 1. Get Aura API Credentials

Contact Aura to get your sandbox/production API credentials:
- **Sandbox URL**: `https://sandbox.aura.co.za/api/v1`
- **Production URL**: `https://api.aura.co.za/api/v1`
- **API Key**: Obtained from Aura dashboard

### 2. Set Environment Variables

#### Development (.dev.vars)
```bash
VITE_AURA_API_URL=https://sandbox.aura.co.za/api/v1
VITE_AURA_API_KEY=your_aura_sandbox_api_key
```

#### Production (Cloudflare Pages)
```bash
# Via Cloudflare Dashboard:
# Pages -> Your Project -> Settings -> Environment Variables
# Add:
VITE_AURA_API_URL=https://api.aura.co.za/api/v1
VITE_AURA_API_KEY=your_aura_production_api_key
```

---

## API Integration

### Emergency Alert Payload

The system sends the following payload to Aura:

```typescript
{
  alertType: 'PANIC',
  severity: 'CRITICAL',
  location: {
    latitude: -26.1234,
    longitude: 28.5678,
    address: '123 Main St, Johannesburg',
    accuracy: 10 // meters
  },
  user: {
    id: 'user_12345',
    name: 'Nurse Jane Doe',
    phone: '+27821234567',
    email: 'jane@hospital.com'
  },
  details: {
    appointmentId: 456,
    notes: 'Emergency panic button triggered by healthcare worker',
    timestamp: '2026-01-25T10:30:00Z',
    deviceInfo: 'Windows 10 | en-US | Mozilla/5.0...'
  }
}
```

### Expected Response

```typescript
{
  success: true,
  alertId: 'AURA-123456',
  responseTime: 1234, // milliseconds
  dispatchInfo: {
    estimatedArrival: '8-12 minutes',
    responderType: 'Armed Response',
    trackingUrl: 'https://track.aura.co.za/alert/123456'
  },
  message: 'Emergency alert received and dispatch initiated'
}
```

---

## Features

### 1. High Accuracy Location
- Requests location with `enableHighAccuracy: true`
- Includes GPS accuracy in meters
- Reverse geocodes to human-readable address
- Falls back to coordinates if geocoding fails

### 2. Retry Logic
- Automatic retry with exponential backoff
- 3 retry attempts by default
- Handles rate limiting (429) and server errors (5xx)
- 30-second timeout per request

### 3. Fallback System
If Aura API is unavailable:
- Alert stored in local database (`/api/panic-alert`)
- Admin dashboard shows alert
- Emergency contacts notified via alternative channels
- User informed of backup mode

### 4. User Feedback
- Real-time loading states
- Success confirmation with alert ID
- Error handling with clear messages
- Backup mode indicator
- Direct emergency numbers displayed

---

## Usage in Components

### Basic Usage

```typescript
import PanicButton from '@/react-app/components/PanicButton';

// In your component
<PanicButton 
  appointmentId={123}
  userProfile={{
    id: 'user_123',
    name: 'Nurse Jane',
    phone: '+27821234567',
    email: 'jane@email.com'
  }}
/>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `appointmentId` | `number` | No | Current appointment ID (if applicable) |
| `userProfile` | `object` | No | User information for emergency context |

---

## API Endpoints Used

### 1. Send Emergency Alert
```
POST /emergency/alert
Authorization: Bearer {api_key}
Content-Type: application/json
```

### 2. Cancel Alert
```
POST /emergency/alert/{alertId}/cancel
Authorization: Bearer {api_key}
```

### 3. Check Alert Status
```
GET /emergency/alert/{alertId}/status
Authorization: Bearer {api_key}
```

---

## Error Handling

### Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `HTTP_401` | Unauthorized | Check API key configuration |
| `HTTP_403` | Forbidden | Verify API permissions |
| `HTTP_429` | Rate Limited | Automatic retry with backoff |
| `HTTP_500` | Server Error | Automatic retry, fallback if persistent |
| `NETWORK_ERROR` | Network issue | Use fallback system |
| `TIMEOUT` | Request timeout | Retry or use fallback |

### Fallback Behavior

When Aura API fails:
1. System logs error for debugging
2. Alert stored in local database
3. Admin dashboard notified
4. User sees backup mode indicator
5. Traditional emergency channels activated

---

## Testing

### Test in Development

```bash
# 1. Start dev server
npm run dev

# 2. Navigate to nurse dashboard
http://localhost:5173/nurse/dashboard

# 3. Click Emergency button

# 4. Check console for logs:
# - Location acquisition
# - API request payload
# - API response
# - Fallback activation (if API unavailable)
```

### Test API Validation

```typescript
import { validateAuraConfig } from '@/shared/actions';

const validation = validateAuraConfig();
if (!validation.valid) {
  console.error('Aura config error:', validation.error);
}
```

### Mock Aura API Response

For testing without real API:

```typescript
// In actions.ts, add mock mode
const MOCK_MODE = import.meta.env.VITE_AURA_MOCK === 'true';

if (MOCK_MODE) {
  return {
    success: true,
    alertId: 'MOCK-' + Date.now(),
    responseTime: 500,
    message: 'Mock alert sent',
  };
}
```

---

## Security Considerations

### 1. API Key Storage
- ✅ Stored in environment variables (not in code)
- ✅ Not exposed to browser (except frontend vars)
- ✅ Different keys for sandbox and production
- ⚠️ Frontend API calls visible in network tab

### 2. Data Privacy
- Location data sent only on user action
- User consent implied by button press
- Emergency context includes minimal PHI
- Audit trail maintained in local database

### 3. Authentication
- Bearer token authentication
- API key rotated regularly (recommended: quarterly)
- Different keys per environment
- Monitor API usage for anomalies

---

## Monitoring

### Key Metrics to Track

1. **Alert Success Rate**
   - Target: > 99%
   - Track: Successful alerts / Total attempts

2. **Response Time**
   - Target: < 2 seconds
   - Track: Time from button press to confirmation

3. **Fallback Usage**
   - Target: < 1%
   - Track: Fallback activations / Total alerts

4. **Location Accuracy**
   - Target: < 50 meters
   - Track: Average GPS accuracy

### Logging

```typescript
// Actions.ts includes comprehensive logging:
console.info('Emergency alert sent', { alertId, responseTime });
console.warn('Aura API failed, using fallback', { error });
console.error('Emergency alert failed', { error, payload });
```

---

## Production Checklist

Before going live:

- [ ] Aura production API key obtained
- [ ] Environment variables set in Cloudflare Pages
- [ ] Test emergency alert in production environment
- [ ] Verify location permissions work
- [ ] Confirm fallback system activates when API down
- [ ] Test alert cancellation (if implemented)
- [ ] Monitor alert success rate for 24 hours
- [ ] Document escalation procedures
- [ ] Train staff on emergency button usage
- [ ] Set up alerts for failed API calls

---

## Troubleshooting

### "API key not configured"
```bash
# Check environment variable is set
echo $VITE_AURA_API_KEY

# If missing, add to .dev.vars or Cloudflare Pages
```

### Location permission denied
- User must allow location access
- Show clear prompt explaining why needed
- Fallback to manual location entry (future enhancement)

### API timeouts
- Check network connectivity
- Verify Aura API status
- Increase timeout if needed (currently 30s)
- Fallback system will activate automatically

### Alerts not appearing in Aura dashboard
- Verify API key permissions
- Check payload format matches Aura spec
- Review Aura API documentation for changes
- Contact Aura support

---

## Future Enhancements

Potential improvements:

1. **Two-Way Communication**
   - Receive dispatch updates
   - Real-time responder tracking
   - ETA updates

2. **Alert Types**
   - Medical emergency
   - Security threat
   - Equipment failure
   - Request backup

3. **Historical Tracking**
   - View past alerts
   - Response time analytics
   - Pattern detection

4. **Integration with Wearables**
   - Automatic fall detection
   - Heart rate spike alerts
   - Panic via smartwatch

---

## Support

### Aura Support
- **Email**: support@aura.co.za
- **Phone**: +27 11 123 4567
- **Dashboard**: https://dashboard.aura.co.za

### Ahava Platform
- **Documentation**: `docs/`
- **GitHub Issues**: [Your repo issues]
- **Support Email**: tech@ahavahealthcare.com

---

**Integration Version**: 1.0.0  
**Last Updated**: January 25, 2026  
**Status**: Production Ready (pending Aura credentials)

