import { useState } from "react";
import { AlertOctagon, X, MapPin, Phone, AlertTriangle } from "lucide-react";
import { 
  handleEmergencyAlert, 
  getCurrentLocation, 
  getDeviceInfo,
  type EmergencyAlertPayload 
} from "@/shared/actions";

interface PanicButtonProps {
  appointmentId?: number;
  userProfile?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
  };
}

export default function PanicButton({ appointmentId, userProfile }: PanicButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [alertTriggered, setAlertTriggered] = useState(false);
  const [alertId, setAlertId] = useState<string | undefined>();
  const [usingFallback, setUsingFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerPanicAlert = async () => {
    setIsTriggering(true);
    setError(null);

    try {
      // Get current location with high accuracy
      const location = await getCurrentLocation();

      // Prepare Aura API payload
      const payload: EmergencyAlertPayload = {
        alertType: 'PANIC',
        severity: 'CRITICAL',
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.address,
          accuracy: location.accuracy,
        },
        user: {
          id: userProfile?.id || 'unknown',
          name: userProfile?.name || 'Healthcare Worker',
          phone: userProfile?.phone,
          email: userProfile?.email,
        },
        details: {
          appointmentId,
          notes: 'Emergency panic button triggered by healthcare worker',
          timestamp: new Date().toISOString(),
          deviceInfo: getDeviceInfo(),
        },
      };

      // Send to Aura API (with fallback to local storage)
      const result = await handleEmergencyAlert(payload);

      if (result.success) {
        setAlertId(result.alertId);
        setUsingFallback(result.usingFallback || false);
        setAlertTriggered(true);
        setShowConfirm(false);

        // Auto-hide success message after 8 seconds
        setTimeout(() => {
          setAlertTriggered(false);
          setAlertId(undefined);
          setUsingFallback(false);
        }, 8000);
      } else {
        throw new Error('Failed to send emergency alert');
      }
    } catch (error) {
      console.error("Failed to trigger panic alert:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      
      // Show fallback contact info
      alert(
        `⚠️ Emergency Alert Error\n\n${errorMessage}\n\nPlease call emergency services directly:\n10111 (Police) • 10177 (Ambulance)`
      );
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <>
      {/* Panic Button */}
      <button
        onClick={() => setShowConfirm(true)}
        className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors flex items-center space-x-2 shadow-lg hover:shadow-xl"
      >
        <AlertOctagon className="w-4 h-4" />
        <span>Emergency</span>
      </button>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertOctagon className="w-6 h-6 text-red-600" />
              </div>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              Trigger Emergency Alert?
            </h3>
            <p className="text-gray-600 mb-6">
              This will immediately notify emergency contacts and administrators of your location and situation.
            </p>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800 font-medium mb-2">
                What happens when you trigger this alert:
              </p>
              <ul className="text-sm text-red-700 space-y-1">
                <li>• Your current location will be logged</li>
                <li>• Emergency contacts will be notified</li>
                <li>• Admin dashboard will show active alert</li>
                <li>• Your safety status will be monitored</li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 font-medium mb-2">
                Emergency Services:
              </p>
              <div className="flex items-center space-x-2 text-sm text-gray-900">
                <Phone className="w-4 h-4" />
                <span className="font-bold">10111 (Police) • 10177 (Ambulance)</span>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                disabled={isTriggering}
              >
                Cancel
              </button>
              <button
                onClick={triggerPanicAlert}
                disabled={isTriggering}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:bg-red-400 disabled:cursor-not-allowed"
              >
                {isTriggering ? "Sending Alert..." : "Trigger Alert"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {alertTriggered && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-6 py-4 rounded-lg shadow-2xl max-w-md z-50 animate-slide-in">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Emergency Alert Sent</p>
              <p className="text-sm text-white/90">
                {usingFallback 
                  ? 'Alert logged locally. Emergency services being notified via backup system.'
                  : 'Aura emergency services notified of your location.'}
              </p>
              {alertId && !usingFallback && (
                <p className="text-xs text-white/70 mt-1">Alert ID: {alertId}</p>
              )}
              {usingFallback && (
                <div className="flex items-center mt-2 text-xs text-yellow-200">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  <span>Backup mode active</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-6 py-4 rounded-lg shadow-2xl max-w-md z-50 animate-slide-in">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Alert Failed</p>
              <p className="text-sm text-white/90">{error}</p>
              <p className="text-xs text-white/70 mt-2">Call: 10111 (Police) • 10177 (Ambulance)</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-white/80 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
