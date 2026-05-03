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

import axios from "axios";
import prisma from "../lib/prisma";
import { mlServiceHeaders } from "./mlServiceAuth";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export interface MonitoringResult {
  alertLevel: "GREEN" | "YELLOW" | "RED";
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
  biometricData: any,
): Promise<MonitoringResult> {
  try {
    // Send to ML service for analysis
    const mlPayload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      heart_rate_resting:
        biometricData.heartRateResting || biometricData.heartRate || 70,
      hrv_rmssd: biometricData.hrvRmssd || 50,
      spo2: biometricData.oxygenSaturation || 98,
      skin_temp_offset: biometricData.skinTempOffset || 0,
      respiratory_rate: biometricData.respiratoryRate || 16,
      step_count: biometricData.stepCount || 0,
      active_calories: biometricData.activeCalories || 0,
    };
    if (biometricData.sleepDurationHours != null)
      mlPayload.sleep_duration_hours = biometricData.sleepDurationHours;
    if (biometricData.ecgRhythm) mlPayload.ecg_rhythm = biometricData.ecgRhythm;
    if (biometricData.temperatureTrend)
      mlPayload.temperature_trend = biometricData.temperatureTrend;

    const mlResponse = await axios.post(
      `${ML_SERVICE_URL}/ingest?user_id=${userId}`,
      mlPayload,
      {
        timeout: 5000,
        headers: mlServiceHeaders(),
      },
    );

    const alertLevel = mlResponse.data.alert_level as
      | "GREEN"
      | "YELLOW"
      | "RED";
    const anomalies = mlResponse.data.anomalies || [];

    // Get readiness score
    const scoreResponse = await axios.get(
      `${ML_SERVICE_URL}/readiness-score/${userId}`,
      {
        timeout: 5000,
        headers: mlServiceHeaders(),
      },
    );

    const readinessScore = scoreResponse.data.score || 100;
    const baselineStatus = scoreResponse.data.baseline_status || "STABLE";

    // Generate recommendations based on alert level and actual biometric values
    const recommendations = generateRecommendations(
      alertLevel,
      anomalies,
      baselineStatus,
      biometricData,
    );

    return {
      alertLevel,
      anomalies,
      readinessScore,
      baselineStatus,
      recommendations,
    };
  } catch (error: any) {
    console.warn(
      "[Monitoring] ML service unavailable, using fallback logic:",
      error.message,
    );

    // Fallback: Basic threshold checking
    // This ensures we always return valid values even when ML service is down
    return fallbackAnalysis(biometricData);
  }
}

/**
 * Generate health recommendations based on alert level
 * IMPROVED: Now returns specific, actionable guidance per anomaly type
 */
