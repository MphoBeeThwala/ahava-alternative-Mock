"use client";

import React, { useState } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import axios from 'axios';

// Force localhost for dev stability check
const API_URL = 'http://localhost:4000/api';

export default function PatientDashboard() {
    const [symptoms, setSymptoms] = useState('');
    const [triageResult, setTriageResult] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setSelectedImage(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleTriage = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem('token'); // Fixed key
            console.log("PatientDashboard: Retrieving token for Triage:", token);

            if (!token) {
                alert("You are not logged in! Please log out and log back in.");
                setLoading(false);
                return;
            }

            const response = await axios.post('http://localhost:4000/api/triage', {
                symptoms,
                imageBase64: selectedImage
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setTriageResult(response.data.data);
        } catch (error) {
            console.error("Triage failed", error);
            alert("Failed to analyze symptoms. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.PATIENT]}>
            <div className="p-8 bg-gray-50 min-h-screen font-sans">
                <h1 className="text-3xl font-bold text-gray-800 mb-8">Patient Portal</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Health Monitor Card */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h2 className="text-xl font-semibold mb-4 text-emerald-600">❤️ Health Status</h2>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-gray-500">Readiness Score</p>
                                <p className="text-4xl font-bold text-gray-900">92</p>
                            </div>
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">Optimal</span>
                        </div>
                        <p className="text-sm text-gray-400">Baseline calculated from last 14 days.</p>
                    </div>

                    {/* AI Triage Card */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h2 className="text-xl font-semibold mb-4 text-blue-600">🤖 AI Doctor Assistant</h2>

                        {!triageResult ? (
                            <div className="space-y-4">
                                <textarea
                                    className="w-full p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                                    rows={4}
                                    placeholder="Describe your symptoms (e.g. 'I have a headache and high fever...')"
                                    value={symptoms}
                                    onChange={(e) => setSymptoms(e.target.value)}
                                />

                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <div className="space-y-2">
                                        <span className="text-4xl">📸</span>
                                        <p className="text-sm text-gray-500">
                                            {selectedImage ? "Image Attached ✅" : "Upload a photo of your symptoms (Optional)"}
                                        </p>
                                    </div>
                                    {selectedImage && <img src={selectedImage} alt="Preview" className="mx-auto h-20 mt-2 rounded" />}
                                </div>

                                <button
                                    onClick={handleTriage}
                                    disabled={loading || !symptoms}
                                    className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {loading ? 'Analyzing...' : 'Analyze Symptoms'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className={`p-4 rounded-lg border-l-4 ${triageResult.triageLevel < 3 ? 'bg-red-50 border-red-500' : 'bg-green-50 border-green-500'
                                    }`}>
                                    <h3 className="font-bold text-lg mb-2">Analysis Complete</h3>
                                    <p className="mb-2"><strong>Recommended Action:</strong> {triageResult.recommendedAction}</p>
                                    <p className="text-sm text-gray-600"><strong>Possible Conditions:</strong> {triageResult.possibleConditions.join(", ")}</p>
                                </div>
                                <p className="text-xs text-center text-gray-400">{triageResult.reasoning}</p>
                                <button
                                    onClick={() => setTriageResult(null)}
                                    className="text-blue-600 text-sm hover:underline w-full text-center"
                                >
                                    Start Over
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
