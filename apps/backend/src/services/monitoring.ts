/**
 * Early Warning Monitoring Service
 * 
 * This service continuously monitors patient biometrics and detects
 * early warning signs of health issues before they become serious.
 * 
 * Key features:
 * - Baseline establishment (14 days of data)
 * - Continuous monitoring with anomaly detection
 * - Early detection of conditions like:
 *   - Heart attack precursors (elevated HR, decreased HRV)
 *   - Respiratory infections (increased respiratory rate, decreased SpO2)
 *   - Other health scares
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

export interface MonitoringResult {
  alertLevel: 'GREEN' | 'YELLOW' | 'RED';
  anomalies: string[];
  readinessScore: number;
  baselineStatus: string;
  recommendations: string[];
}

/**
 * Process biometric reading through early warning system
 */
export async function processBiometricReading(
  userId: string,
  biometricData: any
): Promise<MonitoringResult> {
  try {
    // Send to ML service for analysis
    const mlPayload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      heart_rate_resting: biometricData.heartRateResting || biometricData.heartRate || 70,
      hrv_rmssd: biometricData.hrvRmssd || 50,
      spo2: biometricData.oxygenSaturation || 98,
      skin_temp_offset: biometricData.skinTempOffset || 0,
      respiratory_rate: biometricData.respiratoryRate || 16,
      step_count: biometricData.stepCount || 0,
      active_calories: biometricData.activeCalories || 0,
    };
    if (biometricData.sleepDurationHours != null) mlPayload.sleep_duration_hours = biometricData.sleepDurationHours;
    if (biometricData.ecgRhythm) mlPayload.ecg_rhythm = biometricData.ecgRhythm;
    if (biometricData.temperatureTrend) mlPayload.temperature_trend = biometricData.temperatureTrend;

    const mlResponse = await axios.post(
      `${ML_SERVICE_URL}/ingest?user_id=${userId}`,
      mlPayload,
      { timeout: 5000 }
    );

    const alertLevel = mlResponse.data.alert_level as 'GREEN' | 'YELLOW' | 'RED';
    const anomalies = mlResponse.data.anomalies || [];

    // Get readiness score
    const scoreResponse = await axios.get(
      `${ML_SERVICE_URL}/readiness-score/${userId}`,
      { timeout: 5000 }
    );

    const readinessScore = scoreResponse.data.score || 100;
    const baselineStatus = scoreResponse.data.baseline_status || 'STABLE';

    // Generate recommendations based on alert level
    const recommendations = generateRecommendations(alertLevel, anomalies, baselineStatus);

    return {
      alertLevel,
      anomalies,
      readinessScore,
      baselineStatus,
      recommendations,
    };
  } catch (error: any) {
    console.warn('[Monitoring] ML service unavailable, using fallback logic:', error.message);
    
    // Fallback: Basic threshold checking
    // This ensures we always return valid values even when ML service is down
    return fallbackAnalysis(biometricData);
  }
}

/**
 * Generate health recommendations based on alert level
 */
function generateRecommendations(
  alertLevel: 'GREEN' | 'YELLOW' | 'RED',
  anomalies: string[],
  baselineStatus: string
): string[] {
  const recommendations: string[] = [];

  if (baselineStatus === 'CALIBRATING') {
    recommendations.push('Baseline establishment in progress. Continue regular monitoring.');
    return recommendations;
  }

  if (alertLevel === 'RED') {
    recommendations.push('⚠️ CRITICAL: Seek immediate medical attention');
    recommendations.push('Contact your healthcare provider or visit emergency services');
    
    if (anomalies.some(a => a.includes('heart_rate'))) {
      recommendations.push('Heart rate anomaly detected - may indicate cardiovascular stress');
    }
    if (anomalies.some(a => a.includes('spo2') || a.includes('oxygen'))) {
      recommendations.push('Oxygen saturation low - may indicate respiratory issues');
    }
    if (anomalies.some(a => a.includes('respiratory'))) {
      recommendations.push('Respiratory rate elevated - monitor for signs of infection');
    }
  } else if (alertLevel === 'YELLOW') {
    recommendations.push('⚠️ WARNING: Biometric deviations detected');
    recommendations.push('Monitor symptoms closely and consider consulting healthcare provider');
    recommendations.push('Continue regular monitoring and report any worsening symptoms');
    
    if (anomalies.some(a => a.includes('heart_rate'))) {
      recommendations.push('Heart rate variations detected - rest and monitor');
    }
    if (anomalies.some(a => a.includes('hrv'))) {
      recommendations.push('Heart rate variability decreased - may indicate stress or fatigue');
    }
  } else {
    recommendations.push('✅ Biometrics within normal range');
    recommendations.push('Continue regular monitoring');
  }

  return recommendations;
}

/**
 * Fallback analysis when ML service is unavailable
 */
