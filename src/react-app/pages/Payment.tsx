import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";
import { CreditCard, Shield, CheckCircle2 } from "lucide-react";

const SERVICES = [
  { type: "CONSULTATION", name: "Video Consultation", price: "300.00", description: "30-min consultation with healthcare professional" },
  { type: "EMERGENCY", name: "Emergency Service", price: "500.00", description: "24/7 emergency medical response" },
  { type: "DIAGNOSTIC", name: "Diagnostic Analysis", price: "150.00", description: "AI-powered health assessment" },
  { type: "PRESCRIPTION", name: "Prescription Delivery", price: "100.00", description: "Medicine delivery to your door" },
  { type: "HOMECARE_HOURLY", name: "Home Care (Hourly)", price: "250.00", description: "Professional in-home healthcare" },
  { type: "HOMECARE_DAILY", name: "Home Care (Daily)", price: "1800.00", description: "24-hour in-home healthcare" },
  { type: "SUBSCRIPTION_MONTHLY", name: "Premium Monthly", price: "199.00", description: "Unlimited consultations + discounts" },
  { type: "SUBSCRIPTION_YEARLY", name: "Premium Yearly", price: "1999.00", description: "Best value - 2 months free!" },
];

export default function PaymentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedService, setSelectedService] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    if (!selectedService) {
      alert("Please select a service");
      return;
    }

    setLoading(true);

    try {
      const service = SERVICES.find((s) => s.type === selectedService);
      if (!service) {
        throw new Error("Invalid service selected");
      }

      // Create payment
      const response = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          serviceType: service.type,
          amount: service.price,
          itemName: service.name,
          itemDescription: service.description,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create payment");
      }

      const data = await response.json();

      // Redirect to PayFast
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.payFastUrl;

      Object.entries(data.paymentData).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = String(value);
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      console.error("Payment error:", error);
      alert(error instanceof Error ? error.message : "Payment failed");
      setLoading(false);
    }
  };

  if (!user) {
    navigate("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <CreditCard className="w-16 h-16 text-[#004aad] mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900">Select a Service</h1>
            <p className="text-gray-600 mt-2">Secure payment powered by PayFast</p>
          </div>

          <div className="grid gap-4 mb-8">
            {SERVICES.map((service) => (
              <button
                key={service.type}
                onClick={() => setSelectedService(service.type)}
                className={`p-6 rounded-lg border-2 text-left transition-all ${
                  selectedService === service.type
                    ? "border-[#004aad] bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{service.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{service.description}</p>
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-2xl font-bold text-[#004aad]">R{service.price}</div>
                    {selectedService === service.type && (
                      <CheckCircle2 className="w-6 h-6 text-green-600 ml-auto mt-2" />
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-semibold mb-1">Secure Payment</p>
                <p>Your payment is processed securely by PayFast, South Africa's leading payment gateway. We never store your card details.</p>
              </div>
            </div>
          </div>

          <button
            onClick={handlePayment}
            disabled={!selectedService || loading}
            className="w-full bg-[#004aad] text-white py-4 rounded-lg font-semibold hover:bg-[#003d8f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Processing..." : "Proceed to Payment"}
          </button>

          <p className="text-xs text-gray-500 text-center mt-4">
            By proceeding, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}

