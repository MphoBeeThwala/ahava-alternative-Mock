import { useState } from "react";
import { X, MapPin, Clipboard } from "lucide-react";

interface RequestNurseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userAddress: string;
}

export default function RequestNurseModal({ isOpen, onClose, onSuccess, userAddress }: RequestNurseModalProps) {
  const [formData, setFormData] = useState({
    service_type: "HOME_VISIT",
    patient_address: userAddress,
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          patient_latitude: null,
          patient_longitude: null,
        }),
      });

      if (response.ok) {
        onSuccess();
        onClose();
        setFormData({
          service_type: "HOME_VISIT",
          patient_address: userAddress,
          notes: "",
        });
      }
    } catch (error) {
      console.error("Failed to create appointment:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Request a Nurse</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Service Type
            </label>
            <select
              value={formData.service_type}
              onChange={(e) => setFormData({ ...formData, service_type: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
            >
              <option value="HOME_VISIT">Home Visit</option>
              <option value="MEDICATION_ADMINISTRATION">Medication Administration</option>
              <option value="WOUND_CARE">Wound Care</option>
              <option value="VITAL_SIGNS_CHECK">Vital Signs Check</option>
              <option value="HEALTH_ASSESSMENT">Health Assessment</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Visit Address
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={formData.patient_address}
                onChange={(e) => setFormData({ ...formData, patient_address: e.target.value })}
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
                placeholder="Enter visit address"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Additional Notes
            </label>
            <div className="relative">
              <Clipboard className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent resize-none"
                placeholder="Any specific requirements or health concerns..."
              />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> A verified nurse within 15km of your location will be notified of your request. You'll receive a confirmation once a nurse accepts.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-[#004aad] text-white rounded-lg font-medium hover:bg-[#003a8c] transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Requesting..." : "Request Nurse"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
