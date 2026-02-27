"use client";

import React, { useState } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import { patientApi } from "../../../lib/api";
import { useToast } from "../../../contexts/ToastContext";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../components/ui/Card";

export default function AiDoctorPage() {
  const toast = useToast();
  const [symptoms, setSymptoms] = useState("");
  const [triageResult, setTriageResult] = useState<{
    triageLevel: number;
    recommendedAction: string;
    possibleConditions?: string[];
    reasoning: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        setSelectedImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTriage = async () => {
    try {
      setLoading(true);
      const result = await patientApi.submitTriage({
        symptoms,
        imageBase64: selectedImage || undefined,
      });
      setTriageResult(result.data);
    } catch (error: unknown) {
      const e = error as { response?: { data?: { error?: string } } };
      console.error("Triage failed", error);
      toast.error(e.response?.data?.error || "Failed to analyze symptoms. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <div className="p-6 sm:p-8 bg-[var(--background)]">
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">
                AI Doctor Assistant
              </h1>
              <Link
                href="/patient/dashboard"
                className="text-sm font-medium hover:underline"
                style={{ color: "var(--primary)" }}
              >
                ← Back to dashboard
              </Link>
            </div>

            <p className="text-sm text-[var(--muted)] mb-6">
              Describe your symptoms and optionally attach a photo. This is a decision-support tool only — not a medical diagnosis. Always follow clinical advice.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Symptom check</CardTitle>
              </CardHeader>
              {!triageResult ? (
                <div className="space-y-4">
                  <textarea
                    id="triage-symptoms"
                    name="symptoms"
                    className="w-full p-4 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    rows={4}
                    placeholder="Describe your symptoms..."
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                  />

                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                    <input
                      id="triage-image"
                      name="triageImage"
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      aria-label="Upload a photo for triage"
                    />
                    <div className="space-y-2">
                      <span className="text-3xl" aria-hidden>📸</span>
                      <p className="text-sm font-medium text-slate-600">
                        {selectedImage ? "Image attached" : "Upload a photo (optional)"}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleTriage}
                    disabled={loading || !symptoms}
                    className="btn-primary w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                  >
                    {loading ? "Analyzing…" : "Analyze symptoms"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    className={`p-4 rounded-lg border-l-4 ${
                      triageResult.triageLevel < 3 ? "bg-red-50 border-red-500" : "bg-emerald-50 border-emerald-500"
                    }`}
                  >
                    <h3 className="font-bold text-slate-900 mb-2">Analysis complete</h3>
                    <p className="mb-2 text-slate-800">
                      <strong>Recommended action:</strong> {triageResult.recommendedAction}
                    </p>
                    <p className="text-sm text-slate-700">
                      <strong>Possible conditions:</strong> {triageResult.possibleConditions?.join(", ")}
                    </p>
                  </div>
                  <p className="text-xs text-center text-slate-600">{triageResult.reasoning}</p>
                  <button
                    onClick={() => {
                      setTriageResult(null);
                      setSymptoms("");
                      setSelectedImage(null);
                    }}
                    className="text-sm font-medium w-full text-center hover:underline"
                    style={{ color: "var(--primary)" }}
                  >
                    Start over
                  </button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
