# Aura API Integration - Quick Reference

## 🚀 Quick Setup

### 1. Get API Key
Contact Aura to get sandbox credentials

### 2. Add to .dev.vars
```bash
VITE_AURA_API_URL=https://sandbox.aura.co.za/api/v1
VITE_AURA_API_KEY=your_api_key_here
```

### 3. Test Emergency Button
```bash
npm run dev
# Navigate to nurse dashboard
# Click Emergency button
```

---

## 📝 Files Changed

### New Files Created
1. **`src/shared/actions.ts`** - Aura API integration
   - `sendEmergencyAlert()` - Main API call
   - `handleEmergencyAlert()` - With fallback
   - `getCurrentLocation()` - GPS with reverse geocoding
   - `checkAlertStatus()` - Track alert status
   - `cancelEmergencyAlert()` - Cancel false alarms

2. **`docs/AURA_INTEGRATION_GUIDE.md`** - Complete documentation

### Files Modified
1. **`src/react-app/components/PanicButton.tsx`**
   - Integrated Aura API
   - Added fallback system
   - Enhanced error handling
   - Better user feedback

2. **`env.example`**
   - Added Aura configuration

---

## 🔑 Key Features

✅ **Real-time Emergency Alerts**
- Sends to Aura dispatch system
- Includes precise GPS location
- Reverse geocodes to address
- User context and device info

✅ **Automatic Fallback**
- If Aura API fails, stores locally
- Admin dashboard notified
- User informed of backup mode
- No alert is lost

✅ **Retry Logic**
- 3 automatic retries
- Exponential backoff
- Handles rate limiting
- 30-second timeout

✅ **Error Handling**
- Clear error messages
- Emergency numbers displayed
- Fallback activation
- Full logging

---

## 🎯 Usage Example

```typescript
// In any component with panic button
import PanicButton from '@/react-app/components/PanicButton';

<PanicButton 
  appointmentId={appointment.id}
  userProfile={{
    id: user.id,
    name: user.full_name,
    phone: user.phone_number,
    email: user.email
  }}
/>
```

---

## 🧪 Testing Checklist

### Development
- [ ] Environment variables configured
- [ ] Emergency button visible
- [ ] Location permission granted
- [ ] Button triggers alert
- [ ] Success message shows
- [ ] Alert ID displayed (if Aura works)
- [ ] Fallback works (if Aura unavailable)

### Production
- [ ] Production API key set
- [ ] Test in production environment
- [ ] Verify with Aura dashboard
- [ ] Check alert appears
- [ ] Monitor success rate
- [ ] Test fallback system

---

## 📊 API Request Flow

```
User clicks Emergency
        ↓
Request location permission
        ↓
Get GPS coordinates (high accuracy)
        ↓
Reverse geocode to address
        ↓
Prepare payload with user info
        ↓
Send to Aura API
        ↓
    ┌───────┴───────┐
    ↓               ↓
 Success         Failure
    ↓               ↓
Show alert ID   Try fallback
    ↓               ↓
 Done          Store locally
                    ↓
               Show backup mode
```

---

## ⚠️ Common Issues

### "API key not configured"
**Solution**: Add `VITE_AURA_API_KEY` to `.dev.vars`

### Location permission denied
**Solution**: Grant location access in browser settings

### API timeout
**Solution**: 
- Check network connection
- Verify Aura API status
- Fallback will activate automatically

### Alert not in Aura dashboard
**Solution**:
- Verify API key permissions
- Check payload format
- Contact Aura support

---

## 📞 Emergency Numbers

**South Africa:**
- Police: **10111**
- Ambulance: **10177**
- Fire: **10177**

These are displayed if API fails completely.

---

## 🔐 Security Notes

- API key stored in environment variables
- Not exposed in code repository
- Different keys for sandbox/production
- Location sent only on user action
- Minimal PHI in alert payload
- Audit trail maintained locally

---

## 📚 Full Documentation

See `docs/AURA_INTEGRATION_GUIDE.md` for:
- Complete API reference
- Payload specifications
- Error handling details
- Monitoring guidelines
- Production checklist
- Troubleshooting guide

---

## 🎯 Next Steps

1. **Get Aura Credentials**
   - Contact Aura sales/support
   - Request sandbox access
   - Get API key

2. **Configure Environment**
   - Add keys to `.dev.vars`
   - Test locally
   - Deploy to staging

3. **Test Thoroughly**
   - Trigger test alerts
   - Verify in Aura dashboard
   - Test fallback system
   - Check error handling

4. **Go to Production**
   - Get production API key
   - Update Cloudflare Pages env vars
   - Monitor for 24 hours
   - Document procedures

---

**Status**: ✅ Ready to integrate (needs Aura API key)

**Time to Setup**: ~30 minutes (with API key)

**Integration Complexity**: ⭐⭐ (Low - well documented)

