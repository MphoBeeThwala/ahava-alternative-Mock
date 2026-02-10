'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';

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
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-xl shadow-lg border border-slate-200">
                <div>
                    <h2 className="mt-6 text-center text-2xl font-bold text-slate-900 tracking-tight">
                        Create your account
                    </h2>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && <div className="text-red-600 text-center text-sm font-medium">{error}</div>}
                    <div className="space-y-3">
                        <div className="flex gap-3">
                            <input
                                type="text"
                                required
                                className="flex-1 px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                                placeholder="First Name"
                                value={formData.firstName}
                                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                            />
                            <input
                                type="text"
                                required
                                className="flex-1 px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                                placeholder="Last Name"
                                value={formData.lastName}
                                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                            />
                        </div>
                        <input
                            type="email"
                            required
                            className="block w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                            placeholder="Email address"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                        <input
                            type="password"
                            required
                            className="block w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
                            placeholder="Password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        />
                        <select
                            className="block w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base bg-white"
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value as typeof formData.role })}
                        >
                            <option value="PATIENT">Patient</option>
                            <option value="DOCTOR">Doctor</option>
                            <option value="NURSE">Nurse</option>
                            <option value="ADMIN">Admin</option>
                        </select>
                    </div>

                    <div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-3 px-4 border border-transparent text-base font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                            {loading ? 'Creating account...' : 'Sign up'}
                        </button>
                    </div>
                    <div className="text-center">
                        <Link href="/auth/login" className="text-blue-600 hover:text-blue-700 font-semibold text-sm">
                            Already have an account? Sign in
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
