import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import { FileText, Clock, CheckCircle, AlertCircle, User } from "lucide-react";

interface Profile {
  full_name: string;
  role: string;
  sanc_id: string;
}

interface DiagnosticReport {
  id: number;
  patient_id: string;
  report_type: string;
  ai_analysis: string;
  ai_confidence: number;
  symptoms: string;
  doctor_notes: string;
  diagnosis: string;
  recommendations: string;
  is_released: number;
  created_at: string;
}

export default function DoctorDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DiagnosticReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewData, setReviewData] = useState({
    doctor_notes: "",
    diagnosis: "",
    recommendations: "",
  });

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (profile) {
      loadReports();
    }
  }, [profile, filter]);

  const loadProfile = async () => {
    try {
      const response = await fetch("/api/profile");
      const data = await response.json();

      if (data.profile?.role !== "DOCTOR") {
        navigate("/onboarding");
        return;
      }

      setProfile(data.profile);
    } catch (error) {
      console.error("Failed to load profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      const response = await fetch(`/api/diagnostic-reports?status=${filter}`);
      const data = await response.json();
      setReports(data.reports || []);
    } catch (error) {
      console.error("Failed to load reports:", error);
    }
  };

  const selectReport = (report: DiagnosticReport) => {
    setSelectedReport(report);
    setReviewData({
      doctor_notes: report.doctor_notes || "",
      diagnosis: report.diagnosis || "",
      recommendations: report.recommendations || "",
    });
  };

  const handleReview = async () => {
    if (!selectedReport) return;

    try {
      await fetch(`/api/diagnostic-reports/${selectedReport.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewData),
      });

      loadReports();
      setSelectedReport(null);
    } catch (error) {
      console.error("Failed to submit review:", error);
    }
  };

  const handleRelease = async () => {
    if (!selectedReport) return;

    if (!reviewData.doctor_notes || !reviewData.diagnosis) {
      alert("Please complete your review before releasing the report to the patient.");
      return;
    }

    try {
      await fetch(`/api/diagnostic-reports/${selectedReport.id}/release`, {
        method: "POST",
      });

      loadReports();
      setSelectedReport(null);
      setReviewData({ doctor_notes: "", diagnosis: "", recommendations: "" });
    } catch (error) {
      console.error("Failed to release report:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#8b5cf6]"></div>
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
              <span className="px-3 py-1 bg-purple-100 text-purple-700 text-sm font-medium rounded-full">
                Doctor Portal
              </span>
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Diagnostic Review Portal</h1>
          <p className="text-gray-600">Review AI-generated diagnostic reports and provide expert oversight</p>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => setFilter("pending")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === "pending"
                ? "bg-[#8b5cf6] text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Pending Review
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === "all"
                ? "bg-[#8b5cf6] text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            All Reports
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Reports List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {filter === "pending" ? "Pending Reports" : "All Reports"}
            </h3>
            
            {reports.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">
                  {filter === "pending" ? "No pending reports" : "No reports found"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => selectReport(report)}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      selectedReport?.id === report.id
                        ? "border-[#8b5cf6] bg-purple-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">
                          {report.report_type}
                        </h4>
                        <p className="text-sm text-gray-600 flex items-center">
                          <User className="w-4 h-4 mr-1" />
                          Patient ID: {report.patient_id.slice(0, 8)}...
                        </p>
                      </div>
                      {report.is_released === 1 ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <Clock className="w-5 h-5 text-orange-600" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>
                        {new Date(report.created_at).toLocaleDateString()}
                      </span>
                      {report.ai_confidence && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                          AI: {(report.ai_confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Report Detail & Review */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {selectedReport ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Report Details</h3>
                  
                  {/* AI Analysis Section */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center mb-2">
                      <AlertCircle className="w-5 h-5 text-blue-600 mr-2" />
                      <h4 className="font-semibold text-blue-900">AI Analysis</h4>
                    </div>
                    {selectedReport.symptoms && (
                      <div className="mb-3">
                        <p className="text-sm font-medium text-blue-800 mb-1">Symptoms:</p>
                        <p className="text-sm text-blue-900">{selectedReport.symptoms}</p>
                      </div>
                    )}
                    {selectedReport.ai_analysis && (
                      <div>
                        <p className="text-sm font-medium text-blue-800 mb-1">AI Findings:</p>
                        <p className="text-sm text-blue-900">{selectedReport.ai_analysis}</p>
                      </div>
                    )}
                    {selectedReport.ai_confidence && (
                      <p className="text-xs text-blue-700 mt-2">
                        Confidence: {(selectedReport.ai_confidence * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>

                  {/* Doctor Review Form */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Doctor's Notes *
                      </label>
                      <textarea
                        value={reviewData.doctor_notes}
                        onChange={(e) =>
                          setReviewData({ ...reviewData, doctor_notes: e.target.value })
                        }
                        rows={4}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent resize-none"
                        placeholder="Your clinical assessment and observations..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Diagnosis *
                      </label>
                      <textarea
                        value={reviewData.diagnosis}
                        onChange={(e) =>
                          setReviewData({ ...reviewData, diagnosis: e.target.value })
                        }
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent resize-none"
                        placeholder="Final diagnosis..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Recommendations
                      </label>
                      <textarea
                        value={reviewData.recommendations}
                        onChange={(e) =>
                          setReviewData({ ...reviewData, recommendations: e.target.value })
                        }
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent resize-none"
                        placeholder="Treatment plan and follow-up recommendations..."
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleReview}
                      className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                    >
                      Save Review
                    </button>
                    <button
                      onClick={handleRelease}
                      disabled={selectedReport.is_released === 1}
                      className="flex-1 px-6 py-3 bg-[#8b5cf6] text-white rounded-lg font-medium hover:bg-[#7c3aed] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {selectedReport.is_released === 1 ? "Released" : "Release to Patient"}
                    </button>
                  </div>

                  {selectedReport.is_released === 1 && (
                    <p className="text-sm text-green-600 text-center mt-2">
                      ✓ This report has been released to the patient
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">Select a report to review</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
