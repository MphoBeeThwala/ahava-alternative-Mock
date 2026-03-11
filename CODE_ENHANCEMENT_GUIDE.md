# 🔧 Code Enhancement Guide - Non-Breaking Improvements

## Quick Reference for Demo Polish Features

This document provides **specific implementation details** for the 5 improvement opportunities from the Code Coherence Audit. Each feature can be implemented **independently without affecting existing code**.

---

## Opportunity 1: Baseline Establishment Feedback

### What It Does
Shows patient visual progress toward completing their 14-day baseline (required before early warning alerts)

### Where to Implement
**Frontend**: `workspace/src/pages/EarlyWarningPage.tsx` (add after line 44)

### Code to Add

**Add to Component State:**
```typescript
const [baselineProgress, setBaselineProgress] = useState<{
  daysCollected: number;
  daysRequired: number;
  percentComplete: number;
} | null>(null);
```

**Add to useEffect (fetch baseline info):**
```typescript
const loadBaselineProgress = async () => {
  try {
    const response = await authApi.get(`/api/patient/baseline-progress`);
    setBaselineProgress({
      daysCollected: response.data.daysCollected,
      daysRequired: 14,
      percentComplete: (response.data.daysCollected / 14) * 100
    });
  } catch (e) {
    // Silently fail - baseline not critical to demo
  }
};

// Call in useEffect
loadBaselineProgress();
```

**JSX to Render (add before risk scores section):**
```tsx
{baselineProgress && baselineProgress.daysCollected < 14 && (
  <Paper sx={{ p: 2, backgroundColor: '#e8f5e9', mb: 3 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        📊 Establishing Your Baseline
      </Typography>
      <Typography variant="body2" color="textSecondary">
        Day {baselineProgress.daysCollected} of {baselineProgress.daysRequired}
      </Typography>
    </Box>
    <LinearProgress 
      variant="determinate" 
      value={baselineProgress.percentComplete}
      sx={{ height: 8, borderRadius: 4 }}
    />
    <Typography variant="caption" sx={{ mt: 1, display: 'block', color: '#2e7d32' }}>
      ✓ Health alerts will start when baseline is complete
    </Typography>
  </Paper>
)}
```

**Backend Endpoint (add to `apps/backend/src/routes/patient.ts`):**
```typescript
// GET /api/patient/baseline-progress
router.get('/baseline-progress', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const readings = await prisma.biometricReading.findMany({
      where: { userId },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1
    });

    if (readings.length === 0) return res.json({ daysCollected: 0 });

    const firstReading = await prisma.biometricReading.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    });

    const daysDiff = Math.floor(
      (new Date().getTime() - new Date(firstReading!.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    res.json({ daysCollected: Math.min(daysDiff, 14) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get baseline progress' });
  }
});
```

**Time to Implement**: 45 minutes  
**Breaking Changes**: None ✅  
**Demo Impact**: ⭐⭐⭐ High - Shows Sylvia achieved baseline

---

## Opportunity 2: Anomaly Timeline

