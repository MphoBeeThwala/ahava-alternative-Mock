"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { adminApi, User } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
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
    
    // Add User Modal State
    const [showAddModal, setShowAddModal] = useState(false);
    const [newUser, setNewUser] = useState({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: 'PATIENT' as User['role'],
    });
    const [adding, setAdding] = useState(false);

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setAdding(true);
            await adminApi.createUser(newUser);
            toast.success(`User ${newUser.email} created successfully!`);
            setShowAddModal(false);
            setNewUser({ email: '', password: '', firstName: '', lastName: '', role: 'PATIENT' });
            loadUsers();
            loadStats();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to create user.');
        } finally {
            setAdding(false);
        }
    };

    const loadUsers = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminApi.getAllUsers();
            setUsers(data);
        } catch (error) {
            console.error('Failed to load users:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadStats = useCallback(async () => {
        try {
            const data = await adminApi.getStats();
            setStats(data);
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }, []);

    const handleResetData = async () => {
        const confirmMsg = "NUCLEAR OPTION: This will delete ALL bookings, readings, visits, and users (except you). This cannot be undone. Are you absolutely sure?";
        if (!confirm(confirmMsg)) return;
        
        const doubleConfirm = "Final warning: Type 'RESET' to confirm.";
        const input = prompt(doubleConfirm);
        if (input !== 'RESET') return;

        try {
            setLoading(true);
            await adminApi.resetTrialData(false);
            toast.success('Platform data reset successfully. You are now the only user.');
            loadUsers();
            loadStats();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to reset data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user?.role !== 'ADMIN') return;
        loadUsers();
        loadStats();
    }, [user, loadUsers, loadStats]);

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
                <div style={{ background: 'var(--background)', minHeight: '100vh' }}>

                    {/* ── Hero banner ── */}
                    <div style={{ background: 'linear-gradient(135deg,#0a1628 0%,#1e1b4b 55%,#2d1b5e 100%)', padding: '32px 40px 28px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,0.2),transparent 70%)', pointerEvents: 'none' }} />
                        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                            <div>
                                <p style={{ color: 'rgba(196,181,253,0.8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Admin Console</p>
                                <h1 style={{ color: 'white', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 900, margin: 0 }}>
                                    Welcome, {user?.firstName} {user?.lastName} 🛡️
                                </h1>
                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>Manage users, monitor platform health, and oversee all activity.</p>
                                <button
                                    onClick={handleResetData}
                                    style={{ marginTop: 12, padding: '8px 16px', background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1.5px solid rgba(239,68,68,0.4)', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.3)'}
                                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                                >
                                    ⚠️ Reset Platform Data
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                {[
                                    { label: 'Total', value: stats?.totalUsers ?? users.length, color: '#a78bfa' },
                                    { label: 'Active', value: users.filter((u) => u.isActive).length, color: '#34d399' },
                                    { label: 'Patients', value: users.filter((u) => u.role === 'PATIENT').length, color: '#60a5fa' },
                                    { label: 'Staff', value: users.filter((u) => u.role === 'NURSE' || u.role === 'DOCTOR').length, color: '#fbbf24' },
                                ].map(({ label, value, color }) => (
                                    <div key={label} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '12px 16px', textAlign: 'center', minWidth: 64 }}>
                                        <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
                                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                <div className="p-6 sm:p-8">

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
                                onClick={() => setShowAddModal(true)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                                style={{ backgroundColor: '#10b981' }}
                            >
                                + Add User
                            </button>
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                                style={{ backgroundColor: '#10b981' }}
                            >
                                + Add User
                            </button>
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
                </div>{/* p-6 */}
                </div>{/* outer bg */}

                {/* ADD USER MODAL */}
                {showAddModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
                        <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 500, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
                            <div style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', padding: '24px 30px', color: 'white' }}>
                                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Add New User</h3>
                                <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: 13 }}>Create a patient, doctor, nurse, or admin account.</p>
                            </div>
                            
                            <form onSubmit={handleAddUser} style={{ padding: 30 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>First Name</label>
                                        <input required value={newUser.firstName} onChange={e => setNewUser({...newUser, firstName: e.target.value})} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', outline: 'none' }} placeholder="Jane" />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Last Name</label>
                                        <input required value={newUser.lastName} onChange={e => setNewUser({...newUser, lastName: e.target.value})} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', outline: 'none' }} placeholder="Doe" />
                                    </div>
                                </div>

                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Email Address</label>
                                    <input type="email" required value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', outline: 'none' }} placeholder="jane.doe@example.com" />
                                </div>

                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Temporary Password</label>
                                    <input type="password" required value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', outline: 'none' }} placeholder="••••••••" minLength={8} />
                                </div>

                                <div style={{ marginBottom: 24 }}>
                                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Assigned Role</label>
                                    <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as any})} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', outline: 'none', background: 'white' }}>
                                        <option value="PATIENT">Patient</option>
                                        <option value="NURSE">Nurse</option>
                                        <option value="DOCTOR">Doctor</option>
                                        <option value="ADMIN">Admin</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', gap: 12 }}>
                                    <button type="button" onClick={() => setShowAddModal(false)} style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                                    <button type="submit" disabled={adding} style={{ flex: 2, padding: '12px', borderRadius: 10, border: 'none', background: adding ? '#94a3b8' : 'linear-gradient(135deg,#0d9488,#059669)', color: 'white', fontWeight: 700, cursor: adding ? 'not-allowed' : 'pointer' }}>
                                        {adding ? 'Creating...' : 'Create Account'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </DashboardLayout>
        </RoleGuard>
    );
}
