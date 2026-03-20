import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";
import { getApiBase } from "@/react-app/lib/native";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/api/auth/sign-in/google?json=true`, {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (response.ok) {
        const data = await response.json() as any;
        if (data.redirectUrl) window.location.href = data.redirectUrl;
      }
    } catch {
      setError("Failed to initiate Google login");
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: "1.5px solid #e2e8f0", fontSize: 14, fontFamily: "inherit",
    outline: "none", background: "#f8fafc", color: "#0f172a", boxSizing: "border-box",
    transition: "border-color 0.18s",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── LEFT BRAND PANEL ── */}
      <div style={{ flex: "0 0 42%", background: "linear-gradient(160deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 48px", position: "relative", overflow: "hidden" }}>
        {/* blobs */}
        <div style={{ position: "absolute", top: -100, right: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.15),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, left: -60, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(0,74,173,0.2),transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: 320 }}>
          <img
            src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
            alt="Ahava"
            style={{ height: 110, marginBottom: 28 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <h2 style={{ color: "white", fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Healthcare that comes to you</h2>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 1.7, marginBottom: 40 }}>
            AI-powered health monitoring, on-demand nurse visits, and doctor oversight — all in one platform.
          </p>

          {/* Trust badges */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { icon: "🔒", label: "POPIA Compliant", sub: "Your data is encrypted & protected" },
              { icon: "✅", label: "SANC Verified Nurses", sub: "Only registered professionals" },
              { icon: "⚕️", label: "HPCSA Registered Doctors", sub: "Licensed medical oversight" },
            ].map(({ icon, label, sub }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px", textAlign: "left" }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 700 }}>{label}</div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ── */}
      <div style={{ flex: 1, background: "white", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          {/* Back to home */}
          <button
            onClick={() => navigate("/")}
            style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: 36, display: "flex", alignItems: "center", gap: 6, padding: 0 }}
          >
            ← Back to home
          </button>

          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Welcome back</h1>
            <p style={{ fontSize: 14, color: "#64748b" }}>Sign in to your Ahava account</p>
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ color: "#ef4444", fontSize: 16, flexShrink: 0 }}>⚠</span>
              <span style={{ color: "#dc2626", fontSize: 13 }}>{error}</span>
            </div>
          )}

          {/* Google button */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: 24, color: "#0f172a", transition: "all 0.18s", boxSizing: "border-box" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#cbd5e1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>or sign in with email</span>
            <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inp}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
              />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Password</label>
                <Link to="/forgot-password" style={{ fontSize: 12, color: "#004aad", fontWeight: 600, textDecoration: "none" }}>Forgot password?</Link>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ ...inp, paddingRight: 44 }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 0 }}
                >
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", background: loading ? "#94a3b8" : "linear-gradient(135deg,#004aad,#0066cc)", border: "none", color: "white", borderRadius: 10, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: loading ? "none" : "0 4px 14px rgba(0,74,173,0.35)", transition: "all 0.2s", marginTop: 4 }}
            >
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 28, fontSize: 13, color: "#64748b" }}>
            Don't have an account?{" "}
            <Link to="/signup" style={{ color: "#004aad", fontWeight: 700, textDecoration: "none" }}>
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
