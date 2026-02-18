'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';

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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-xl shadow-lg border border-slate-200">
                <div>
                    <h2 className="mt-6 text-center text-2xl font-bold text-slate-900 tracking-tight">
                        Sign in to your account
                    </h2>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && <div className="text-red-600 text-center text-sm font-medium">{error}</div>}
                    <div className="space-y-3">
                        <input
                            type="email"
                            required
                            className="block w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <input
                            type="password"
                            required
                            className="block w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-3 px-4 border border-transparent text-base font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                            {loading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </div>
                    <div className="text-center">
                        <Link href="/auth/signup" className="text-blue-600 hover:text-blue-700 font-semibold text-sm">
                            Don&apos;t have an account? Sign up
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