function generateRecommendations(
  alertLevel: "GREEN" | "YELLOW" | "RED",
  anomalies: string[],
  baselineStatus: string,
  biometricData?: any,
): string[] {
  const recommendations: string[] = [];

  if (baselineStatus === "CALIBRATING") {
    recommendations.push(
      "📊 Baseline establishment in progress. Continue regular monitoring.",
    );
    recommendations.push(
      `Your baseline will be complete after 14 days of consistent data.`,
    );
    return recommendations;
  }

  if (alertLevel === "GREEN") {
    recommendations.push(
      "✓ Your metrics look good. Keep up your current routine.",
    );
    return recommendations;
  }

  // ===== Heart Rate Specific =====
  if (anomalies.some((a) => a.includes("heart_rate"))) {
    if (biometricData?.heartRate > 85) {
      recommendations.push(
        "🔴 Resting heart rate elevated (+15% from baseline)",
      );
      recommendations.push("   → Reduce caffeine & stress, get 8 hours sleep");
      recommendations.push("   → Take deep breathing breaks (5 min, 3x/day)");
    } else if (biometricData?.heartRate < 50) {
      recommendations.push(
        "🔴 URGENT: Resting heart rate critically low (bradycardia)",
      );
      recommendations.push(
        "   → Seek medical attention - may indicate serious condition",
      );
    } else {
      recommendations.push("⚠️ Heart rate deviations detected");
      recommendations.push("   → Monitor closely, rest for next hour");
    }
  }

  // ===== HRV Specific =====
  if (anomalies.some((a) => a.includes("hrv"))) {
    recommendations.push(
      "⚠️ Heart Rate Variability below normal (-20% from baseline)",
    );
    recommendations.push(
      "   → Indicates: High stress, poor recovery, or infection",
    );
    recommendations.push(
      "   → Action: Reduce activity, increase rest (48 hours)",
    );
  }

  // ===== SpO2 Specific =====
  if (anomalies.some((a) => a.includes("spo2") || a.includes("oxygen"))) {
    if (biometricData?.spo2 < 92) {
      recommendations.push(
        "🔴 CRITICAL: Oxygen saturation dangerously low (<92%)",
      );
      recommendations.push("   → CALL 911 or seek immediate emergency care");
      recommendations.push(
        "   → Check for: breathing difficulty, chest pain, dizziness",
      );
    } else if (biometricData?.spo2 < 95) {
      recommendations.push("⚠️ Oxygen saturation below normal (95%)");
      recommendations.push(
        "   → May indicate: Respiratory infection or lung issue",
      );
      recommendations.push(
        "   → See doctor if combined with cough or breathing difficulty",
      );
    }
  }

  // ===== Respiratory Rate Specific =====
  if (anomalies.some((a) => a.includes("respiratory"))) {
    if (biometricData?.respiratoryRate > 20) {
      recommendations.push("⚠️ Rapid breathing detected (+25% from baseline)");
      recommendations.push(
        "   → Can indicate: Anxiety, infection, or physical exertion",
      );
      recommendations.push(
        "   → Monitor for other symptoms (fever, cough, chest pain)",
      );
    }
  }

  // ===== Temperature Specific =====
  if (biometricData?.temperature > 37.5) {
    recommendations.push("🔴 Fever detected (38.0°C / 100.4°F)");
    recommendations.push("   → Sign of infection - likely bacterial or viral");
    recommendations.push("   → Action: Stay hydrated, rest, monitor symptoms");
    recommendations.push("   → See doctor if temp >39.5°C or persists >3 days");
  }

  // ===== Multiple Anomalies - High Risk =====
  if (anomalies.length > 2 && alertLevel === "RED") {
    recommendations.unshift("🚨 MULTIPLE ANOMALIES DETECTED:");
    recommendations.push("   → Your body is showing significant stress");
    recommendations.push(
      "   → STRONGLY recommend medical consultation within 24 hours",
    );
  }

  // Default message if no specific recommendations
  if (recommendations.length === 0) {
    if (alertLevel === "YELLOW") {
      recommendations.push("📊 One or more metrics slightly elevated.");
      recommendations.push("   → Monitor closely over next 24-48 hours.");
    } else if (alertLevel === "RED") {
      recommendations.push("🚨 Multiple metrics significantly abnormal.");
      recommendations.push(
        "   → Consider consulting healthcare provider today.",
      );
    }
  }

  return recommendations;
}

/**
 * Fallback analysis when ML service is unavailable
 */
function fallbackAnalysis(biometricData: any): MonitoringResult {
  const anomalies: string[] = [];
  let alertLevel: "GREEN" | "YELLOW" | "RED" = "GREEN";

  // Basic threshold checks
  const heartRate = biometricData.heartRateResting || biometricData.heartRate;
  if (heartRate) {
    if (heartRate > 100) {
      anomalies.push("Elevated resting heart rate");
      alertLevel = "YELLOW";
    } else if (heartRate > 120) {
      anomalies.push("Significantly elevated heart rate");
      alertLevel = "RED";
    }
  }

  if (biometricData.oxygenSaturation) {
    if (biometricData.oxygenSaturation < 95) {
      anomalies.push("Low oxygen saturation");
      alertLevel = alertLevel === "RED" ? "RED" : "YELLOW";
    } else if (biometricData.oxygenSaturation < 90) {
      anomalies.push("Critically low oxygen saturation");
      alertLevel = "RED";
    }
  }

  if (biometricData.bloodPressure) {
    const { systolic, diastolic } = biometricData.bloodPressure;
    if (systolic > 140 || diastolic > 90) {
      anomalies.push("Elevated blood pressure");
      alertLevel = alertLevel === "RED" ? "RED" : "YELLOW";
    }
  }

  if (biometricData.respiratoryRate) {
    if (biometricData.respiratoryRate > 20) {
      anomalies.push("Elevated respiratory rate");
      alertLevel = alertLevel === "RED" ? "RED" : "YELLOW";
    }
  }

  return {
    alertLevel,
    anomalies,
    readinessScore:
      alertLevel === "GREEN" ? 100 : alertLevel === "YELLOW" ? 70 : 40,
    baselineStatus: "STABLE",
    recommendations: generateRecommendations(
      alertLevel,
      anomalies,
      "STABLE",
      biometricData,
    ),
  };
}

