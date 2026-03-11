import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip,
  LinearProgress,
} from '@mui/material';
import { useAuth } from '../AuthContext';
import authApi from '../lib/api';
import ErrorAlert from '../ErrorAlert';

interface RiskScore {
  framinghamRisk?: number;
  qrisk3Risk?: number;
  mlRisk?: number;
  anomalies?: string[];
  alertLevel?: 'GREEN' | 'YELLOW' | 'RED';
  recommendations?: string[];
  baselineStatus?: string;
  readinessScore?: number;
}

interface BiometricReading {
  id: string;
  heartRate?: number;
  temperature?: number;
  systolic?: number;
  diastolic?: number;
  spO2?: number;
  createdAt: string;
}

interface BaselineInfo {
  daysEstablished: number;
  daysRequired: number;
  isComplete: boolean;
}

interface TimelineEvent {
  date: string;
  alertLevel: 'GREEN' | 'YELLOW' | 'RED';
  anomalies: string[];
  heartRate?: number;
  spo2?: number;
  temperature?: number;
  respiratoryRate?: number;
}

export default function EarlyWarningPage() {
  const { user } = useAuth();
  const [riskData, setRiskData] = useState<RiskScore | null>(null);
  const [biometrics, setBiometrics] = useState<BiometricReading[]>([]);
  const [baselineInfo, setBaselineInfo] = useState<BaselineInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    loadEarlyWarningData();
    const interval = setInterval(loadEarlyWarningData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [user?.id]);

  const loadEarlyWarningData = async () => {
    try {
      setError(null);
      // Fetch risk scores
      const riskResponse = await authApi.get(`/patient/early-warning`);
      setRiskData(riskResponse.data);

      // Fetch biometric history
      const bioResponse = await authApi.get(`/patient/biometrics/history?limit=10`);
      setBiometrics(bioResponse.data);

      // Fetch baseline info
      try {
        const baselineResponse = await authApi.get(`/patient/baseline-info`);
        setBaselineInfo(baselineResponse.data);
      } catch (e) {
        console.warn('Baseline info not available');
      }

      // Fetch anomaly timeline
      try {
        const timelineResponse = await authApi.get(`/patient/anomaly-timeline?limit=30&days=30`);
        setTimeline(timelineResponse.data);
      } catch (e) {
        console.warn('Timeline not available');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load Early Warning data');
      console.error('Early Warning Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getAlertColor = (level?: string) => {
    switch (level) {
      case 'RED':
        return '#d32f2f';
      case 'YELLOW':
        return '#f57c00';
      default:
        return '#388e3c';
    }
  };

  const getAlertSeverity = (level?: string) => {
    switch (level) {
      case 'RED':
        return 'error' as const;
      case 'YELLOW':
        return 'warning' as const;
      default:
        return 'success' as const;
    }
  };

  if (!user) return null;
  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
        🏥 ML Early Warning Service
      </Typography>

      {error && <ErrorAlert message={error} />}

      {/* IMPROVEMENT #4: Baseline Progress */}
      {baselineInfo && !baselineInfo.isComplete && (
        <Paper sx={{ p: 2.5, backgroundColor: '#e3f2fd', borderLeft: '4px solid #2196f3', mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1565c0' }}>
              📊 Establishing Your Baseline
            </Typography>
            <Typography variant="caption" sx={{ backgroundColor: 'white', px: 1.5, py: 0.5, borderRadius: 1 }}>
              Day {baselineInfo.daysEstablished}/{baselineInfo.daysRequired}
            </Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={(baselineInfo.daysEstablished / baselineInfo.daysRequired) * 100}
            sx={{ height: 8, borderRadius: 4, mb: 1 }}
          />
          <Typography variant="caption" sx={{ color: '#0d47a1', display: 'block' }}>
            ✓ We're learning your normal patterns. Full early warning alerts will activate on Day 14.
          </Typography>
        </Paper>
      )}

      {baselineInfo?.isComplete && (
        <Paper sx={{ p: 2, backgroundColor: '#e8f5e9', borderLeft: '4px solid #4caf50', mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: '#2e7d32' }}>
            ✓ Baseline Established - Early warning monitoring is active
          </Typography>
        </Paper>
      )}

      {/* Risk Alert Status */}
      {riskData && (
        <Alert
          severity={getAlertSeverity(riskData.alertLevel)}
          sx={{
            mb: 3,
            backgroundColor: getAlertColor(riskData.alertLevel),
            color: 'white',
            fontSize: '1.1rem',
            fontWeight: 'bold',
          }}
        >
          {riskData.alertLevel === 'RED' && '🚨 HIGH RISK - Immediate attention required'}
          {riskData.alertLevel === 'YELLOW' && '⚠️ ELEVATED RISK - Monitor closely'}
          {riskData.alertLevel === 'GREEN' && '✅ LOW RISK - Vitals within normal parameters'}
        </Alert>
      )}

      {/* IMPROVEMENT #5: Demo Stream Button (DEV MODE ONLY) */}
      {process.env.NODE_ENV !== 'production' && (
        <Box sx={{ mb: 3, p: 2, backgroundColor: '#f3e5f5', borderRadius: 1, textAlign: 'center' }}>
          <button
            onClick={async () => {
              try {
                const response = await fetch(`/api/patient/demo/start-stream?userId=${user.id}&duration=300`, {
                  method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                  alert('🎬 Demo stream started! Biometrics updating every 30 seconds for 5 minutes');
                  // Auto-refresh dashboard every 10 seconds during demo
                  const demoRefresh = setInterval(() => {
                    loadEarlyWarningData();
                  }, 10000);

                  // Stop refresh after 5 minutes
                  setTimeout(() => clearInterval(demoRefresh), 5 * 60 * 1000);
                }
              } catch (e) {
                console.error('Demo stream error:', e);
              }
            }}
            style={{
              backgroundColor: '#9c27b0',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            🎬 Start 5-Minute Demo Stream
          </button>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#6a1b9a' }}>
            Simulates 100 days of biometric progression in real-time
          </Typography>
        </Box>
      )}

      {/* Risk Alert Status */}
        {/* Baseline Status */}
        {riskData?.baselineStatus && (
          <Grid item xs={12} sm={6}>
            <Card sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom sx={{ color: 'white' }}>
                  BASELINE CALIBRATION
                </Typography>
                <Typography variant="h5" sx={{ color: 'white', fontWeight: 'bold' }}>
                  {riskData.baselineStatus}
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', mt: 1 }}>
                  {riskData.baselineStatus === 'CALIBRATING'
                    ? 'System learning your baseline metrics over 14 days'
                    : 'Baseline established - ML model activated'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Readiness Score */}
        {riskData?.readinessScore !== undefined && (
          <Grid item xs={12} sm={6}>
            <Card sx={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom sx={{ color: 'white' }}>
                  READINESS SCORE
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="h5" sx={{ color: 'white', fontWeight: 'bold' }}>
                    {riskData.readinessScore}/100
                  </Typography>
                  <Box sx={{ flex: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={riskData.readinessScore}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: 'rgba(255,255,255,0.3)',
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: 'white',
                        },
                      }}
                    />
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Framingham Risk */}
        {riskData?.framinghamRisk !== undefined && (
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  FRAMINGHAM 10Y CVD
                </Typography>
                <Typography variant="h4" sx={{ color: '#1976d2', fontWeight: 'bold' }}>
                  {riskData.framinghamRisk.toFixed(1)}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Cardiovascular disease risk
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* QRISK3 Risk */}
        {riskData?.qrisk3Risk !== undefined && (
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  QRISK3 10Y CVD
                </Typography>
                <Typography variant="h4" sx={{ color: '#d32f2f', fontWeight: 'bold' }}>
                  {riskData.qrisk3Risk.toFixed(1)}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  UK-adapted risk model
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* ML Model Risk */}
        {riskData?.mlRisk !== undefined && (
          <Grid item xs={12} sm={4}>
            <Card sx={{ border: '2px solid #388e3c' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  🤖 ML PREDICTION
                </Typography>
                <Typography variant="h4" sx={{ color: '#388e3c', fontWeight: 'bold' }}>
                  {riskData.mlRisk.toFixed(1)}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Personalized ML model
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Anomalies & Alerts */}
        {riskData?.anomalies && riskData.anomalies.length > 0 && (
          <Grid item xs={12}>
            <Card sx={{ backgroundColor: '#fff3cd' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  ⚡ Detected Anomalies
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {riskData.anomalies.map((anomaly, idx) => (
                    <Chip
                      key={idx}
                      label={anomaly}
                      color="warning"
                      variant="outlined"
                      sx={{ fontWeight: 'bold' }}
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* IMPROVEMENT #1: Smart Recommendations */}
        {riskData?.recommendations && riskData.recommendations.length > 0 && (
          <Grid item xs={12}>
            <Card sx={{ 
              backgroundColor: riskData.alertLevel === 'RED' ? '#ffebee' : '#fff3e0',
              borderLeft: `4px solid ${riskData.alertLevel === 'RED' ? '#d32f2f' : '#ff9800'}`
            }}>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  💡 What This Means
                </Typography>
                <List sx={{ pl: 2 }}>
                  {riskData.recommendations.map((rec, idx) => (
                    <ListItem key={idx} sx={{ pl: 0 }}>
                      <ListItemText 
                        primary={rec}
                        sx={{ 
                          '& .MuiListItemText-primary': { 
                            fontSize: '0.95rem',
                            fontWeight: rec.startsWith('🔴') || rec.startsWith('🚨') ? 600 : 500
                          }
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* IMPROVEMENT #2: Anomaly Timeline */}
        {timeline.length > 0 && (
          <Grid item xs={12}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  📈 Your Health Timeline (Last 30 Days)
                </Typography>
                
                <Box sx={{ position: 'relative' }}>
                  {/* Timeline visualization */}
                  <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 2 }}>
                    {timeline.slice(0, 14).reverse().map((event, idx) => {
                      const colorsMap = {
                        'GREEN': '#4caf50',
                        'YELLOW': '#ff9800',
                        'RED': '#d32f2f'
                      };
                      const dayLabel = new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      
                      return (
                        <div key={idx} title={`${dayLabel}: ${event.alertLevel}`}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            backgroundColor: colorsMap[event.alertLevel],
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flex: '0 0 auto'
                          }}
                        >
                          <Typography sx={{ color: 'white', fontSize: '0.7rem', fontWeight: 'bold' }}>
                            {dayLabel}
                          </Typography>
                        </div>
                      );
                    })}
                  </Box>

                  {/* Detailed list view */}
                  <hr style={{ margin: '12px 0' }} />
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>Recent Events:</Typography>
                  
                  {timeline.slice(0, 7).map((event, idx) => {
                    const colorsMap = {
                      'GREEN': '#4caf50',
                      'YELLOW': '#ff9800',
                      'RED': '#d32f2f'
                    };
                    const eventDate = new Date(event.date).toLocaleDateString('en-US', { 
                      weekday: 'short', 
                      month: 'short', 
                      day: 'numeric'
                    });

                    return (
                      <Box key={idx} sx={{ mb: 2, pb: 2, borderLeft: `3px solid ${colorsMap[event.alertLevel]}`, pl: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {eventDate}
                          </Typography>
                          <Chip 
                            label={event.alertLevel}
                            size="small"
                            sx={{ backgroundColor: colorsMap[event.alertLevel], color: 'white' }}
                          />
                        </Box>
                        
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                          {event.anomalies.length > 0 
                            ? `Anomalies: ${event.anomalies.join(', ')}`
                            : 'No anomalies detected'
                          }
                        </Typography>
                        
                        {event.heartRate && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            HR: {event.heartRate.toFixed(0)} bpm
                            {event.spo2 && ` | SpO₂: ${event.spo2.toFixed(1)}%`}
                            {event.temperature && ` | Temp: ${event.temperature.toFixed(1)}°C`}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Recent Biometrics */}
        {biometrics.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  📊 Recent Biometric Readings
                </Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '0.9rem',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          backgroundColor: '#f5f5f5',
                          borderBottom: '2px solid #ddd',
                        }}
                      >
                        <th style={{ padding: '8px', textAlign: 'left' }}>Date/Time</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>HR</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>BP</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>Temp</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>SpO₂</th>
                      </tr>
                    </thead>
                    <tbody>
                      {biometrics.map((bio) => (
                        <tr
                          key={bio.id}
                          style={{
                            borderBottom: '1px solid #eee',
                          }}
                        >
                          <td style={{ padding: '8px' }}>
                            {new Date(bio.createdAt).toLocaleString()}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {bio.heartRate ? `${bio.heartRate} bpm` : '-'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {bio.systolic && bio.diastolic
                              ? `${bio.systolic}/${bio.diastolic}`
                              : '-'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {bio.temperature ? `${bio.temperature}°C` : '-'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {bio.spO2 ? `${bio.spO2}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Info Box */}
        <Grid item xs={12}>
          <Alert severity="info">
            <strong>How it works:</strong> Our ML Early Warning service continuously monitors
            your biometrics against personalized baselines. It uses Framingham and QRISK3
            algorithms combined with machine learning to predict cardiovascular risk and alert
            you to potential health concerns before they become critical.
          </Alert>
        </Grid>
      </Grid>
    </Container>
  );
}
