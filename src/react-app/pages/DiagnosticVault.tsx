import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import { FileText, Calendar, User, Brain, Stethoscope, AlertCircle, ChevronRight, ArrowLeft } from "lucide-react";

interface DiagnosticReport {
  id: number;
  report_type: string;
  symptoms: string;
  ai_analysis: string;
  ai_confidence: number;
  doctor_notes: string;
  diagnosis: string;
  recommendations: string;
  released_at: string;
  created_at: string;
}

export default function DiagnosticVault() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DiagnosticReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await fetch("/api/patient/diagnostic-reports");
      const data = await response.json();
      setReports(data.reports || []);
    } catch (error) {
      console.error("Failed to load reports:", error);
    } finally {
      setIsLoading(false);
    }
  };

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
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/patient/dashboard")}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </button>
          <div className="flex items-center space-x-4 mb-2">
            <div className="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center">
              <FileText className="w-7 h-7 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Diagnostic Vault</h1>
              <p className="text-gray-600">Your medical reports and health insights</p>
            </div>
          </div>
        </div>

        {/* Medical Disclaimer */}
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-1">Medical Disclaimer</h3>
              <p className="text-sm text-amber-800">
                All reports shown here have been reviewed and validated by licensed medical professionals. 
                These reports are for informational purposes. Always consult with your healthcare provider 
                for medical advice and treatment decisions.
              </p>
            </div>
          </div>
        </div>

        {!selectedReport ? (
          <>
            {/* Reports List */}
            {reports.length > 0 ? (
              <div className="grid gap-4">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                    className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg hover:border-purple-200 transition-all text-left"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-3">
                          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-purple-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">{report.report_type}</h3>
                            <div className="flex items-center space-x-4 mt-1">
                              <div className="flex items-center text-sm text-gray-500">
                                <Calendar className="w-4 h-4 mr-1" />
                                {new Date(report.released_at).toLocaleDateString()}
                              </div>
                              {report.ai_confidence && (
                                <div className="flex items-center text-sm text-gray-500">
                                  <Brain className="w-4 h-4 mr-1" />
                                  AI Confidence: {(report.ai_confidence * 100).toFixed(0)}%
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {report.diagnosis && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
                            <p className="text-sm font-medium text-blue-900">Diagnosis</p>
                            <p className="text-sm text-blue-800 line-clamp-2">{report.diagnosis}</p>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-6 h-6 text-gray-400 ml-4 flex-shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Reports Yet</h3>
                <p className="text-gray-600 mb-6 max-w-md mx-auto">
                  When you request a symptom analysis, it will be reviewed by a doctor and appear here 
                  once released.
                </p>
                <button
                  onClick={() => navigate("/patient/dashboard")}
                  className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            )}
          </>
        ) : (
          /* Report Detail View */
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Report Header */}
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 p-6">
              <button
                onClick={() => setSelectedReport(null)}
                className="flex items-center text-white/90 hover:text-white mb-4 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Reports
              </button>
              <h2 className="text-2xl font-bold text-white mb-2">{selectedReport.report_type}</h2>
              <div className="flex items-center space-x-4 text-white/90 text-sm">
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-1" />
                  Released: {new Date(selectedReport.released_at).toLocaleDateString()}
                </div>
                {selectedReport.ai_confidence && (
                  <div className="flex items-center">
                    <Brain className="w-4 h-4 mr-1" />
                    AI Confidence: {(selectedReport.ai_confidence * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Symptoms */}
              {selectedReport.symptoms && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center mr-2">
                      <AlertCircle className="w-5 h-5 text-gray-600" />
                    </div>
                    Reported Symptoms
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedReport.symptoms}</p>
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {selectedReport.ai_analysis && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-2">
                      <Brain className="w-5 h-5 text-purple-600" />
                    </div>
                    AI Preliminary Analysis
                  </h3>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedReport.ai_analysis}</p>
                  </div>
                </div>
              )}

              {/* Doctor's Diagnosis */}
              {selectedReport.diagnosis && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-2">
                      <Stethoscope className="w-5 h-5 text-blue-600" />
                    </div>
                    Doctor's Diagnosis
                  </h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedReport.diagnosis}</p>
                  </div>
                </div>
              )}

              {/* Doctor's Notes */}
              {selectedReport.doctor_notes && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center mr-2">
                      <User className="w-5 h-5 text-teal-600" />
                    </div>
                    Doctor's Notes
                  </h3>
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedReport.doctor_notes}</p>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {selectedReport.recommendations && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center mr-2">
                      <FileText className="w-5 h-5 text-emerald-600" />
                    </div>
                    Recommendations
                  </h3>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedReport.recommendations}</p>
                  </div>
                </div>
              )}

              {/* Footer Disclaimer */}
              <div className="pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center">
                  This report was created on {new Date(selectedReport.created_at).toLocaleDateString()} and 
                  released by a licensed medical professional on {new Date(selectedReport.released_at).toLocaleDateString()}.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
