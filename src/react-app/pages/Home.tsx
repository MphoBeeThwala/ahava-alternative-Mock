import { useAuth } from "@/react-app/lib/auth-context";
import { Activity, Heart, Shield, Users } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Redirect to onboarding if user is logged in (useEffect to avoid render-time navigation)
  useEffect(() => {
    if (user && !loading && !isRedirecting) {
      navigate("/onboarding");
    }
  }, [user, loading, isRedirecting, navigate]);

  const handleGoogleLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRedirecting(true);
    
    try {
      // Fetch the redirect URL from the API (bypasses React Router)
      const response = await fetch("/api/auth/sign-in/google?json=true", {
        method: "GET",
        credentials: "include",
        headers: {
          "Accept": "application/json",
        },
      });
      
      // Log response for debugging
      console.log("OAuth response status:", response.status);
      console.log("OAuth response headers:", Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("OAuth API error:", errorText);
        throw new Error(`Failed to get OAuth URL: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      console.log("OAuth redirect URL received:", data);
      
      if (data.redirectUrl) {
        // Navigate to Google OAuth (this bypasses React Router)
        window.location.href = data.redirectUrl;
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (error) {
      console.error("Google login error:", error);
      setIsRedirecting(false);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      alert(`Failed to start Google login: ${errorMessage}\n\nCheck the browser console for details.`);
    }
  };

  if (loading || isRedirecting || user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#004aad] to-[#0066cc] flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#004aad] via-[#0066cc] to-[#34d399]">
      {/* Navigation */}
      <nav className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <img 
                src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
                alt="Ahava Healthcare"
                className="h-10"
              />
              <span className="text-xl font-semibold text-white">Ahava Healthcare</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/login")}
                className="px-6 py-2.5 border-2 border-white text-white rounded-lg font-medium hover:bg-white/10 transition-all"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate("/signup")}
                className="px-6 py-2.5 bg-white text-[#004aad] rounded-lg font-medium hover:bg-gray-100 transition-all shadow-lg"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
              Revolutionizing Healthcare
              <br />
              <span className="text-[#34d399]">in South Africa</span>
            </h1>
            <p className="text-xl md:text-2xl text-white/90 mb-12 max-w-3xl mx-auto">
              AI-driven health monitoring and on-demand nursing logistics. 
              Your health, our priority.
            </p>
            <button
              onClick={handleGoogleLogin}
              className="px-8 py-4 bg-white text-[#004aad] rounded-lg text-lg font-semibold hover:bg-gray-100 transition-all shadow-2xl hover:shadow-3xl transform hover:scale-105"
            >
              Get Started with Google
            </button>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -z-10"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#34d399]/20 rounded-full blur-3xl -z-10"></div>
      </section>

      {/* Features Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Comprehensive Healthcare Platform
            </h2>
            <p className="text-xl text-gray-600">
              Built for patients, nurses, and healthcare professionals
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Feature 1 */}
            <div className="bg-gradient-to-br from-[#004aad]/5 to-[#004aad]/10 rounded-xl p-8 hover:shadow-xl transition-all">
              <div className="w-14 h-14 bg-[#004aad] rounded-lg flex items-center justify-center mb-6">
                <Activity className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">AI Health Monitoring</h3>
              <p className="text-gray-600">
                Real-time biometric tracking with intelligent baseline analysis and early warning alerts
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-gradient-to-br from-[#34d399]/5 to-[#34d399]/10 rounded-xl p-8 hover:shadow-xl transition-all">
              <div className="w-14 h-14 bg-[#34d399] rounded-lg flex items-center justify-center mb-6">
                <Users className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">On-Demand Nursing</h3>
              <p className="text-gray-600">
                Connect with verified nurses in your area within minutes for home visits and care
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-gradient-to-br from-[#004aad]/5 to-[#004aad]/10 rounded-xl p-8 hover:shadow-xl transition-all">
              <div className="w-14 h-14 bg-[#004aad] rounded-lg flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">POPIA Compliant</h3>
              <p className="text-gray-600">
                Your medical data is encrypted and stored securely in compliance with South African regulations
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-gradient-to-br from-[#34d399]/5 to-[#34d399]/10 rounded-xl p-8 hover:shadow-xl transition-all">
              <div className="w-14 h-14 bg-[#34d399] rounded-lg flex items-center justify-center mb-6">
                <Heart className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Doctor Oversight</h3>
              <p className="text-gray-600">
                All AI diagnostics reviewed by licensed medical practitioners before release
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#004aad] text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-white/80">
            © 2024 Ahava Healthcare. Revolutionizing Healthcare in South Africa.
          </p>
          <p className="text-sm text-white/60 mt-2">
            POPIA Compliant | HPCSA Registered
          </p>
        </div>
      </footer>
    </div>
  );
}
