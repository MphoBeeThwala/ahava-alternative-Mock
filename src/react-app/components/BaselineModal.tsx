import { useState } from "react";
import { X, TrendingUp, Activity, CheckCircle, AlertCircle } from "lucide-react";

interface BaselineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface BaselineResult {
  success: boolean;
  baseline: Record<string, { mean: number; stddev: number; count: number }>;
  insights: {
    overall_assessment: string;
    metric_insights: Record<string, string>;
    concerns: string[];
    recommendations: string[];
  };
  period: { start: string; end: string };
}

export default function BaselineModal({ isOpen, onClose, onSuccess }: BaselineModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BaselineResult | null>(null);

  if (!isOpen) return null;

  const handleEstablishBaseline = async () => {
    setIsProcessing(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/establish-baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
        onSuccess();
      } else {
        setError(data.error || "Failed to establish baseline");
      }
    } catch (err) {
      setError("Failed to establish baseline. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setError("");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-emerald-600 to-teal-600 p-6 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Health Baseline</h2>
                <p className="text-emerald-100 text-sm">Establish your personalized health profile</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {!result && !isProcessing && (
            <>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">What is a Health Baseline?</h3>
                <p className="text-gray-600 leading-relaxed mb-4">
                  Your health baseline is a personalized profile created by analyzing your historical biometric data. 
                  It establishes what's "normal" for your body, allowing our AI to detect unusual patterns and 
                  potential health issues early.
                </p>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-blue-900 mb-2">What we analyze:</h4>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Heart rate patterns and variability</li>
                    <li>Blood oxygen levels (SpO2)</li>
                    <li>Heart rate variability (HRV)</li>
                    <li>Respiratory rate and skin temperature</li>
                    <li>Activity and sleep patterns</li>
                  </ul>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-amber-900 mb-1">Requirements</h4>
                      <p className="text-sm text-amber-800">
                        You need at least 20 biometric readings collected over several days to establish 
                        an accurate baseline. The more data we have, the better your personalized profile will be.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <button
                onClick={handleEstablishBaseline}
                className="w-full px-6 py-4 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
              >
                Establish My Baseline
              </button>
            </>
          )}

          {isProcessing && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Activity className="w-8 h-8 text-emerald-600 animate-pulse" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Analyzing Your Health Data</h3>
              <p className="text-gray-600">
                Our AI is processing your biometric data to establish your personalized baseline...
              </p>
            </div>
          )}

          {result && (
            <div className="space-y-6">
              {/* Success Message */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                  <div>
                    <h3 className="font-semibold text-emerald-900">Baseline Established Successfully</h3>
                    <p className="text-sm text-emerald-700">
                      Analysis period: {new Date(result.period.start).toLocaleDateString()} - {new Date(result.period.end).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Overall Assessment */}
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                <h4 className="font-semibold text-gray-900 mb-3">Overall Health Assessment</h4>
                <p className="text-gray-700 leading-relaxed">{result.insights.overall_assessment}</p>
              </div>

              {/* Baseline Metrics */}
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                <h4 className="font-semibold text-gray-900 mb-4">Your Baseline Metrics</h4>
                <div className="grid md:grid-cols-2 gap-4">
                  {Object.entries(result.baseline).map(([type, stats]) => (
                    <div key={type} className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-600 mb-1">{type}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {stats.mean.toFixed(1)} <span className="text-sm text-gray-500">± {stats.stddev.toFixed(1)}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{stats.count} readings</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Metric Insights */}
              {Object.keys(result.insights.metric_insights).length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-5">
                  <h4 className="font-semibold text-gray-900 mb-3">Metric Insights</h4>
                  <div className="space-y-3">
                    {Object.entries(result.insights.metric_insights).map(([metric, insight]) => (
                      <div key={metric} className="border-l-4 border-blue-400 pl-4">
                        <p className="font-medium text-gray-900">{metric}</p>
                        <p className="text-sm text-gray-600 mt-1">{insight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Concerns */}
              {result.insights.concerns.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                  <h4 className="font-semibold text-amber-900 mb-3">Points to Monitor</h4>
                  <ul className="space-y-2">
                    {result.insights.concerns.map((concern, idx) => (
                      <li key={idx} className="flex items-start space-x-2 text-sm text-amber-800">
                        <span className="w-1.5 h-1.5 bg-amber-600 rounded-full mt-1.5 flex-shrink-0"></span>
                        <span>{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {result.insights.recommendations.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
                  <h4 className="font-semibold text-emerald-900 mb-3">Recommendations</h4>
                  <ul className="space-y-2">
                    {result.insights.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start space-x-2 text-sm text-emerald-800">
                        <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={handleClose}
                className="w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
