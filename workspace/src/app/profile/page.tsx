"use client";

import { useState, useEffect } from "react";
import RoleGuard, { UserRole } from "../../components/RoleGuard";
import DashboardLayout from "../../components/DashboardLayout";
import { authApi, patientApi, RiskProfile } from "../../lib/api";
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
  const [riskProfile, setRiskProfile] = useState<RiskProfile>({
    smoker: undefined,
    hypertension: undefined,
    diabetes: undefined,
    asthmaOrCopd: undefined,
    pregnancy: undefined,
    familyHistoryCvd: undefined,
    activityLevel: undefined,
    alcoholUse: undefined,
    cholesterolKnown: undefined,
    cholesterolValue: undefined,
    consentAcknowledged: false,
    onboardingCompleted: false,
    surveyVersion: 1,
  });
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskSuccess, setRiskSuccess] = useState("");
  const [riskError, setRiskError] = useState("");
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

      const coerceBoolean = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
      const coerceNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const coerceEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
        typeof v === "string" && allowed.includes(v as T) ? (v as T) : undefined;

      const rp = user.riskProfile;
      if (rp && typeof rp === "object") {
        const rpo = rp as Record<string, unknown>;
        setRiskProfile((prev) => ({
          ...prev,
          smoker: coerceBoolean(rpo["smoker"]) ?? prev.smoker,
          hypertension: coerceBoolean(rpo["hypertension"]) ?? prev.hypertension,
          diabetes: coerceBoolean(rpo["diabetes"]) ?? prev.diabetes,
          asthmaOrCopd: coerceBoolean(rpo["asthmaOrCopd"]) ?? prev.asthmaOrCopd,
          pregnancy: coerceBoolean(rpo["pregnancy"]) ?? prev.pregnancy,
          familyHistoryCvd: coerceBoolean(rpo["familyHistoryCvd"]) ?? prev.familyHistoryCvd,
          activityLevel: coerceEnum(rpo["activityLevel"], ["LOW", "MODERATE", "HIGH"] as const) ?? prev.activityLevel,
          alcoholUse: coerceEnum(rpo["alcoholUse"], ["NONE", "LOW", "MODERATE", "HIGH"] as const) ?? prev.alcoholUse,
          cholesterolKnown: coerceBoolean(rpo["cholesterolKnown"]) ?? prev.cholesterolKnown,
          cholesterolValue: coerceNumber(rpo["cholesterolValue"]) ?? prev.cholesterolValue,
          consentAcknowledged: coerceBoolean(rpo["consentAcknowledged"]) ?? prev.consentAcknowledged,
          onboardingCompleted: coerceBoolean(rpo["onboardingCompleted"]) ?? prev.onboardingCompleted,
          surveyVersion: coerceNumber(rpo["surveyVersion"]) ?? prev.surveyVersion,
        }));
      }
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

  const setRisk = (patch: Partial<RiskProfile>) => {
    setRiskProfile((rp) => ({ ...rp, ...patch }));
    setRiskSuccess("");
    setRiskError("");
  };

  const handleRiskSubmit = async () => {
    setRiskSaving(true);
    setRiskError("");
    setRiskSuccess("");
    try {
      if (!riskProfile.consentAcknowledged) {
        setRiskError("Please confirm the consent statement to continue.");
        return;
      }
      const payload: RiskProfile = {
        ...riskProfile,
        onboardingCompleted: true,
        surveyVersion: riskProfile.surveyVersion ?? 1,
      };
      const res = await patientApi.updateRiskProfile(payload);
      setRiskSuccess("Health profile saved. You can now view Early Warning risk signals and choose whether to consult a clinician.");
      if (refreshUser) await refreshUser();
      if (res?.riskProfile && typeof window !== "undefined") {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            localStorage.setItem("user", JSON.stringify({ ...parsed, riskProfile: res.riskProfile }));
          } catch {}
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setRiskError(msg ?? "Failed to save health profile. Please try again.");
    } finally {
      setRiskSaving(false);
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

              {user?.role === "PATIENT" && (
                <div style={{ background: "white", borderRadius: 16, padding: "28px 28px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", marginBottom: 20 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 0, marginBottom: 8 }}>Health & Lifestyle</h2>
                  <p style={{ fontSize: 13, color: "#64748b", marginBottom: 18 }}>
                    This helps personalise risk signals and trend monitoring. It is not a diagnosis. You control whether to consult a clinician.
                  </p>

                  {!riskProfile.onboardingCompleted && (
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: "#1e3a8a", fontSize: 13, fontWeight: 600 }}>
                      Complete this section once to enable personalised Early Warning risk signals.
                    </div>
                  )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div>
                        <label style={label}>Do you smoke?</label>
                        <select value={riskProfile.smoker === undefined ? "" : riskProfile.smoker ? "yes" : "no"} onChange={(e) => setRisk({ smoker: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                          <option value="">Prefer not to say</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Known high blood pressure?</label>
                        <select value={riskProfile.hypertension === undefined ? "" : riskProfile.hypertension ? "yes" : "no"} onChange={(e) => setRisk({ hypertension: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                          <option value="">Prefer not to say</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Diabetes?</label>
                        <select value={riskProfile.diabetes === undefined ? "" : riskProfile.diabetes ? "yes" : "no"} onChange={(e) => setRisk({ diabetes: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                          <option value="">Prefer not to say</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Asthma or chronic lung disease?</label>
                        <select value={riskProfile.asthmaOrCopd === undefined ? "" : riskProfile.asthmaOrCopd ? "yes" : "no"} onChange={(e) => setRisk({ asthmaOrCopd: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                          <option value="">Prefer not to say</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      {form.gender === "FEMALE" && (
                        <div>
                          <label style={label}>Pregnant (optional)?</label>
                          <select value={riskProfile.pregnancy === undefined ? "" : riskProfile.pregnancy ? "yes" : "no"} onChange={(e) => setRisk({ pregnancy: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                            <option value="">Prefer not to say</option>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label style={label}>Family history of heart disease or stroke?</label>
                        <select value={riskProfile.familyHistoryCvd === undefined ? "" : riskProfile.familyHistoryCvd ? "yes" : "no"} onChange={(e) => setRisk({ familyHistoryCvd: e.target.value === "" ? undefined : e.target.value === "yes" })} style={inp}>
                          <option value="">Prefer not to say</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Activity level</label>
                        <select value={riskProfile.activityLevel ?? ""} onChange={(e) => setRisk({ activityLevel: (e.target.value || undefined) as RiskProfile["activityLevel"] })} style={inp}>
                          <option value="">Select</option>
                          <option value="LOW">Low</option>
                          <option value="MODERATE">Moderate</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Alcohol use</label>
                        <select value={riskProfile.alcoholUse ?? ""} onChange={(e) => setRisk({ alcoholUse: (e.target.value || undefined) as RiskProfile["alcoholUse"] })} style={inp}>
                          <option value="">Select</option>
                          <option value="NONE">None</option>
                          <option value="LOW">Low</option>
                          <option value="MODERATE">Moderate</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                      <div>
                        <label style={label}>Do you know your cholesterol?</label>
                        <select value={riskProfile.cholesterolKnown === undefined ? "" : riskProfile.cholesterolKnown ? "yes" : "no"} onChange={(e) => setRisk({ cholesterolKnown: e.target.value === "" ? undefined : e.target.value === "yes", cholesterolValue: e.target.value === "yes" ? riskProfile.cholesterolValue : undefined })} style={inp}>
                          <option value="">Select</option>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      {riskProfile.cholesterolKnown && (
                        <div>
                          <label style={label}>Cholesterol (mmol/L)</label>
                          <input
                            type="number"
                            min={2}
                            max={15}
                            step="0.1"
                            value={riskProfile.cholesterolValue ?? ""}
                            onChange={(e) => setRisk({ cholesterolValue: e.target.value ? Number(e.target.value) : undefined })}
                            style={inp}
                          />
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(riskProfile.consentAcknowledged)}
                          onChange={(e) => setRisk({ consentAcknowledged: e.target.checked })}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          I understand this feature provides health risk signals, not a diagnosis, and I can choose to consult a clinician for clarification.
                        </span>
                      </label>
                    </div>

                    {riskError && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginTop: 14, color: "#dc2626", fontSize: 14 }}>{riskError}</div>
                    )}
                    {riskSuccess && (
                      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 16px", marginTop: 14, color: "#166534", fontSize: 14 }}>{riskSuccess}</div>
                    )}

                    <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                      <button
                        type="button"
                        onClick={() => handleRiskSubmit()}
                        disabled={riskSaving}
                        style={{ flex: 2, padding: "14px", background: riskSaving ? "#94a3b8" : "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: riskSaving ? "not-allowed" : "pointer" }}
                      >
                        {riskSaving ? "Saving…" : "Save Health Profile"}
                      </button>
                      
                      {!riskProfile.onboardingCompleted && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Skip onboarding? You can complete this later in your profile to enable AI risk signals.")) {
                              setRiskProfile(prev => ({ ...prev, onboardingCompleted: true }));
                              handleRiskSubmit();
                            }
                          }}
                          style={{ flex: 1, padding: "14px", background: "white", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                        >
                          Skip for now
                        </button>
                      )}
                    </div>
                </div>
              )}

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