/**
 * Check for early warning signs of specific conditions
 */
export function detectEarlyWarningSigns(
  anomalies: string[],
  biometricData: any,
): {
  condition: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  timeWindow: string;
}[] {
  const warnings: Array<{
    condition: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    timeWindow: string;
  }> = [];

  // Heart attack precursors
  const hasHeartRateAnomaly = anomalies.some((a) => a.includes("heart_rate"));
  const hasHRVAnomaly = anomalies.some((a) => a.includes("hrv"));
  if (hasHeartRateAnomaly && hasHRVAnomaly) {
    warnings.push({
      condition: "Cardiovascular Event Risk",
      riskLevel: "HIGH",
      timeWindow: "Days to weeks ahead",
    });
  } else if (hasHeartRateAnomaly || hasHRVAnomaly) {
    warnings.push({
      condition: "Cardiovascular Stress",
      riskLevel: "MEDIUM",
      timeWindow: "Days to weeks ahead",
    });
  }

  // Respiratory infection precursors
  const hasRespiratoryAnomaly = anomalies.some((a) =>
    a.includes("respiratory"),
  );
  const hasOxygenAnomaly = anomalies.some(
    (a) => a.includes("spo2") || a.includes("oxygen"),
  );
  if (hasRespiratoryAnomaly && hasOxygenAnomaly) {
    warnings.push({
      condition: "Respiratory Infection Risk",
      riskLevel: "MEDIUM",
      timeWindow: "Days ahead",
    });
  }

  // Temperature elevation (infection indicator)
  if (biometricData.temperature && biometricData.temperature > 37.5) {
    warnings.push({
      condition: "Possible Infection",
      riskLevel: "MEDIUM",
      timeWindow: "Hours to days ahead",
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
  trend: "STABLE" | "IMPROVING" | "DECLINING";
}> {
  // Get baseline status (select only columns that exist in all environments)
  let readings: any[] = [];
  try {
    readings = await prisma.biometricReading.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        readinessScore: true,
      },
    });
  } catch (error: any) {
    console.warn(
      "[Monitoring] Failed to fetch readings:",
      error?.message || error,
    );
  }

  const baselineEstablished = readings.length >= 14;
  const daysUntilBaseline = baselineEstablished
    ? 0
    : Math.max(0, 14 - readings.length);

  // Get current readiness score from ML service
  let currentReadinessScore = 100;
  try {
    const scoreResponse = await axios.get(
      `${ML_SERVICE_URL}/readiness-score/${userId}`,
      {
        timeout: 5000,
        headers: mlServiceHeaders(),
      },
    );
    currentReadinessScore = scoreResponse.data.score;
  } catch (error) {
    // Use fallback
    const recentReadings = readings.slice(-7);
    if (recentReadings.length > 0) {
      const avgScore =
        recentReadings.reduce((sum, r) => sum + (r.readinessScore || 100), 0) /
        recentReadings.length;
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
    console.warn(
      "[Monitoring] Failed to count alerts:",
      error?.message || error,
    );
  }

  // Calculate trend
  const recentScores = readings.slice(-14).map((r) => r.readinessScore || 100);
  let trend: "STABLE" | "IMPROVING" | "DECLINING" = "STABLE";
  if (recentScores.length >= 7) {
    const firstHalf = recentScores.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
    const secondHalf = recentScores.slice(7).reduce((a, b) => a + b, 0) / 7;
    if (secondHalf > firstHalf + 5) trend = "IMPROVING";
    else if (secondHalf < firstHalf - 5) trend = "DECLINING";
  }

  return {
    baselineEstablished,
    daysUntilBaseline,
    currentReadinessScore,
    recentAlerts,
    trend,
  };
}
