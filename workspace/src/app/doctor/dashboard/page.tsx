"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import axios from 'axios';

// Mock data for MVP (Real app would fetch from /api/visits?status=PENDING_REVIEW)
const MOCK_TRIAGE_ITEMS = [
    {
        id: '1',
        patientName: 'John Doe',
        symptoms: 'High fever (39.5C), severe headache, sensitivity to light.',
        aiAnalysis: {
            triageLevel: 2,
            possibleConditions: ['Meningitis', 'Severe Migraine', 'Viral Infection'],
            recommendedAction: 'Immediate ER evaluation recommended.'
        },
        timestamp: '2026-01-30T10:30:00'
    },
    {
        id: '2',
        patientName: 'Jane Smith',
        symptoms: 'Persistent dry cough for 3 weeks, mild fatigue.',
        aiAnalysis: {
            triageLevel: 4,
            possibleConditions: ['Post-viral cough', 'Allergies'],
            recommendedAction: 'Schedule routine follow-up.'
        },
        timestamp: '2026-01-30T11:15:00'
    }
];

export default function DoctorDashboard() {
    const [triageQueue, setTriageQueue] = useState(MOCK_TRIAGE_ITEMS);

    const handleApprove = (id: string) => {
        alert(`Approved Action for Case ${id}. Notification sent to patient.`);
        setTriageQueue(prev => prev.filter(item => item.id !== id));
    };

    return (
        <RoleGuard allowedRoles={[UserRole.DOCTOR]}>
            <div className="p-8 bg-gray-50 min-h-screen">
                <header className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">Doctor Portal</h1>
                    <span className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-medium">
                        Active Queue: {triageQueue.length}
                    </span>
                </header>

                <div className="grid gap-6">
                    {triageQueue.map((item) => (
                        <div key={item.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900">{item.patientName}</h3>
                                    <p className="text-sm text-gray-500">{new Date(item.timestamp).toLocaleString()}</p>
                                </div>
                                <div className={`px-4 py-2 rounded-lg font-bold ${item.aiAnalysis.triageLevel <= 2 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}>
                                    Triage Level {item.aiAnalysis.triageLevel}
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6 mb-6">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="font-semibold text-gray-700 mb-2">Patient Reported Symptoms</h4>
                                    <p className="text-gray-600 italic">"{item.symptoms}"</p>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                    <h4 className="font-semibold text-blue-800 mb-2">🤖 AI Analysis</h4>
                                    <ul className="list-disc list-inside text-sm text-blue-700 mb-2">
                                        {item.aiAnalysis.possibleConditions.map(c => <li key={c}>{c}</li>)}
                                    </ul>
                                    <p className="text-sm font-medium text-blue-900">Rec: {item.aiAnalysis.recommendedAction}</p>
                                </div>
                            </div>

                            <div className="flex gap-4 border-t pt-4">
                                <button
                                    onClick={() => handleApprove(item.id)}
                                    className="px-6 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition"
                                >
                                    Approve AI Recommendation
                                </button>
                                <button className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition">
                                    Modify / Prescribe
                                </button>
                                <button className="px-6 py-2 bg-white border border-red-200 text-red-600 font-medium rounded-lg hover:bg-red-50 transition ml-auto">
                                    Escalate to ER
                                </button>
                            </div>
                        </div>
                    ))}

                    {triageQueue.length === 0 && (
                        <div className="text-center py-12 bg-white rounded-xl text-gray-400">
                            <p className="text-xl">All caught up! No pending reviews.</p>
                        </div>
                    )}
                </div>
            </div>
        </RoleGuard>
    );
}
