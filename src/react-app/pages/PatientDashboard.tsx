import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import { Activity, Heart, FileText, AlertCircle, MapPin, Brain, TrendingUp } from "lucide-react";
import RequestNurseModal from "@/react-app/components/RequestNurseModal";
import SymptomAnalysisModal from "@/react-app/components/SymptomAnalysisModal";
import BaselineModal from "@/react-app/components/BaselineModal";

interface Profile {
  full_name: string;
  role: string;
  phone_number: string;
  address: string;
}

interface Biometric {
  id: number;
  type: string;
  value: number;
  recorded_at: string;
}

interface Baseline {
  hr_baseline_mean: number | null;
  hrv_baseline_mean: number | null;
  spo2_baseline_mean: number | null;
  is_complete: number;
  updated_at: string;
}

export default function PatientDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [biometrics, setBiometrics] = useState<Biometric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showBaselineModal, setShowBaselineModal] = useState(false);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [reportCount, setReportCount] = useState(0);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [profileRes, biometricsRes, baselineRes, reportsRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/biometrics?limit=20"),
        fetch("/api/baseline"),
        fetch("/api/patient/diagnostic-reports"),
      ]);

      const profileData = await profileRes.json();
      const biometricsData = await biometricsRes.json();
      const baselineData = await baselineRes.json();
      const reportsData = await reportsRes.json();

      if (profileData.profile?.role !== "PATIENT") {
        navigate("/onboarding");
        return;
      }

      setProfile(profileData.profile);
      setBiometrics(biometricsData.biometrics || []);
      setBaseline(baselineData.baseline);
      setReportCount(reportsData.reports?.length || 0);
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getLatestBiometric = (type: string) => {
    return biometrics.find((b) => b.type === type);
  };

  const hrData = getLatestBiometric("HR");
  const spo2Data = getLatestBiometric("SPO2");
  const hrvData = getLatestBiometric("HRV");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#004aad]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <img 
                src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
                alt="Ahava Healthcare"
                className="h-10"
              />
              <span className="text-xl font-semibold text-[#004aad]">Ahava Healthcare</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{profile?.full_name}</span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back, {profile?.full_name?.split(" ")[0]}
          </h1>
          <p className="text-gray-600">Here's your health overview for today</p>
        </div>

        {/* Baseline Status Banner */}
        {!baseline?.is_complete && biometrics.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Establish Your Health Baseline
                  </h3>
                  <p className="text-gray-600 text-sm mb-3">
                    Let our AI analyze your health data to create a personalized profile. This helps us detect unusual 
                    patterns and potential health issues early.
                  </p>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                      {biometrics.length} readings collected
                    </span>
                    {biometrics.length >= 20 && (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                        ✓ Ready to establish
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowBaselineModal(true)}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors flex-shrink-0"
              >
                Get Started
              </button>
            </div>
          </div>
        )}

        {baseline?.is_complete && (
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Health Baseline Active
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Your personalized baseline is monitoring for unusual patterns. Last updated {new Date(baseline.updated_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBaselineModal(true)}
                className="px-5 py-2.5 bg-white text-blue-600 border border-blue-200 rounded-lg font-medium hover:bg-blue-50 transition-colors"
              >
                View Details
              </button>
            </div>
          </div>
        )}

        {/* Health Status Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Heart Rate Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <Heart className="w-6 h-6 text-red-600" />
              </div>
              <span className="text-xs font-medium text-gray-500 uppercase">Heart Rate</span>
            </div>
            {hrData ? (
              <>
                <div className="text-3xl font-bold text-gray-900 mb-1">
                  {hrData.value} <span className="text-lg text-gray-500">bpm</span>
                </div>
                <p className="text-sm text-gray-600">Normal range</p>
              </>
            ) : (
              <p className="text-gray-500">No data yet</p>
            )}
          </div>

          {/* SpO2 Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
              <span className="text-xs font-medium text-gray-500 uppercase">Blood Oxygen</span>
            </div>
            {spo2Data ? (
              <>
                <div className="text-3xl font-bold text-gray-900 mb-1">
                  {spo2Data.value} <span className="text-lg text-gray-500">%</span>
                </div>
                <p className="text-sm text-gray-600">Excellent</p>
              </>
            ) : (
              <p className="text-gray-500">No data yet</p>
            )}
          </div>

          {/* HRV Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Activity className="w-6 h-6 text-green-600" />
              </div>
              <span className="text-xs font-medium text-gray-500 uppercase">HRV</span>
            </div>
            {hrvData ? (
              <>
                <div className="text-3xl font-bold text-gray-900 mb-1">
                  {hrvData.value} <span className="text-lg text-gray-500">ms</span>
                </div>
                <p className="text-sm text-gray-600">Good recovery</p>
              </>
            ) : (
              <p className="text-gray-500">No data yet</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* AI Symptom Analysis Card */}
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl p-8 text-white">
            <div className="w-14 h-14 bg-white/20 rounded-lg flex items-center justify-center mb-4">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">AI Symptom Analysis</h3>
            <p className="text-purple-100 mb-6">
              Get preliminary diagnostic insights reviewed by a doctor
            </p>
            <button 
              onClick={() => setShowAnalysisModal(true)}
              className="px-6 py-3 bg-white text-purple-600 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Request Analysis
            </button>
          </div>

          {/* Request Nurse Card */}
          <div className="bg-gradient-to-br from-[#004aad] to-[#0066cc] rounded-xl p-8 text-white">
            <div className="w-14 h-14 bg-white/20 rounded-lg flex items-center justify-center mb-4">
              <MapPin className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Need Home Care?</h3>
            <p className="text-white/90 mb-6">
              Connect with a verified nurse in your area for home visits
            </p>
            <button 
              onClick={() => setShowRequestModal(true)}
              className="px-6 py-3 bg-white text-[#004aad] rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Request a Nurse
            </button>
          </div>

          {/* Diagnostic Vault */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate("/patient/diagnostic-vault")}>
            <div className="w-14 h-14 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <FileText className="w-7 h-7 text-purple-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Diagnostic Vault</h3>
            <p className="text-gray-600 mb-6">
              View your medical reports and AI health insights
            </p>
            {reportCount > 0 ? (
              <div className="flex items-center text-sm font-medium text-purple-600">
                <FileText className="w-4 h-4 mr-2" />
                <span>{reportCount} report{reportCount !== 1 ? 's' : ''} available</span>
              </div>
            ) : (
              <div className="flex items-center text-sm text-gray-500">
                <AlertCircle className="w-4 h-4 mr-2" />
                <span>No reports yet</span>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Recent Health Data</h3>
          {biometrics.length > 0 ? (
            <div className="space-y-3">
              {biometrics.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mr-3">
                      <Activity className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{item.type}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(item.recorded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-gray-900">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              No health data recorded yet. Connect your wearable device to start tracking.
            </p>
          )}
        </div>
      </main>

      <RequestNurseModal
        isOpen={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        onSuccess={() => {
          // Optionally reload data or show success message
        }}
        userAddress={profile?.address || ""}
      />

      <SymptomAnalysisModal
        isOpen={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        onSuccess={() => {
          // Optionally show success notification
        }}
      />

      <BaselineModal
        isOpen={showBaselineModal}
        onClose={() => setShowBaselineModal(false)}
        onSuccess={() => {
          loadDashboardData();
        }}
      />
    </div>
  );
}
