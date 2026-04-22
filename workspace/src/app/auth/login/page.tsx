'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';

export default function LoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, loading: authLoading } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Redirect if already authenticated — but only AFTER the AuthContext has
    // finished validating the stored session with the backend. Before this
    // check, an expired-but-present localStorage token would make the login
    // page immediately bounce to the dashboard ("login gets skipped"), even
    // though the session was actually dead.
    React.useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) return;

        const user = JSON.parse(localStorage.getItem('user') || '{}');
        switch (user.role) {
            case 'PATIENT': router.push('/patient/dashboard'); break;
            case 'DOCTOR': router.push('/doctor/dashboard'); break;
            case 'NURSE': router.push('/nurse/dashboard'); break;
            case 'ADMIN': router.push('/admin/dashboard'); break;
            default: router.push('/');
        }
    }, [isAuthenticated, authLoading, router]);

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

    const inp: React.CSSProperties = {
        width: '100%', padding: '12px 14px', borderRadius: 10,
        border: '1.5px solid #e7e5e4', fontSize: 14, fontFamily: 'inherit',
        outline: 'none', background: '#fafaf9', color: '#1c1917',
        boxSizing: 'border-box', transition: 'border-color 0.18s',
    };

    // While AuthContext is still validating the stored session on page load,
    // render a tiny neutral shell instead of the form — this prevents the
    // form from flashing on-screen right before an auto-redirect (or from
    // appearing wrongly after a failed silent refresh).
    if (authLoading) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
                <div style={{ color: '#57534e', fontSize: 14 }}>Loading…</div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'inherit' }}>

            {/* ── LEFT BRAND PANEL ── */}
            <div style={{ flex: '0 0 42%', background: 'linear-gradient(160deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 48px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: -100, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle,rgba(13,148,136,0.18),transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: -80, left: -60, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle,rgba(0,74,173,0.2),transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 320 }}>
                    <div style={{ width: 80, height: 80, borderRadius: 22, background: 'linear-gradient(135deg,#0d9488,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, margin: '0 auto 24px' }}>⚕️</div>
                    <h2 style={{ color: 'white', fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Healthcare that comes to you</h2>
                    <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.7, marginBottom: 40 }}>
                        AI-powered health monitoring, on-demand nurse visits, and doctor oversight — all in one platform.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {[
                            { icon: '🔒', label: 'POPIA Compliant', sub: 'Your data is encrypted & protected' },
                            { icon: '✅', label: 'Professional Nurses', sub: 'Accreditation in progress' },
                            { icon: '⚕️', label: 'Doctor Oversight', sub: 'Licensed medical oversight' },
                        ].map(({ icon, label, sub }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', textAlign: 'left' }}>
                                <span style={{ fontSize: 20 }}>{icon}</span>
                                <div>
                                    <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 700 }}>{label}</div>
                                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{sub}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── RIGHT FORM PANEL ── */}
            <div style={{ flex: 1, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 40px' }}>
                <div style={{ width: '100%', maxWidth: 420 }}>
                    <Link href="/" style={{ color: '#a8a29e', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 36 }}>
                        ← Back to home
                    </Link>

                    <div style={{ marginBottom: 32 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#1c1917', marginBottom: 6 }}>Welcome back</h1>
                        <p style={{ fontSize: 14, color: '#57534e' }}>Sign in to your Ahava account</p>
                    </div>

                    {error && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <span style={{ color: '#ef4444', fontSize: 16, flexShrink: 0 }}>⚠</span>
                            <span style={{ color: '#dc2626', fontSize: 13 }}>{error}</span>
                        </div>
                    )}

                    <form style={{ display: 'flex', flexDirection: 'column', gap: 18 }} onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="login-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email address</label>
                            <input
                                id="login-email"
                                data-testid="login-email"
                                type="email"
                                required
                                autoComplete="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                style={inp}
                                onFocus={(e) => (e.currentTarget.style.borderColor = '#0d9488')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = '#e7e5e4')}
                            />
                        </div>
                        <div>
                            <label htmlFor="login-password" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
                            <input
                                id="login-password"
                                data-testid="login-password"
                                type="password"
                                required
                                autoComplete="current-password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={inp}
                                onFocus={(e) => (e.currentTarget.style.borderColor = '#0d9488')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = '#e7e5e4')}
                            />
                            <div style={{ textAlign: 'right', marginTop: 6 }}>
                                <Link href="/auth/forgot-password" style={{ fontSize: 12, color: '#0d9488', fontWeight: 600, textDecoration: 'none' }}>Forgot password?</Link>
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{ width: '100%', background: loading ? '#a8a29e' : 'linear-gradient(135deg,#0d9488,#059669)', border: 'none', color: 'white', borderRadius: 10, padding: '13px 20px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: loading ? 'none' : '0 4px 14px rgba(13,148,136,0.35)', marginTop: 4 }}
                        >
                            {loading ? 'Signing in…' : 'Sign In →'}
                        </button>
                    </form>

                    <p style={{ textAlign: 'center', marginTop: 28, fontSize: 13, color: '#57534e' }}>
                        Don&apos;t have an account?{' '}
                        <Link href="/auth/signup" style={{ color: '#0d9488', fontWeight: 700, textDecoration: 'none' }}>
                            Create one free
                        </Link>
                    </p>
                    <p style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: '#a8a29e' }}>
                        By signing in you agree to our{' '}
                        <Link href="/legal/terms" style={{ color: '#a8a29e', textDecoration: 'underline' }}>Terms</Link>
                        {' '}and{' '}
                        <Link href="/legal/privacy-policy" style={{ color: '#a8a29e', textDecoration: 'underline' }}>Privacy Policy</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