function fallbackAnalysis(biometricData: any): MonitoringResult {
  const anomalies: string[] = [];
  let alertLevel: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

  // Basic threshold checks
  const heartRate = biometricData.heartRateResting || biometricData.heartRate;
  if (heartRate) {
    if (heartRate > 100) {
      anomalies.push('Elevated resting heart rate');
      alertLevel = 'YELLOW';
    } else if (heartRate > 120) {
      anomalies.push('Significantly elevated heart rate');
      alertLevel = 'RED';
    }
  }

  if (biometricData.oxygenSaturation) {
    if (biometricData.oxygenSaturation < 95) {
      anomalies.push('Low oxygen saturation');
      alertLevel = alertLevel === 'RED' ? 'RED' : 'YELLOW';
    } else if (biometricData.oxygenSaturation < 90) {
      anomalies.push('Critically low oxygen saturation');
      alertLevel = 'RED';
    }
  }

  if (biometricData.bloodPressure) {
    const { systolic, diastolic } = biometricData.bloodPressure;
    if (systolic > 140 || diastolic > 90) {
      anomalies.push('Elevated blood pressure');
      alertLevel = alertLevel === 'RED' ? 'RED' : 'YELLOW';
    }
  }

  if (biometricData.respiratoryRate) {
    if (biometricData.respiratoryRate > 20) {
      anomalies.push('Elevated respiratory rate');
      alertLevel = alertLevel === 'RED' ? 'RED' : 'YELLOW';
    }
  }

  return {
    alertLevel,
    anomalies,
    readinessScore: alertLevel === 'GREEN' ? 100 : alertLevel === 'YELLOW' ? 70 : 40,
    baselineStatus: 'STABLE',
    recommendations: generateRecommendations(alertLevel, anomalies, 'STABLE'),
  };
}

/**
 * Check for early warning signs of specific conditions
 */
export function detectEarlyWarningSigns(anomalies: string[], biometricData: any): {
  condition: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  timeWindow: string;
}[] {
  const warnings: Array<{ condition: string; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; timeWindow: string }> = [];

  // Heart attack precursors
  const hasHeartRateAnomaly = anomalies.some(a => a.includes('heart_rate'));
  const hasHRVAnomaly = anomalies.some(a => a.includes('hrv'));
  if (hasHeartRateAnomaly && hasHRVAnomaly) {
    warnings.push({
      condition: 'Cardiovascular Event Risk',
      riskLevel: 'HIGH',
      timeWindow: 'Days to weeks ahead',
    });
  } else if (hasHeartRateAnomaly || hasHRVAnomaly) {
    warnings.push({
      condition: 'Cardiovascular Stress',
      riskLevel: 'MEDIUM',
      timeWindow: 'Days to weeks ahead',
    });
  }

  // Respiratory infection precursors
  const hasRespiratoryAnomaly = anomalies.some(a => a.includes('respiratory'));
  const hasOxygenAnomaly = anomalies.some(a => a.includes('spo2') || a.includes('oxygen'));
  if (hasRespiratoryAnomaly && hasOxygenAnomaly) {
    warnings.push({
      condition: 'Respiratory Infection Risk',
      riskLevel: 'MEDIUM',
      timeWindow: 'Days ahead',
    });
  }

  // Temperature elevation (infection indicator)
  if (biometricData.temperature && biometricData.temperature > 37.5) {
    warnings.push({
      condition: 'Possible Infection',
      riskLevel: 'MEDIUM',
      timeWindow: 'Hours to days ahead',
    });
  }

  return warnings;
}

/**
 * Get monitoring summary for a patient
 */
export async function getMonitoringSummary(userId: string): Promise<{
  baselineEstablished: boolean;
  daysUntilBaseline: number;
  currentReadinessScore: number;
  recentAlerts: number;
  trend: 'STABLE' | 'IMPROVING' | 'DECLINING';
}> {
  // Get baseline status (select only columns that exist in all environments)
  let readings: any[] = [];
  try {
    readings = await prisma.biometricReading.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        readinessScore: true,
      },
    });
  } catch (error: any) {
    console.warn('[Monitoring] Failed to fetch readings:', error?.message || error);
  }

  const baselineEstablished = readings.length >= 14;
  const daysUntilBaseline = baselineEstablished ? 0 : Math.max(0, 14 - readings.length);

  // Get current readiness score from ML service
  let currentReadinessScore = 100;
  try {
    const scoreResponse = await axios.get(
      `${ML_SERVICE_URL}/readiness-score/${userId}`,
      { timeout: 5000 }
    );
    currentReadinessScore = scoreResponse.data.score;
  } catch (error) {
    // Use fallback
    const recentReadings = readings.slice(-7);
    if (recentReadings.length > 0) {
      const avgScore = recentReadings.reduce((sum, r) => sum + (r.readinessScore || 100), 0) / recentReadings.length;
      currentReadinessScore = Math.round(avgScore);
    }
  }

  // Get recent alerts
  let recentAlerts = 0;
  try {
    recentAlerts = await prisma.healthAlert.count({
      where: {
        userId,
        resolved: false,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    });
  } catch (error: any) {
    console.warn('[Monitoring] Failed to count alerts:', error?.message || error);
  }

  // Calculate trend
  const recentScores = readings.slice(-14).map(r => r.readinessScore || 100);
  let trend: 'STABLE' | 'IMPROVING' | 'DECLINING' = 'STABLE';
  if (recentScores.length >= 7) {
    const firstHalf = recentScores.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
    const secondHalf = recentScores.slice(7).reduce((a, b) => a + b, 0) / 7;
    if (secondHalf > firstHalf + 5) trend = 'IMPROVING';
    else if (secondHalf < firstHalf - 5) trend = 'DECLINING';
  }

  return {
    baselineEstablished,
    daysUntilBaseline,
    currentReadinessScore,
    recentAlerts,
    trend,
  };
}

