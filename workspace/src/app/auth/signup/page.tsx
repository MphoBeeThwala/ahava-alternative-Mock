"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../contexts/AuthContext";
import { authApi, type StaffInviteDetails } from "../../../lib/api/auth";

const ROLE_LABEL: Record<StaffInviteDetails["role"], string> = {
  NURSE: "Nurse",
  DOCTOR: "Doctor",
  ADMIN: "Administrator",
};

export default function SignupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "PATIENT" as "PATIENT" | "NURSE" | "DOCTOR" | "ADMIN",
    registrationNumber: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Staff (nurses, doctors, admins) join only through a single-use invite
  // link an administrator sends them: /auth/signup?invite=<token>.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<StaffInviteDetails | null>(null);
  const [inviteChecking, setInviteChecking] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    setInviteToken(token);
    setInviteChecking(true);
    // Keep the single-use token out of the address bar and browser history.
    window.history.replaceState(null, "", window.location.pathname);
    authApi
      .getInvite(token)
      .then((details) => {
        setInvite(details);
        setFormData((f) => ({
          ...f,
          email: details.email,
          role: details.role,
          firstName: details.firstName || f.firstName,
          lastName: details.lastName || f.lastName,
        }));
      })
      .catch((err: { response?: { data?: { error?: string } } }) => {
        setError(
          err.response?.data?.error ||
            "This invite link couldn't be checked. Ask your administrator for a new one.",
        );
      })
      .finally(() => setInviteChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const registrationNumber = formData.registrationNumber.trim();
      const payload = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        role: invite ? invite.role : ("PATIENT" as const),
        ...(invite && inviteToken ? { inviteToken } : {}),
        ...(invite?.role === "NURSE" && registrationNumber
          ? { sancRegistrationNumber: registrationNumber }
          : {}),
        ...(invite?.role === "DOCTOR" && registrationNumber
          ? { hpcsaNumber: registrationNumber }
          : {}),
      };
      await register(payload);

      // Get user from localStorage after registration
      const user = JSON.parse(localStorage.getItem("user") || "{}");

      // Redirect based on role
      switch (user.role) {
        case "PATIENT":
          router.push("/patient/dashboard");
          break;
        case "DOCTOR":
          router.push("/doctor/dashboard");
          break;
        case "NURSE":
          router.push("/nurse/dashboard");
          break;
        case "ADMIN":
          router.push("/admin/dashboard");
          break;
        default:
          router.push("/");
      }
    } catch (err: unknown) {
      const e = err as {
        message?: string;
        code?: string;
        response?: { status?: number; data?: { error?: string } };
      };
      const status = e.response?.status;
      const is502 = status === 502 || status === 503 || status === 504;
      const isNetworkError =
        e.message === "Network Error" ||
        e.code === "ERR_NETWORK" ||
        !e.response;
      if (is502) {
        setError(
          "Service temporarily unavailable. The backend may be starting or restarting—please try again in a moment.",
        );
      } else if (isNetworkError) {
        setError(
          "Cannot reach the API. If local: run the backend (e.g. pnpm dev in apps/backend). If deployed: set BACKEND_URL on the frontend service.",
        );
      } else {
        setError(
          (e.response?.data as { error?: string })?.error ||
            e.message ||
            "Registration failed",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1.5px solid #e7e5e4",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    background: "#fafaf9",
    color: "#1c1917",
    boxSizing: "border-box",
    transition: "border-color 0.18s",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "inherit" }}>
      {/* ── LEFT BRAND PANEL ── */}
      <div
        style={{
          flex: "0 0 40%",
          background:
            "linear-gradient(160deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 44px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -100,
            right: -80,
            width: 300,
            height: 300,
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(13,148,136,0.15),transparent 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: -60,
            width: 260,
            height: 260,
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(0,74,173,0.2),transparent 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "linear-gradient(135deg,#0d9488,#059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              margin: "0 auto 24px",
            }}
          >
            ⚕️
          </div>
          <h2
            style={{
              color: "white",
              fontSize: 22,
              fontWeight: 800,
              marginBottom: 10,
            }}
          >
            Join thousands of South Africans
          </h2>
          <p
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 14,
              lineHeight: 1.7,
              marginBottom: 36,
            }}
          >
            Take control of your health with AI monitoring, verified nurses, and
            doctor oversight.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { icon: "🧠", text: "AI-powered symptom analysis" },
              { icon: "🏥", text: "On-demand nurse home visits" },
              { icon: "👨‍⚕️", text: "Doctor-reviewed diagnostics" },
              { icon: "📊", text: "Real-time biometric tracking" },
            ].map(({ icon, text }) => (
              <div
                key={text}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: "9px 14px",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span
                  style={{
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ── */}
      <div
        style={{
          flex: 1,
          background: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 40px",
          overflowY: "auto",
        }}
      >
        <div style={{ width: "100%", maxWidth: 420 }}>
          <Link
            href="/"
            style={{
              color: "#a8a29e",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 32,
            }}
          >
            ← Back to home
          </Link>

          <div style={{ marginBottom: 28 }}>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 900,
                color: "#1c1917",
                marginBottom: 6,
              }}
            >
              {invite ? "Create your staff account" : "Create your account"}
            </h1>
            <p style={{ fontSize: 14, color: "#57534e" }}>
              {invite
                ? `You've been invited to join as ${ROLE_LABEL[invite.role].toLowerCase()}. You'll set up two-factor authentication after this step.`
                : inviteChecking
                  ? "Checking your invite…"
                  : "Free forever · No credit card required"}
            </p>
          </div>

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 18,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <span style={{ color: "#ef4444", fontSize: 16, flexShrink: 0 }}>
                ⚠
              </span>
              <span style={{ color: "#dc2626", fontSize: 13 }}>{error}</span>
            </div>
          )}

          <form
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            onSubmit={handleSubmit}
          >
            {/* Name row */}
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="signup-first"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  First name
                </label>
                <input
                  id="signup-first"
                  type="text"
                  required
                  autoComplete="given-name"
                  placeholder="Sipho"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  style={inp}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#0d9488")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#e7e5e4")
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="signup-last"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Last name
                </label>
                <input
                  id="signup-last"
                  type="text"
                  required
                  autoComplete="family-name"
                  placeholder="Ndlovu"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  style={inp}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#0d9488")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#e7e5e4")
                  }
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="signup-email"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                Email address
              </label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={formData.email}
                readOnly={!!invite}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                style={invite ? { ...inp, background: "#f5f5f4", color: "#57534e" } : inp}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0d9488")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e7e5e4")}
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="signup-password"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                style={inp}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0d9488")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e7e5e4")}
              />
            </div>

            {/* Role: staff roles come only from an invite */}
            {invite ? (
              <div>
                <div
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Joining as
                </div>
                <div
                  style={{
                    ...inp,
                    background: "#f0fdfa",
                    border: "1.5px solid #0d9488",
                    color: "#0f766e",
                    fontWeight: 700,
                  }}
                >
                  {ROLE_LABEL[invite.role]}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
                Signing up as a patient. Nurses, doctors and administrators
                join through the invite link an administrator emails them.
              </p>
            )}

            {(invite?.role === "NURSE" || invite?.role === "DOCTOR") && (
              <div>
                <label
                  htmlFor="signup-registration"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  {invite.role === "NURSE"
                    ? "SANC registration number"
                    : "HPCSA registration number"}
                </label>
                <input
                  id="signup-registration"
                  type="text"
                  autoComplete="off"
                  maxLength={40}
                  placeholder={invite.role === "NURSE" ? "e.g. 12345678" : "e.g. MP0123456"}
                  value={formData.registrationNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, registrationNumber: e.target.value })
                  }
                  style={inp}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#0d9488")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#e7e5e4")}
                />
                <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  You can open patient records once an administrator has
                  checked this number on the{" "}
                  {invite.role === "NURSE" ? "SANC" : "HPCSA"} register. You
                  can also add it later from your dashboard.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || inviteChecking || (!!inviteToken && !invite)}
              style={{
                width: "100%",
                background: loading
                  ? "#a8a29e"
                  : "linear-gradient(135deg,#0d9488,#059669)",
                border: "none",
                color: "white",
                borderRadius: 10,
                padding: "13px 20px",
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 14px rgba(13,148,136,0.3)",
                marginTop: 4,
              }}
            >
              {loading
                ? "Creating account…"
                : invite
                  ? "Create my account →"
                  : "Create Free Account →"}
            </button>
          </form>

          <p
            style={{
              textAlign: "center",
              marginTop: 20,
              fontSize: 13,
              color: "#57534e",
            }}
          >
            Already have an account?{" "}
            <Link
              href="/auth/login"
              style={{
                color: "#0d9488",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Sign in
            </Link>
          </p>
          <p
            style={{
              textAlign: "center",
              marginTop: 12,
              fontSize: 11,
              color: "#a8a29e",
            }}
          >
            By signing up you agree to our Terms &amp; Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}
