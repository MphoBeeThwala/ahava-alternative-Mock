"use client";

import React, { useState, useEffect, useMemo } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { adminApi, User } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { KpiCard } from '../../../components/ui/KpiCard';
import { StatusBadge } from '../../../components/ui/StatusBadge';

type RoleFilter = 'ALL' | User['role'];
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export default function AdminDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<{ totalUsers?: number } | null>(null);
    const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

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
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to update user status.');
        }
    };

    const filteredUsers = useMemo(() => {
        return users.filter((u) => {
            if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
            if (statusFilter === 'ACTIVE' && !u.isActive) return false;
            if (statusFilter === 'INACTIVE' && u.isActive) return false;
            return true;
        });
    }, [users, roleFilter, statusFilter]);

    return (
        <RoleGuard allowedRoles={[UserRole.ADMIN]}>
            <DashboardLayout>
                <div className="p-6 sm:p-8 bg-[var(--background)] min-h-screen">
                <div className="mb-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight mb-2">Admin Console</h1>
                    <p className="text-[var(--muted)] font-medium">Welcome, {user?.firstName} {user?.lastName}</p>
                </div>

                {/* KPI row */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <KpiCard label="Total Users" value={stats.totalUsers ?? users.length} />
                        <KpiCard
                            label="Active Users"
                            value={users.filter((u) => u.isActive).length}
                            badge="Active"
                            badgeVariant="success"
                        />
                        <KpiCard label="Patients" value={users.filter((u) => u.role === 'PATIENT').length} />
                        <KpiCard label="Healthcare Workers" value={users.filter((u) => u.role === 'NURSE' || u.role === 'DOCTOR').length} />
                    </div>
                )}

                {/* User Management Table */}
                <Card className="overflow-hidden p-0">
                    <CardHeader className="flex flex-row flex-wrap justify-between items-center gap-4 border-b p-6" style={{ borderColor: 'var(--border)' }}>
                        <CardTitle className="mb-0">User Management</CardTitle>
                        <div className="flex flex-wrap items-center gap-3">
                            <select
                                value={roleFilter}
                                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
                                className="rounded-lg border px-3 py-2 text-sm text-[var(--foreground)]"
                                style={{ borderColor: 'var(--border)' }}
                            >
                                <option value="ALL">All roles</option>
                                <option value="PATIENT">Patient</option>
                                <option value="NURSE">Nurse</option>
                                <option value="DOCTOR">Doctor</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                                className="rounded-lg border px-3 py-2 text-sm text-[var(--foreground)]"
                                style={{ borderColor: 'var(--border)' }}
                            >
                                <option value="ALL">All status</option>
                                <option value="ACTIVE">Active</option>
                                <option value="INACTIVE">Inactive</option>
                            </select>
                            <button
                                onClick={loadUsers}
                                disabled={loading}
                                aria-busy={loading}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                                style={{ backgroundColor: 'var(--primary)' }}
                            >
                                {loading ? 'Loading…' : 'Refresh'}
                            </button>
                        </div>
                    </CardHeader>

                    {loading ? (
                        <div className="p-12 text-center font-medium text-[var(--muted)]">Loading users...</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="text-sm font-medium text-[var(--muted)]" style={{ backgroundColor: 'var(--background)' }}>
                                        <th className="p-4">Name</th>
                                        <th className="p-4">Role</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Status</th>
                                        <th className="p-4">Verified</th>
                                        <th className="p-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                                    {filteredUsers.map((u) => (
                                        <tr key={u.id} className="transition hover:bg-slate-50/80">
                                            <td className="p-4 font-semibold text-[var(--foreground)]">
                                                {u.firstName} {u.lastName}
                                            </td>
                                            <td className="p-4">
                                                <span className="rounded-full px-2 py-1 text-xs font-bold bg-slate-100 text-slate-700">
                                                    {u.role}
                                                </span>
                                            </td>
                                            <td className="p-4 text-[var(--muted)]">{u.email}</td>
                                            <td className="p-4">
                                                <StatusBadge variant={u.isActive ? 'success' : 'danger'} className="text-xs">
                                                    {u.isActive ? 'ACTIVE' : 'INACTIVE'}
                                                </StatusBadge>
                                            </td>
                                            <td className="p-4">
                                                <StatusBadge variant={u.isVerified ? 'success' : 'warning'} className="text-xs">
                                                    {u.isVerified ? 'Verified' : 'Pending'}
                                                </StatusBadge>
                                            </td>
                                            <td className="p-4">
                                                <button
                                                    onClick={() => toggleUserStatus(u.id, u.isActive)}
                                                    className="text-sm font-medium transition hover:underline"
                                                    style={{ color: u.isActive ? 'var(--danger)' : 'var(--success)' }}
                                                >
                                                    {u.isActive ? 'Suspend' : 'Activate'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {filteredUsers.length === 0 && !loading && (
                        <div className="p-12 text-center font-medium text-[var(--muted)]">No users found.</div>
                    )}
                </Card>
                </div>
            </DashboardLayout>
        </RoleGuard>
    );
}
