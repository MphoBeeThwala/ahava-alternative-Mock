"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

export enum UserRole {
    PATIENT = "PATIENT",
    NURSE = "NURSE",
    DOCTOR = "DOCTOR",
    ADMIN = "ADMIN"
}

interface RoleGuardProps {
    children: React.ReactNode;
    allowedRoles: UserRole[];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
    const router = useRouter();
    const { user, loading: authLoading, isAuthenticated } = useAuth();

    useEffect(() => {
        if (authLoading) return;

        if (!isAuthenticated || !user) {
            router.push('/auth/login');
            return;
        }

        if (!allowedRoles.includes(user.role as UserRole)) {
            router.push('/unauthorized');
        }
    }, [allowedRoles, authLoading, isAuthenticated, router, user]);

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-slate-700 font-medium">Checking Authorization...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user || !allowedRoles.includes(user.role as UserRole)) {
        return null;
    }

    return <>{children}</>;
}
