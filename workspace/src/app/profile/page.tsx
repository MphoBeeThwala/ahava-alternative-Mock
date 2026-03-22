"use client";

import { useState, useEffect } from "react";
import RoleGuard, { UserRole } from "../../components/RoleGuard";
import DashboardLayout from "../../components/DashboardLayout";
import { authApi } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zu", label: "isiZulu" },
  { value: "xh", label: "isiXhosa" },
  { value: "af", label: "Afrikaans" },
  { value: "st", label: "Sesotho" },
  { value: "tn", label: "Setswana" },
];

const GENDERS = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
  { value: "PREFER_NOT_TO_SAY", label: "Prefer not to say" },
];

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    dateOfBirth: "",
    gender: "",
    preferredLanguage: "",
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        phone: user.phone ?? "",
        email: user.email ?? "",
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.split("T")[0] : "",
        gender: user.gender ?? "",
        preferredLanguage: user.preferredLanguage ?? "",
      });
    }
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setSuccess("");
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        preferredLanguage: form.preferredLanguage || null,
      };
      if (form.email && form.email !== user?.email) {
        payload.email = form.email;
      }
      const res = await authApi.updateProfile(payload as Parameters<typeof authApi.updateProfile>[0]);
      if (res.emailChanged) {
        setSuccess("Profile saved. A verification email has been sent to your new address — please check your inbox.");
      } else {
        setSuccess("Profile updated successfully.");
      }
      if (refreshUser) await refreshUser();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none",
    boxSizing: "border-box", background: "white",
  };
  const label: React.CSSProperties = {
    display: "block", fontSize: 13, fontWeight: 600,
    color: "#374151", marginBottom: 6,
  };

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN]}>
      <DashboardLayout>
        <div style={{ background: "var(--background)", minHeight: "100vh" }}>
          {/* Header */}
          <div style={{ background: "linear-gradient(135deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)", padding: "32px 40px 28px" }}>
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <p style={{ color: "rgba(94,234,212,0.8)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Account</p>
              <h1 style={{ color: "white", fontSize: 28, fontWeight: 900, margin: 0 }}>My Profile</h1>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 4 }}>Update your personal details and contact information.</p>
            </div>
          </div>

          <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
            {!user?.isVerified && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 18px", marginBottom: 24, display: "flex", gap: 10, alignItems: "center" }}>
                <span>📧</span>
                <span style={{ fontSize: 14, color: "#92400e", fontWeight: 600 }}>Your email address is not yet verified. Check your inbox or resend below.</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ background: "white", borderRadius: 16, padding: "28px 28px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", marginBottom: 20 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 0, marginBottom: 20 }}>Personal Information</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={label}>First name</label>
                    <input name="firstName" value={form.firstName} onChange={handleChange} required style={inp} />
                  </div>
                  <div>
                    <label style={label}>Last name</label>
                    <input name="lastName" value={form.lastName} onChange={handleChange} required style={inp} />
                  </div>
                  <div>
                    <label style={label}>Date of birth</label>
                    <input name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange} style={inp} />
                  </div>
                  <div>
                    <label style={label}>Gender</label>
                    <select name="gender" value={form.gender} onChange={handleChange} style={inp}>
                      <option value="">Prefer not to say</option>
                      {GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={label}>Phone number</label>
                    <input name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="+27 82 000 0000" style={inp} />
                  </div>
                  <div>
                    <label style={label}>Preferred language</label>
                    <select name="preferredLanguage" value={form.preferredLanguage} onChange={handleChange} style={inp}>
                      <option value="">Select language</option>
                      {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ background: "white", borderRadius: 16, padding: "28px 28px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 0, marginBottom: 8 }}>Email Address</h2>
                <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Changing your email will require re-verification. A link will be sent to the new address.</p>
                <label style={label}>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} required style={inp} />
                {user?.email && form.email !== user.email && (
                  <p style={{ fontSize: 12, color: "#d97706", marginTop: 6, fontWeight: 600 }}>⚠ Saving will send a verification link to this new address.</p>
                )}
              </div>

              {error && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#dc2626", fontSize: 14 }}>{error}</div>
              )}
              {success && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#166534", fontSize: 14 }}>{success}</div>
              )}

              <button
                type="submit"
                disabled={saving}
                style={{ width: "100%", padding: "14px", background: saving ? "#94a3b8" : "linear-gradient(135deg,#0d9488,#059669)", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </form>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
