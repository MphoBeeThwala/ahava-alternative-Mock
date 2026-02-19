'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';

export default function SignupPage() {
    const router = useRouter();
    const { register } = useAuth();
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        role: 'PATIENT' as 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN'
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await register(formData);
            
            // Get user from localStorage after registration
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            
            // Redirect based on role
            switch (user.role) {
                case 'PATIENT': router.push('/patient/dashboard'); break;
                case 'DOCTOR': router.push('/doctor/dashboard'); break;
                case 'NURSE': router.push('/nurse/dashboard'); break;
                case 'ADMIN': router.push('/admin/dashboard'); break;
                default: router.push('/');
            }
        } catch (err: unknown) {
            const e = err as { message?: string; code?: string; response?: { status?: number; data?: { error?: string } } };
            const status = e.response?.status;
            const is502 = status === 502 || status === 503 || status === 504;
            const isNetworkError = e.message === 'Network Error' || e.code === 'ERR_NETWORK' || !e.response;
            if (is502) {
                setError('Service temporarily unavailable. The backend may be starting or restarting—please try again in a moment.');
            } else if (isNetworkError) {
                setError('Cannot reach the API. If local: run the backend (e.g. pnpm dev in apps/backend). If deployed: set BACKEND_URL on the frontend service and redeploy.');
            } else {
                setError((e.response?.data as { error?: string })?.error || e.message || 'Registration failed');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
            <Card className="max-w-md w-full">
                <CardHeader>
                    <CardTitle className="text-center text-2xl">Create your account</CardTitle>
                </CardHeader>
                <form className="space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                            {error}
                        </div>
                    )}

                    <section className="space-y-4" aria-labelledby="personal-heading">
                        <h2 id="personal-heading" className="text-sm font-semibold text-[var(--foreground)]">Personal</h2>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label htmlFor="signup-first" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">First name</label>
                                <input
                                    id="signup-first"
                                    type="text"
                                    required
                                    autoComplete="given-name"
                                    className="w-full rounded-lg border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    placeholder="First name"
                                    value={formData.firstName}
                                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                />
                            </div>
                            <div className="flex-1">
                                <label htmlFor="signup-last" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Last name</label>
                                <input
                                    id="signup-last"
                                    type="text"
                                    required
                                    autoComplete="family-name"
                                    className="w-full rounded-lg border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    placeholder="Last name"
                                    value={formData.lastName}
                                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                />
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4" aria-labelledby="account-heading">
                        <h2 id="account-heading" className="text-sm font-semibold text-[var(--foreground)]">Account</h2>
                        <div>
                            <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Email address</label>
                            <input
                                id="signup-email"
                                type="email"
                                required
                                autoComplete="email"
                                className="block w-full rounded-lg border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                                style={{ borderColor: 'var(--border)' }}
                                placeholder="you@example.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Password</label>
                            <input
                                id="signup-password"
                                type="password"
                                required
                                autoComplete="new-password"
                                className="block w-full rounded-lg border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                                style={{ borderColor: 'var(--border)' }}
                                placeholder="••••••••"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            />
                        </div>
                        <div>
                            <label htmlFor="signup-role" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Role</label>
                            <select
                                id="signup-role"
                                className="block w-full rounded-lg border px-4 py-3 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] bg-[var(--card)]"
                                style={{ borderColor: 'var(--border)' }}
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value as typeof formData.role })}
                            >
                                <option value="PATIENT">Patient</option>
                                <option value="DOCTOR">Doctor</option>
                                <option value="NURSE">Nurse</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                        </div>
                    </section>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg py-3 px-4 text-base font-semibold text-white transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary)]"
                        style={{ backgroundColor: 'var(--primary)' }}
                    >
                        {loading ? 'Creating account...' : 'Sign up'}
                    </button>
                    <p className="text-center text-sm">
                        <Link href="/auth/login" className="font-semibold hover:underline" style={{ color: 'var(--primary)' }}>
                            Already have an account? Sign in
                        </Link>
                    </p>
                </form>
            </Card>
        </div>
    );
}
