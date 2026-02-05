"use client";

import React, { useState } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';

// Mock Data for Admin View
const MOCK_USERS = [
    { id: '1', name: 'John Doe', role: 'PATIENT', email: 'john@example.com', status: 'ACTIVE' },
    { id: '2', name: 'Sarah Nurse', role: 'NURSE', email: 'sarah@ahava.com', status: 'ACTIVE' },
    { id: '3', name: 'Dr. House', role: 'DOCTOR', email: 'house@ahava.com', status: 'VERIFIED' },
    { id: '4', name: 'Suspicious User', role: 'PATIENT', email: 'spam@mail.com', status: 'SUSPENDED' },
];

export default function AdminDashboard() {
    const [users, setUsers] = useState(MOCK_USERS);

    const toggleStatus = (id: string) => {
        setUsers(users.map(u => {
            if (u.id === id) {
                return { ...u, status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' };
            }
            return u;
        }));
    };

    return (
        <RoleGuard allowedRoles={[UserRole.ADMIN]}>
            <div className="p-8 bg-gray-50 min-h-screen">
                <h1 className="text-3xl font-bold text-gray-800 mb-8">Admin Console</h1>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between">
                        <h2 className="text-lg font-semibold text-gray-700">User Management</h2>
                        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">
                            + Add User
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-gray-50 text-gray-600 text-sm">
                                    <th className="p-4">Name</th>
                                    <th className="p-4">Role</th>
                                    <th className="p-4">Email</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-50 transition">
                                        <td className="p-4 font-medium text-gray-900">{user.name}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.role === 'DOCTOR' ? 'bg-purple-100 text-purple-700' :
                                                    user.role === 'NURSE' ? 'bg-green-100 text-green-700' :
                                                        user.role === 'ADMIN' ? 'bg-gray-200 text-gray-800' :
                                                            'bg-blue-100 text-blue-700'
                                                }`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="p-4 text-gray-500">{user.email}</td>
                                        <td className="p-4">
                                            <span className={`text-sm ${user.status === 'ACTIVE' || user.status === 'VERIFIED' ? 'text-green-600' : 'text-red-500'
                                                }`}>
                                                {user.status}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => toggleStatus(user.id)}
                                                className="text-gray-400 hover:text-red-600 font-medium text-sm transition"
                                            >
                                                {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
