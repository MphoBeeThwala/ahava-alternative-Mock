'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';

export default function LoginPage() {
    const router = useRouter();
    const { login, isAuthenticated } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Redirect if already authenticated
    React.useEffect(() => {
        if (isAuthenticated) {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            switch (user.role) {
                case 'PATIENT': router.push('/patient/dashboard'); break;
                case 'DOCTOR': router.push('/doctor/dashboard'); break;
                case 'NURSE': router.push('/nurse/dashboard'); break;
                case 'ADMIN': router.push('/admin/dashboard'); break;
                default: router.push('/');
            }
        }
    }, [isAuthenticated, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await login(email, password);
            
            // Get user from localStorage after login
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
                setError((e.response?.data as { error?: string })?.error || e.message || 'Login failed');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
            <Card className="max-w-md w-full">
                <CardHeader>
                    <CardTitle className="text-center text-2xl">Sign in to your account</CardTitle>
                </CardHeader>
                <form className="space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                            {error}
                        </div>
                    )}
                    <section className="space-y-4" aria-labelledby="credentials-heading">
                        <h2 id="credentials-heading" className="sr-only">Credentials</h2>
                        <div>
                            <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                                Email address
                            </label>
                            <input
                                id="login-email"
                                data-testid="login-email"
                                type="email"
                                required
                                autoComplete="email"
                                className="block w-full rounded-xl border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition"
                                style={{ borderColor: 'var(--border)' }}
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                                Password
                            </label>
                            <input
                                id="login-password"
                                data-testid="login-password"
                                type="password"
                                required
                                autoComplete="current-password"
                                className="block w-full rounded-xl border px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition"
                                style={{ borderColor: 'var(--border)' }}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </section>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full rounded-xl py-3 px-4 text-base font-semibold disabled:opacity-50"
                    >
                        {loading ? 'Signing in...' : 'Sign in'}
                    </button>
                    <p className="text-center text-sm">
                        <Link href="/auth/signup" className="font-semibold hover:underline" style={{ color: 'var(--primary)' }}>
                            Don&apos;t have an account? Sign up
                        </Link>
                    </p>
                </form>
            </Card>
        </div>
    );
}
