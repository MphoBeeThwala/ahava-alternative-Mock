"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { adminApi, User } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import NavBar from '../../../components/NavBar';

export default function AdminDashboard() {
    const { user } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<any>(null);

    useEffect(() => {
        loadUsers();
        loadStats();
    }, []);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const data = await adminApi.getAllUsers();
            setUsers(data);
        } catch (error) {
            console.error('Failed to load users:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStats = async () => {
        try {
            const data = await adminApi.getStats();
            setStats(data);
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    };

    const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
        try {
            await adminApi.updateUserStatus(userId, !currentStatus);
            loadUsers();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to update user status.');
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.ADMIN]}>
            <NavBar />
            <div className="p-6 sm:p-8 bg-slate-50 min-h-screen">
                <div className="mb-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Admin Console</h1>
                    <p className="text-slate-700 font-medium">Welcome, {user?.firstName} {user?.lastName}</p>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <p className="text-slate-600 text-sm font-medium mb-1">Total Users</p>
                            <p className="text-3xl font-bold text-slate-900">{stats.totalUsers || users.length}</p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <p className="text-slate-600 text-sm font-medium mb-1">Active Users</p>
                            <p className="text-3xl font-bold text-green-600">
                                {users.filter(u => u.isActive).length}
                            </p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <p className="text-slate-600 text-sm font-medium mb-1">Patients</p>
                            <p className="text-3xl font-bold text-blue-600">
                                {users.filter(u => u.role === 'PATIENT').length}
                            </p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <p className="text-slate-600 text-sm font-medium mb-1">Healthcare Workers</p>
                            <p className="text-3xl font-bold text-purple-600">
                                {users.filter(u => u.role === 'NURSE' || u.role === 'DOCTOR').length}
                            </p>
                        </div>
                    </div>
                )}

                {/* User Management Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
                        <button 
                            onClick={loadUsers}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition"
                        >
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <div className="p-12 text-center text-slate-600 font-medium">Loading users...</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-700 text-sm font-medium">
                                        <th className="p-4">Name</th>
                                        <th className="p-4">Role</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Status</th>
                                        <th className="p-4">Verified</th>
                                        <th className="p-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-slate-50 transition">
                                            <td className="p-4 font-semibold text-slate-900">
                                                {user.firstName} {user.lastName}
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                    user.role === 'DOCTOR' 
                                                        ? 'bg-purple-100 text-purple-700'
                                                        : user.role === 'NURSE' 
                                                        ? 'bg-green-100 text-green-700'
                                                        : user.role === 'ADMIN' 
                                                        ? 'bg-slate-200 text-slate-800'
                                                        : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-600">{user.email}</td>
                                            <td className="p-4">
                                                <span className={`text-sm ${
                                                    user.isActive ? 'text-green-600' : 'text-red-500'
                                                }`}>
                                                    {user.isActive ? 'ACTIVE' : 'INACTIVE'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-sm ${
                                                    user.isVerified ? 'text-green-600' : 'text-yellow-600'
                                                }`}>
                                                    {user.isVerified ? '✓ Verified' : '⚠ Pending'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <button
                                                    onClick={() => toggleUserStatus(user.id, user.isActive)}
                                                    className={`text-sm font-medium transition ${
                                                        user.isActive 
                                                            ? 'text-red-600 hover:text-red-700' 
                                                            : 'text-green-600 hover:text-green-700'
                                                    }`}
                                                >
                                                    {user.isActive ? 'Suspend' : 'Activate'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {users.length === 0 && !loading && (
                        <div className="p-12 text-center text-slate-600 font-medium">No users found.</div>
                    )}
                </div>
            </div>
        </RoleGuard>
    );
}
