import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";
import { getApiBase } from "@/react-app/lib/native";

const PW_REQS = ["At least 8 characters", "One uppercase letter", "One lowercase letter", "One number"];

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [name, setName]                   = useState("");
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirm]     = useState("");
  const [error, setError]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [passwordErrors, setPwErrors]     = useState<string[]>([]);
  const [showPw, setShowPw]               = useState(false);

  const validatePassword = (pwd: string) => {
    const errs: string[] = [];
    if (pwd.length < 8)         errs.push("At least 8 characters");
    if (!/[A-Z]/.test(pwd))     errs.push("One uppercase letter");
    if (!/[a-z]/.test(pwd))     errs.push("One lowercase letter");
    if (!/[0-9]/.test(pwd))     errs.push("One number");
    setPwErrors(errs);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (passwordErrors.length > 0)   { setError("Please fix password requirements"); return; }
    setLoading(true);
    try {
      await signup(email, password, name, "PATIENT");
      navigate("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/sign-in/google?json=true`, {
        method: "GET", credentials: "include", headers: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.redirectUrl) window.location.href = data.redirectUrl;
      }
    } catch {
      setError("Failed to initiate Google signup");
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: "1.5px solid #e2e8f0", fontSize: 14, fontFamily: "inherit",
    outline: "none", background: "#f8fafc", color: "#0f172a",
    boxSizing: "border-box", transition: "border-color 0.18s",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── LEFT BRAND PANEL ── */}
      <div style={{ flex: "0 0 40%", background: "linear-gradient(160deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 44px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -100, right: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(16,185,129,0.15),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, left: -60, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(0,74,173,0.2),transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: 300 }}>
          <img
            src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
            alt="Ahava"
            style={{ height: 100, marginBottom: 24 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <h2 style={{ color: "white", fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Join thousands of South Africans</h2>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.7, marginBottom: 36 }}>
            Take control of your health with AI monitoring, verified nurses, and doctor oversight.
          </p>

          {/* Feature pills */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { icon: "🧠", text: "AI-powered symptom analysis" },
              { icon: "🏥", text: "On-demand nurse home visits" },
              { icon: "👨‍⚕️", text: "Doctor-reviewed diagnostics" },
              { icon: "📊", text: "Real-time biometric tracking" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "9px 14px", textAlign: "left" }}>
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 500 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ── */}
      <div style={{ flex: 1, background: "white", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <button
            onClick={() => navigate("/")}
            style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: 32, display: "flex", alignItems: "center", gap: 6, padding: 0 }}
          >
            ← Back to home
          </button>

          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Create your account</h1>
            <p style={{ fontSize: 14, color: "#64748b" }}>Free forever · No credit card required</p>
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ color: "#ef4444", fontSize: 16, flexShrink: 0 }}>⚠</span>
              <span style={{ color: "#dc2626", fontSize: 13 }}>{error}</span>
            </div>
          )}

          {/* Google */}
          <button
            onClick={handleGoogleSignup}
            disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: 22, color: "#0f172a", boxSizing: "border-box" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign up with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>or sign up with email</span>
            <div style={{ flex: 1, height: 1, background: "#f1f5f9" }} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Name */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Full Name</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sipho Ndlovu" style={inp}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")} />
            </div>

            {/* Email */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Email Address</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={inp}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")} />
            </div>

            {/* Password */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Password</label>
              <div style={{ position: "relative" }}>
                <input type={showPw ? "text" : "password"} required value={password}
                  onChange={(e) => { setPassword(e.target.value); validatePassword(e.target.value); }}
                  placeholder="••••••••" style={{ ...inp, paddingRight: 44 }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 0 }}>
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
              {password && (
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                  {PW_REQS.map((req) => {
                    const met = !passwordErrors.includes(req);
                    return (
                      <div key={req} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: met ? "#059669" : "#94a3b8" }}>
                        <span style={{ fontSize: 14 }}>{met ? "✅" : "○"}</span>{req}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Confirm */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Confirm Password</label>
              <input type="password" required value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" style={{
                ...inp,
                borderColor: confirmPassword && confirmPassword !== password ? "#ef4444" : "#e2e8f0",
              }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#004aad")}
                onBlur={(e) => (e.currentTarget.style.borderColor = (confirmPassword && confirmPassword !== password) ? "#ef4444" : "#e2e8f0")} />
              {confirmPassword && confirmPassword !== password && (
                <div style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>Passwords don't match</div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || passwordErrors.length > 0 || (!!confirmPassword && confirmPassword !== password)}
              style={{ width: "100%", background: (loading || passwordErrors.length > 0) ? "#94a3b8" : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "white", borderRadius: 10, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(16,185,129,0.3)", marginTop: 4 }}
            >
              {loading ? "Creating account…" : "Create Free Account →"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "#64748b" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color: "#004aad", fontWeight: 700, textDecoration: "none" }}>Sign in</Link>
          </p>
          <p style={{ textAlign: "center", marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
            By signing up you agree to our{" "}
            <Link to="/terms" style={{ color: "#94a3b8" }}>Terms</Link> &{" "}
            <Link to="/privacy" style={{ color: "#94a3b8" }}>Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
