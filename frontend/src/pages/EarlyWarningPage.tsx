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

export default function EarlyWarningPage() {
  const { user } = useAuth();
  const [riskData, setRiskData] = useState<RiskScore | null>(null);
  const [biometrics, setBiometrics] = useState<BiometricReading[]>([]);
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

      <Grid container spacing={3}>
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

        {/* Recommendations */}
        {riskData?.recommendations && riskData.recommendations.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  💡 AI-Generated Recommendations
                </Typography>
                <List>
                  {riskData.recommendations.map((rec, idx) => (
                    <ListItem key={idx}>
                      <ListItemText
                        primary={rec}
                        primaryTypographyProps={{
                          sx: { fontWeight: '500' },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
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
