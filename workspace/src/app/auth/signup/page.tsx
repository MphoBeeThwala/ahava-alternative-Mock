"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../contexts/AuthContext";

export default function SignupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "PATIENT" as "PATIENT" | "NURSE" | "DOCTOR" | "ADMIN",
    adminSecret: "",
  });

  const isStaffOrAdmin = formData.role !== "PATIENT";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Build payload — omit adminSecret when empty so Joi doesn't reject it
      const payload = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        ...(formData.adminSecret ? { adminSecret: formData.adminSecret } : {}),
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
          "Cannot reach the API. If local: run the backend (e.g. pnpm dev in apps/backend). If deployed: set BACKEND_URL on the frontend service and redeploy.",
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
              Create your account
            </h1>
            <p style={{ fontSize: 14, color: "#57534e" }}>
              Free forever · No credit card required
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
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                style={inp}
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

            {/* Role */}
            <div>
              <label
                htmlFor="signup-role"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                I am a
              </label>
              <select
                id="signup-role"
                value={formData.role}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    role: e.target.value as typeof formData.role,
                  })
                }
                style={{ ...inp, background: "white" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0d9488")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#e7e5e4")}
              >
                <option value="PATIENT">Patient</option>
                <option value="DOCTOR">Doctor</option>
                <option value="NURSE">Nurse</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>

            {isStaffOrAdmin && (
              <div>
                <label
                  htmlFor="signup-secret"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#0d9488",
                    marginBottom: 6,
                  }}
                >
                  {formData.role === "ADMIN"
                    ? "Admin Registration Secret"
                    : "Staff Registration Secret"}
                </label>
                <input
                  id="signup-secret"
                  type="password"
                  required
                  placeholder="Enter the secret key provided by your administrator"
                  value={formData.adminSecret}
                  onChange={(e) =>
                    setFormData({ ...formData, adminSecret: e.target.value })
                  }
                  style={{
                    ...inp,
                    border: "1.5px solid #0d9488",
                    background: "#f0fdfa",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#059669")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#0d9488")
                  }
                />
                <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  Required for {formData.role.toLowerCase()} registration.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
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
              {loading ? "Creating account…" : "Create Free Account →"}
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
