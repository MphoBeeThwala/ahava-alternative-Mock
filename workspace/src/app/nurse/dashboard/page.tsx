"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import axios from 'axios';

export default function NurseDashboard() {
    const [isAvailable, setIsAvailable] = useState(false);
    const [locationStatus, setLocationStatus] = useState('Unknown');
    const [loading, setLoading] = useState(false);

    // Sync availability state from backend on load
    useEffect(() => {
        // MVP: Just defaulting to false for now, real app would GET /api/nurse/me
    }, []);

    const toggleAvailability = async () => {
        setLoading(true);

        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser");
            setLoading(false);
            return;
        }

        if (!isAvailable) {
            // Going ONLINE: Need Location
            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    const token = localStorage.getItem('token');
                    await axios.post('http://localhost:4000/api/nurse/availability', {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        isAvailable: true
                    }, {
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    setIsAvailable(true);
                    setLocationStatus(`Active at ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
                } catch (error) {
                    console.error(error);
                    alert("Failed to go online. Check network.");
                } finally {
                    setLoading(false);
                }
            }, (err) => {
                alert("Location access denied. Cannot go online.");
                setLoading(false);
            });
        } else {
            // Going OFFLINE
            try {
                const token = localStorage.getItem('token');
                // Send 0,0 or keep last location but set available=false
                await axios.post('http://localhost:4000/api/nurse/availability', {
                    lat: 0,
                    lng: 0,
                    isAvailable: false
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setIsAvailable(false);
                setLocationStatus("Offline");
            } catch (error) {
                alert("Failed to go offline.");
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.NURSE]}>
            <div className="p-8 bg-gray-50 min-h-screen">
                <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
                    <div className={`h-32 flex items-center justify-center transition-colors duration-500 ${isAvailable ? 'bg-green-500' : 'bg-gray-800'
                        }`}>
                        <span className="text-4xl">{isAvailable ? '🟢' : '⚫'}</span>
                    </div>

                    <div className="p-8 text-center">
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">
                            {isAvailable ? 'You are Online' : 'You are Offline'}
                        </h1>
                        <p className="text-gray-500 mb-8">{locationStatus}</p>

                        <button
                            onClick={toggleAvailability}
                            disabled={loading}
                            className={`w-full py-4 text-lg font-bold rounded-xl text-white shadow-lg transform transition active:scale-95 ${isAvailable
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-200'
                                : 'bg-green-600 hover:bg-green-700 shadow-green-200'
                                }`}
                        >
                            {loading ? 'Updating...' : (isAvailable ? 'GO OFFLINE' : 'GO ONLINE')}
                        </button>

                        <p className="mt-6 text-xs text-gray-400">
                            Going online makes you visible to patients within 10km.
                            <br />Battery usage may increase due to GPS.
                        </p>
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
