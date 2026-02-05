import { useState } from "react";
import { useNavigate } from "react-router";
import { Activity, Stethoscope, UserRound } from "lucide-react";
import MedicalDisclaimer from "@/react-app/components/MedicalDisclaimer";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"role" | "terms" | "details">("role");
  const [role, setRole] = useState<"PATIENT" | "NURSE" | "DOCTOR" | null>(null);
  const [formData, setFormData] = useState({
    full_name: "",
    phone_number: "",
    address: "",
    sanc_id: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRoleSelect = (selectedRole: "PATIENT" | "NURSE" | "DOCTOR") => {
    setRole(selectedRole);
    setStep("terms");
  };

  const handleTermsAccept = () => {
    setStep("details");
  };

  const handleTermsDecline = () => {
    setRole(null);
    setStep("role");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          role,
          latitude: null,
          longitude: null,
          has_accepted_terms: true,
          terms_accepted_at: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        // Navigate based on role
        if (role === "PATIENT") {
          navigate("/patient/dashboard");
        } else if (role === "NURSE") {
          navigate("/nurse/dashboard");
        } else if (role === "DOCTOR") {
          navigate("/doctor/dashboard");
        }
      }
    } catch (error) {
      console.error("Profile creation failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "role") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#004aad] to-[#0066cc] flex items-center justify-center px-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12">
            <img 
              src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
              alt="Ahava Healthcare"
              className="h-16 mx-auto mb-6"
            />
            <h1 className="text-4xl font-bold text-white mb-4">Welcome to Ahava Healthcare</h1>
            <p className="text-xl text-white/90">Select your role to get started</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Patient Card */}
            <button
              onClick={() => handleRoleSelect("PATIENT")}
              className="bg-white rounded-2xl p-8 hover:shadow-2xl transition-all transform hover:scale-105 text-left group"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-[#004aad] to-[#0066cc] rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Activity className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Patient</h3>
              <p className="text-gray-600 leading-relaxed">
                Monitor your health with AI-driven insights and connect with nurses for home care
              </p>
            </button>

            {/* Nurse Card */}
            <button
              onClick={() => handleRoleSelect("NURSE")}
              className="bg-white rounded-2xl p-8 hover:shadow-2xl transition-all transform hover:scale-105 text-left group"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-[#34d399] to-[#10b981] rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <UserRound className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Nurse</h3>
              <p className="text-gray-600 leading-relaxed">
                Accept appointments, provide home care, and earn on your schedule
              </p>
            </button>

            {/* Doctor Card */}
            <button
              onClick={() => handleRoleSelect("DOCTOR")}
              className="bg-white rounded-2xl p-8 hover:shadow-2xl transition-all transform hover:scale-105 text-left group"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-[#8b5cf6] to-[#7c3aed] rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Stethoscope className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Doctor</h3>
              <p className="text-gray-600 leading-relaxed">
                Review AI diagnostics and provide expert medical oversight
              </p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "terms") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#004aad] to-[#0066cc] flex items-center justify-center px-4 py-12">
        <div className="max-w-4xl w-full">
          <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-12">
            <MedicalDisclaimer 
              onAccept={handleTermsAccept}
              onDecline={handleTermsDecline}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#004aad] to-[#0066cc] flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-12">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Complete Your Profile</h2>
            <p className="text-gray-600">
              {role === "PATIENT" && "Set up your patient account"}
              {role === "NURSE" && "Set up your nurse account"}
              {role === "DOCTOR" && "Set up your doctor account"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
                placeholder="+27 XX XXX XXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Address *
              </label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
                placeholder="Street address, City, Province"
              />
            </div>

            {(role === "NURSE" || role === "DOCTOR") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SANC Registration Number {role === "NURSE" && "*"}
                </label>
                <input
                  type="text"
                  required={role === "NURSE"}
                  value={formData.sanc_id}
                  onChange={(e) => setFormData({ ...formData, sanc_id: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004aad] focus:border-transparent"
                  placeholder="SANC Registration Number"
                />
                <p className="text-sm text-gray-500 mt-1">
                  South African Nursing Council registration required for verification
                </p>
              </div>
            )}

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={() => setStep("terms")}
                className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 bg-[#004aad] text-white rounded-lg font-medium hover:bg-[#003a8c] transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Creating Profile..." : "Complete Setup"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
