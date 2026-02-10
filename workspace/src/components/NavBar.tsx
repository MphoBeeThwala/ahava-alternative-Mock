'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

export default function NavBar() {
    const router = useRouter();
    const { user, logout, isAuthenticated } = useAuth();

    const handleLogout = () => {
        logout();
    };

    const getDashboardPath = () => {
        if (!user) return '/';
        switch (user.role) {
            case 'PATIENT': return '/patient/dashboard';
            case 'DOCTOR': return '/doctor/dashboard';
            case 'NURSE': return '/nurse/dashboard';
            case 'ADMIN': return '/admin/dashboard';
            default: return '/';
        }
    };

    if (!isAuthenticated) {
        return (
            <nav className="bg-white border-b border-slate-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-14">
                        <div className="flex">
                            <Link href="/" className="flex-shrink-0 flex items-center">
                                <span className="text-xl font-bold text-slate-900 tracking-tight">Ahava Healthcare</span>
                            </Link>
                        </div>
                        <div className="flex items-center gap-4">
                            <Link href="/auth/login" className="text-slate-700 hover:text-slate-900 px-3 py-2 rounded-md text-sm font-semibold">
                                Log in
                            </Link>
                            <Link href="/auth/signup" className="bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-md text-sm font-semibold">
                                Sign up
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>
        );
    }

    return (
        <nav className="bg-white border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-14">
                    <div className="flex">
                        <Link href={getDashboardPath()} className="flex-shrink-0 flex items-center">
                            <span className="text-xl font-bold text-slate-900 tracking-tight">Ahava Healthcare</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-slate-700 text-sm font-medium">
                            {user?.firstName} {user?.lastName} ({user?.role})
                        </span>
                        <button
                            onClick={handleLogout}
                            className="text-slate-700 hover:text-slate-900 px-3 py-2 rounded-md text-sm font-semibold"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}