### What It Does
Shows historical progression of anomalies over time (helps viewer understand how Sylvia's condition deteriorated)

### Where to Implement
**Frontend**: `workspace/src/pages/EarlyWarningPage.tsx` (add new section after biometric history)

### Code to Add

**Add Timeline Component State:**
```typescript
interface AnomalyEvent {
  date: string;
  alertLevel: 'GREEN' | 'YELLOW' | 'RED';
  anomalies: string[];
  heartRate?: number;
  spo2?: number;
}

const [anomalyTimeline, setAnomalyTimeline] = useState<AnomalyEvent[]>([]);
```

**Fetch Timeline Data (add to useEffect):**
```typescript
const loadAnomalyTimeline = async () => {
  try {
    const response = await authApi.get(`/api/patient/anomaly-timeline?limit=30`);
    setAnomalyTimeline(response.data);
  } catch (e) {
    console.error('Failed to load timeline', e);
  }
};

loadAnomalyTimeline();
```

**JSX to Render:**
```tsx
{anomalyTimeline.length > 0 && (
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <Typography variant="h6" gutterBottom>
        📈 Recent Activity Timeline
      </Typography>
      <Box sx={{ position: 'relative', pl: 3 }}>
        {anomalyTimeline.map((event, idx) => {
          const alertColor = event.alertLevel === 'RED' 
            ? '#d32f2f' 
            : event.alertLevel === 'YELLOW' 
            ? '#f57c00' 
            : '#2e7d32';
          
          return (
            <Box key={idx} sx={{ mb: 2, pb: 2, borderLeft: `3px solid ${alertColor}`, pl: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {new Date(event.date).toLocaleDateString()} {new Date(event.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
                <Chip 
                  label={event.alertLevel}
                  size="small"
                  sx={{ backgroundColor: alertColor, color: 'white' }}
                />
              </Box>
              {event.heartRate && (
                <Typography variant="caption" color="textSecondary">
                  HR: {event.heartRate} bpm {event.spo2 && `| SpO₂: ${event.spo2}%`}
                </Typography>
              )}
              <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
                {event.anomalies.join(', ')}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </CardContent>
  </Card>
)}
```

**Backend Endpoint (add to `apps/backend/src/routes/patient.ts`):**
```typescript
// GET /api/patient/anomaly-timeline?limit=30
router.get('/anomaly-timeline', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    
    const readings = await prisma.biometricReading.findMany({
      where: {
        userId,
        alertLevel: { not: 'GREEN' }  // Only non-normal readings
      },
      select: {
        createdAt: true,
        alertLevel: true,
        anomalies: true,
        heartRate: true,
        spo2: true
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    const timeline = readings.map(r => ({
      date: r.createdAt,
      alertLevel: r.alertLevel,
      anomalies: r.anomalies as string[],
      heartRate: r.heartRate,
      spo2: r.spo2
    }));

    res.json(timeline);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});
```

**Time to Implement**: 1.5 hours  
**Breaking Changes**: None ✅  
**Demo Impact**: ⭐⭐⭐⭐ High - Shows progression visually

---

## Opportunity 3: Doctor Case Urgency Indicator

### What It Does
Shows time-since-submission and suggests medical urgency (helps viewer understand case prioritization)

### Where to Implement
**Frontend**: `workspace/src/app/doctor/dashboard/page.tsx` (modify case card at line 120-135)

### Code to Add

**Helper Function (add near top of component):**
```typescript
const getUrgencyLevel = (createdAt: string): { level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; color: string; hoursAgo: number } => {
  const created = new Date(createdAt).getTime();
  const now = new Date().getTime();
  const hoursAgo = Math.floor((now - created) / (1000 * 60 * 60));

  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'LOW';
  let color = '#4caf50'; // green

  if (hoursAgo >= 24) {
    level = 'URGENT';
    color = '#d32f2f'; // red
  } else if (hoursAgo >= 6) {
    level = 'HIGH';
    color = '#f57c00'; // orange
  } else if (hoursAgo >= 1) {
    level = 'MEDIUM';
    color = '#fbc02d'; // yellow
  }

  return { level, color, hoursAgo };
};

const formatTimeAgo = (hours: number): string => {
  if (hours === 0) return 'just now';
  if (hours < 1) return '< 1 hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
};
```

**Modify Case Card JSX (replace section around line 145):**
```tsx
{triageCases.map((tc) => {
  const { level, color, hoursAgo } = getUrgencyLevel(tc.createdAt);
  
  return (
    <div key={tc.id} className="border rounded-lg p-4 bg-white hover:shadow-lg transition" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="font-semibold text-slate-900">
            [{level}] {tc.patient?.firstName} {tc.patient?.lastName}
          </p>
          <p className="text-xs text-slate-500">
            {formatTimeAgo(hoursAgo)}
          </p>
        </div>
        <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: color }}>
          {level}
        </span>
      </div>

      <p className="text-sm text-slate-600 mb-1">{tc.symptoms}</p>
      <p className="text-slate-500 text-sm mb-2">
        <strong>Specialty:</strong> {tc.specialty}
      </p>
      <p className="text-slate-500 text-sm mb-2">
        <strong>Possible conditions:</strong> {(tc.aiPossibleConditions || []).join(', ')}
      </p>
      
      {/* Rest of buttons */}
    </div>
  );
})}
```

**Time to Implement**: 45 minutes  
**Breaking Changes**: None ✅  
**Demo Impact**: ⭐⭐⭐ Shows realistic case prioritization

---

## Opportunity 4: Biometric Streaming Simulation (Demo Mode)

### What It Does
Automatically submits realistic biometric readings every 30 seconds during demo, simulating real-time monitoring

### Where to Implement
**Backend**: New `/api/demo/stream-biometrics` endpoint in `apps/backend/src/routes/patient.ts`

### Code to Add

**Create Demo Biometric Generator (add new file `apps/backend/src/services/demoStream.ts`):**
```typescript
export function generateRealisticBiometrics(dayNumber: number): {
  heartRate: number;
  hrv: number;
  spo2: number;
  respiratoryRate: number;
  temperature: number;
  sleepDurationHours: number;
  stepCount: number;
} {
  // Day 1-14: Stable baseline
  // Day 15-99: Gradually increasing stress markers
  // Day 100+: Acute event
  
  const baselineHR = 72;
  const progression = Math.max(0, dayNumber - 15) / 85; // 0 to ~1
  
  // Early event indicators on day 100+
  const eventSeverity = Math.max(0, (dayNumber - 100) * 0.5);

  return {
    heartRate: baselineHR + (progression * 12) + (eventSeverity * 8) + Math.random() * 4,
    hrv: 45 - (progression * 15) - (eventSeverity * 10),
    spo2: 98 - (progression * 2) - (eventSeverity * 3),
    respiratoryRate: 16 + (progression * 2) + (eventSeverity * 2),
    temperature: 37.0 + (eventSeverity * 0.3),
    sleepDurationHours: 7 + (Math.random() * 1 - 0.5),
    stepCount: 7000 + Math.random() * 4000 - 2000,
  };
}

export async function streamBiometricsForDemo(
  userId: string,
  durationMinutes: number = 5
) {
  const interval = setInterval(async () => {
    const now = new Date();
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
    
    const biometrics = generateRealisticBiometrics(dayOfYear);

    // Submit biometric
    const prisma = new PrismaClient();
    await prisma.biometricReading.create({
      data: {
        userId,
        ...biometrics,
        createdAt: new Date()
      }
    });

    console.log(`[DEMO] Submitted biometrics for ${userId}: HR=${biometrics.heartRate.toFixed(0)}`);
  }, 30000); // Every 30 seconds

  // Auto-stop after duration
  setTimeout(() => clearInterval(interval), durationMinutes * 60 * 1000);
}
```

**Add Demo Endpoint (in `apps/backend/src/routes/patient.ts`):**
```typescript
// POST /api/demo/stream-biometrics?userId=xxx&minutes=5
// DEMO ONLY - Streams realistic biometrics for demonstration
router.post('/demo/stream-biometrics', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Demo endpoints disabled in production' });
  }

  const { userId, minutes } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    startBiometricStream(userId as string, parseInt(minutes as string) || 5);
    res.json({ 
      message: 'Biometric streaming started',
      durationMinutes: parseInt(minutes as string) || 5,
      frequencySeconds: 30
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start stream' });
  }
});
```

**Frontend Demo Button (add to patient dashboard):**
```tsx
{process.env.NODE_ENV !== 'production' && (
  <Button 
    variant="outlined"
    onClick={() => {
      fetch(`/api/demo/stream-biometrics?userId=${user.id}&minutes=5`, {
        method: 'POST'
      });
      toast.success('Demo biometric stream started (5 min)');
    }}
  >
    🎬 Start Demo Stream
  </Button>
)}
```

**Time to Implement**: 2 hours  
**Breaking Changes**: None ✅ (dev-only feature)  
**Demo Impact**: ⭐⭐⭐⭐⭐ Extremely immersive - live data progressing

---

## Opportunity 5: Smart Recommendations by Anomaly Type

### What It Does
Generates specific recommendations based on WHICH metrics are anomalous (not just alert level)

### Current Code
**File**: `apps/backend/src/services/monitoring.ts` lines 68-92

### Replacement Code

**Replace `generateRecommendations()` function:**
```typescript
export function generateRecommendations(
  alertLevel: 'GREEN' | 'YELLOW' | 'RED',
  anomalies: string[],
  biometricData: any
): string[] {
  const recommendations: string[] = [];

  if (alertLevel === 'GREEN') {
    recommendations.push('✓ Your metrics look good. Keep up your current routine.');
    return recommendations;
  }

  // Heart rate specific
  if (anomalies.some(a => a.includes('heart_rate'))) {
    if (biometricData.heartRate > 85) {
      recommendations.push('🔴 Resting heart rate elevated - Consider: stress management, reduce caffeine, sleep assessment');
    } else if (biometricData.heartRate < 55) {
      recommendations.push('⚠️ Resting heart rate low - Bradycardia may indicate: overtraining, fatigue, or medical condition. Consult doctor.');
    }
  }

  // HRV specific  
  if (anomalies.some(a => a.includes('hrv'))) {
    recommendations.push('🔴 Heart rate variability low - Indicates: high stress, poor recovery, or illness. Prioritize rest and stress reduction.');
  }

  // SpO2 specific
  if (anomalies.some(a => a.includes('spo2'))) {
    if (biometricData.spo2 < 94) {
      recommendations.push('🔴 URGENT: Oxygen saturation critically low (<94%) - Seek immediate medical attention');
    } else if (biometricData.spo2 < 96) {
      recommendations.push('⚠️ Oxygen saturation below normal - Check for respiratory issues, altitude, or health changes');
    }
  }

  // Respiratory rate specific
  if (anomalies.some(a => a.includes('respiratory_rate'))) {
    if (biometricData.respiratoryRate > 20) {
      recommendations.push('⚠️ Elevated respiratory rate - May indicate: anxiety, physical exertion, or respiratory infection. Monitor');
    }
  }

  // Temperature specific
  if (biometricData.temperature > 37.5) {
    recommendations.push('🔴 Fever detected (>37.5°C) - Sign of infection. Hydrate, rest, monitor symptoms. Seek care if persists');
  }

  // Sleep specific
  if (anomalies.some(a => a.includes('sleep'))) {
    if (biometricData.sleepDurationHours < 6) {
      recommendations.push('😴 Sleep deprivation - Sleep <6 hours linked to elevated stress markers. Prioritize 7-8 hours tonight');
    }
  }

  // Generic YELLOW recommendation
  if (recommendations.length === 0 && alertLevel === 'YELLOW') {
    recommendations.push('📊 One or more metrics slightly elevated. Monitor closely over next 24-48 hours.');
  }

  // Generic RED recommendation
  if (recommendations.length === 0 && alertLevel === 'RED') {
    recommendations.push('🚨 Multiple metrics significantly abnormal. Consider consulting healthcare provider.');
  }

  return recommendations;
}
```

**Update EarlyWarningPage to display (workspace/src/pages/EarlyWarningPage.tsx line ~280):**
```tsx
{riskData?.recommendations && riskData.recommendations.length > 0 && (
  <Card sx={{ backgroundColor: '#fff3e0', borderLeft: '4px solid #ff9800' }}>
    <CardContent>
      <Typography variant="h6" gutterBottom>
        💡 Personalized Recommendations
      </Typography>
      <List>
        {riskData.recommendations.map((rec, idx) => (
          <ListItem key={idx} sx={{ pl: 0 }}>
            <ListItemText 
              primary={rec}
              sx={{ '& .MuiListItemText-primary': { fontSize: '0.95rem' } }}
            />
          </ListItem>
        ))}
      </List>
    </CardContent>
  </Card>
)}
```

**Time to Implement**: 1 hour  
**Breaking Changes**: None ✅ (just more detailed output)  
**Demo Impact**: ⭐⭐⭐⭐ Much more convincing "early warning" narrative

---

## Implementation Priority for Demo

**If you have 2 hours:**
1. Implement **Opportunity 5** (Smart Recommendations) - 1 hour
2. Implement **Opportunity 3** (Doctor Urgency) - 45 min

**If you have 4 hours:**
1. Implement **Opportunity 5** (Smart Recommendations) - 1 hour
2. Implement **Opportunity 2** (Anomaly Timeline) - 1.5 hours
3. Implement **Opportunity 3** (Doctor Urgency) - 45 min

**If you have 6+ hours (polish everything):**
1. Implement all 5 opportunities
2. Test each feature thoroughly
3. Run through complete demo 3+ times

---

## Testing Each Feature

### Test Opportunity 1: Baseline Progress
```bash
# Should show progress bar at 50% if 7 days of data exist
GET http://localhost:4000/api/patient/baseline-progress
# Response: { daysCollected: 7 }
```

### Test Opportunity 2: Anomaly Timeline
```bash
# Should return 20 most recent alert events
GET http://localhost:4000/api/patient/anomaly-timeline?limit=20
# Response: Array of {date, alertLevel, anomalies, heartRate, spo2}
```

### Test Opportunity 3: Doctor Urgency
- Login as doctor
- Cases should be color-coded by age
- Red: >24 hours old, Orange: 6-24 hours, Yellow: 1-6 hours, Green: <1 hour

### Test Opportunity 4: Demo Streaming
```bash
# Open browser console on patient dashboard
# Click "Start Demo Stream" button
# Should see biometric readings auto-submitted every 30 seconds
```

### Test Opportunity 5: Smart Recommendations
- View Early Warning dashboard
- Should see specific recommendations for each anomaly type
- Not generic "rest and recover" but specific guidance

---

## Rollback Plan (if needed)

Each feature is isolated, so:
- Remove the new endpoint
- Revert JSX changes
- No database changes required

All features are **non-breaking** and can be safely added/removed.

---

## What NOT to Change

**Do NOT modify:**
- JWT token expiry logic ❌
- ML Service engine.py core algorithms ❌
- Database schema ❌
- Authentication middleware ❌
- Rate limiter configuration ❌

**These are working perfectly and any changes risk breaking the demo.**

---

*Implementation Guide Complete*  
Use this as your "polish checklist" for investor demo prep.
