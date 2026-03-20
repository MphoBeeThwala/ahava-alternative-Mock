import { useAuth } from "@/react-app/lib/auth-context";
import { getApiBase, isNative } from "@/react-app/lib/native";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (user && !loading && !isRedirecting) {
      navigate("/onboarding");
    }
  }, [user, loading, isRedirecting, navigate]);

  const handleGoogleLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRedirecting(true);
    try {
      const response = await fetch(`${getApiBase()}/api/auth/sign-in/google?json=true`, {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!response.ok) throw new Error(`OAuth error: ${response.status}`);
      const data = await response.json() as any;
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (error) {
      console.error("Google login error:", error);
      setIsRedirecting(false);
    }
  };

  if (loading || isRedirecting || user) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a1628,#0d2f5e)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white" />
      </div>
    );
  }

  const features = [
    { icon: "🧠", title: "AI Health Monitoring", desc: "Real-time biometric tracking with intelligent baseline analysis and early-warning alerts before things get serious.", color: "#004aad", bg: "#eff6ff" },
    { icon: "🏥", title: "On-Demand Nursing", desc: "Connect with SANC-verified nurses in your area within minutes for professional home visits and care.", color: "#059669", bg: "#ecfdf5" },
    { icon: "🔒", title: "POPIA Compliant", desc: "Your medical data is encrypted end-to-end and stored securely in full compliance with South African law.", color: "#7c3aed", bg: "#f5f3ff" },
    { icon: "⚕️", title: "Doctor Oversight", desc: "Every AI diagnostic report is reviewed and validated by a licensed HPCSA-registered doctor before release.", color: "#b45309", bg: "#fffbeb" },
  ];

  const stats = [
    { value: "2 500+", label: "Patients Served" },
    { value: "350+", label: "Verified Nurses" },
    { value: "80+", label: "Licensed Doctors" },
    { value: "< 8 min", label: "Avg Response Time" },
  ];

  const steps = [
    { num: "01", icon: "📝", title: "Create Your Profile", desc: "Sign up in under 2 minutes. Tell us your role — patient, nurse, or doctor — and we tailor your experience." },
    { num: "02", icon: "📡", title: "Connect & Monitor", desc: "Link your wearable or manually log vitals. Our AI builds your personal health baseline immediately." },
    { num: "03", icon: "✅", title: "Get Care Instantly", desc: "Request a nurse visit or symptom analysis. A verified professional responds in minutes, reviewed by a doctor." },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>

      {/* ── NAV ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(10,22,40,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
              alt="Ahava"
              style={{ height: 32 }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
            <span style={{ color: "white", fontWeight: 700, fontSize: 16 }}>Ahava Healthcare</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => navigate("/login")}
              style={{ background: "transparent", border: "1.5px solid rgba(255,255,255,0.3)", color: "white", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.7)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)")}
            >
              Sign In
            </button>
            <button
              onClick={() => navigate("/signup")}
              style={{ background: "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "white", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(16,185,129,0.4)" }}
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ position: "relative", background: "linear-gradient(135deg,#0a1628 0%,#0d2f5e 50%,#0a3d3a 100%)", overflow: "hidden", minHeight: "92vh", display: "flex", alignItems: "center" }}>
        {/* Decorative blobs */}
        <div style={{ position: "absolute", top: -120, right: -120, width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.18),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -100, left: -80, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(0,74,173,0.25),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "30%", left: "55%", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle,rgba(245,158,11,0.1),transparent 70%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center", width: "100%" }}>
          {/* Left: copy */}
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 30, padding: "6px 16px", marginBottom: 28 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
              <span style={{ color: "#6ee7b7", fontSize: 13, fontWeight: 600 }}>Now serving South Africa · HPCSA Registered</span>
            </div>

            <h1 style={{ fontSize: "clamp(36px,4vw,58px)", fontWeight: 900, color: "white", lineHeight: 1.1, marginBottom: 20 }}>
              Healthcare that{" "}
              <span style={{ background: "linear-gradient(90deg,#10b981,#34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                comes to you
              </span>
              <br />
              <span style={{ color: "rgba(255,255,255,0.85)" }}>powered by AI</span>
            </h1>

            <p style={{ fontSize: 18, color: "rgba(255,255,255,0.65)", lineHeight: 1.7, marginBottom: 40, maxWidth: 480 }}>
              Instant symptom triage, real-time biometric monitoring, and on-demand nurse home visits — all in one platform built for South Africans.
            </p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {isNative ? (
                <>
                  <button
                    onClick={() => navigate("/signup")}
                    style={{ background: "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "white", borderRadius: 10, padding: "14px 32px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(16,185,129,0.4)" }}
                  >
                    Create Free Account
                  </button>
                  <button
                    onClick={() => navigate("/login")}
                    style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 10, padding: "14px 32px", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Sign In
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleGoogleLogin}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: "white", border: "none", color: "#0f172a", borderRadius: 10, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </button>
                  <button
                    onClick={() => navigate("/signup")}
                    style={{ background: "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "white", borderRadius: 10, padding: "14px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(16,185,129,0.35)" }}
                  >
                    Create Free Account →
                  </button>
                </>
              )}
            </div>

            <div style={{ marginTop: 32, display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[["🔒", "POPIA Compliant"], ["✅", "SANC Verified Nurses"], ["⚡", "8-min avg response"]].map(([icon, label]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
                  <span>{icon}</span><span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: floating cards */}
          <div style={{ position: "relative", height: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* Central logo card */}
            <div style={{ position: "absolute", background: "rgba(255,255,255,0.06)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: "28px 36px", textAlign: "center", zIndex: 2 }}>
              <img
                src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
                alt="Ahava"
                style={{ height: 100, marginBottom: 12 }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Ahava on 88</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, marginTop: 2 }}>Revolutionizing Healthcare SA</div>
            </div>
            {/* Floating metric: HR */}
            <div style={{ position: "absolute", top: 30, right: 20, background: "rgba(255,255,255,0.07)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "14px 18px", zIndex: 3 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>❤️ Heart Rate</div>
              <div style={{ color: "#f87171", fontSize: 26, fontWeight: 900 }}>72 <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>bpm</span></div>
              <div style={{ color: "#4ade80", fontSize: 11, marginTop: 2 }}>● Normal range</div>
            </div>
            {/* Floating metric: SpO2 */}
            <div style={{ position: "absolute", bottom: 50, right: 10, background: "rgba(255,255,255,0.07)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "14px 18px", zIndex: 3 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>💧 SpO₂</div>
              <div style={{ color: "#60a5fa", fontSize: 26, fontWeight: 900 }}>98<span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>%</span></div>
              <div style={{ color: "#4ade80", fontSize: 11, marginTop: 2 }}>● Optimal</div>
            </div>
            {/* Floating metric: Nurse */}
            <div style={{ position: "absolute", top: 60, left: 10, background: "rgba(255,255,255,0.07)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "14px 18px", zIndex: 3 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>🏥 Nurse En Route</div>
              <div style={{ color: "#34d399", fontSize: 22, fontWeight: 900 }}>7 min</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 }}>Sister Nomsa · ⭐ 4.9</div>
            </div>
            {/* Floating alert */}
            <div style={{ position: "absolute", bottom: 30, left: 20, background: "rgba(16,185,129,0.15)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 14, padding: "10px 16px", zIndex: 3 }}>
              <div style={{ color: "#34d399", fontSize: 12, fontWeight: 700 }}>✅ AI Analysis Complete</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>Reviewed by Dr. Khumalo</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <section style={{ background: "linear-gradient(135deg,#004aad,#0066cc)", padding: "32px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24, textAlign: "center" }}>
          {stats.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: 32, fontWeight: 900, color: "white" }}>{value}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 4, fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ background: "white", padding: "96px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ display: "inline-block", background: "#eff6ff", color: "#004aad", borderRadius: 30, padding: "6px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 16 }}>Platform Features</div>
            <h2 style={{ fontSize: "clamp(28px,3vw,42px)", fontWeight: 900, color: "#0f172a", marginBottom: 14 }}>Everything your health needs</h2>
            <p style={{ fontSize: 17, color: "#64748b", maxWidth: 520, margin: "0 auto" }}>One platform built for patients, nurses, and doctors — seamlessly connected.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 28 }}>
            {features.map(({ icon, title, desc, color, bg }) => (
              <div
                key={title}
                style={{ background: "white", border: "1.5px solid #f1f5f9", borderRadius: 20, padding: "32px 28px", transition: "all 0.2s", cursor: "default", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.borderColor = color; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = "#f1f5f9"; }}
              >
                <div style={{ width: 56, height: 56, borderRadius: 14, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 20 }}>
                  {icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>{title}</h3>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ background: "#f8fafc", padding: "96px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ display: "inline-block", background: "#ecfdf5", color: "#059669", borderRadius: 30, padding: "6px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 16 }}>How It Works</div>
            <h2 style={{ fontSize: "clamp(28px,3vw,42px)", fontWeight: 900, color: "#0f172a", marginBottom: 14 }}>Up and running in minutes</h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 32 }}>
            {steps.map(({ num, icon, title, desc }) => (
              <div key={num} style={{ position: "relative" }}>
                <div style={{ background: "white", border: "1.5px solid #e2e8f0", borderRadius: 20, padding: "36px 28px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                  <div style={{ position: "absolute", top: -16, left: 28, background: "linear-gradient(135deg,#004aad,#0066cc)", color: "white", borderRadius: 10, padding: "4px 14px", fontSize: 12, fontWeight: 800, letterSpacing: "0.05em" }}>STEP {num}</div>
                  <div style={{ fontSize: 36, marginBottom: 18 }}>{icon}</div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>{title}</h3>
                  <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.65 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section style={{ background: "linear-gradient(135deg,#0a1628,#0d2f5e,#0a3d3a)", padding: "80px 24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.15),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: "clamp(28px,3.5vw,46px)", fontWeight: 900, color: "white", marginBottom: 16 }}>Your health journey starts today</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.6)", marginBottom: 40, lineHeight: 1.7 }}>
            Join thousands of South Africans who've taken control of their health with Ahava.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/signup")}
              style={{ background: "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "white", borderRadius: 10, padding: "15px 36px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(16,185,129,0.4)" }}
            >
              Get Started Free →
            </button>
            <button
              onClick={() => navigate("/login")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 10, padding: "15px 36px", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: "#0a1628", padding: "40px 24px 32px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
              alt="Ahava"
              style={{ height: 28 }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
            <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, fontSize: 14 }}>Ahava Healthcare</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
            © {new Date().getFullYear()} Ahava Healthcare · POPIA Compliant · HPCSA Registered
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {[["🔒", "Privacy"], ["📋", "Terms"], ["📞", "Contact"]].map(([icon, label]) => (
              <span key={label} style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, cursor: "pointer" }}>{icon} {label}</span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
