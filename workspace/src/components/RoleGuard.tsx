"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        // MVP: Check localStorage. In prod, verify JWT signature or use HttpOnly cookie + Middleware.
        const userJson = localStorage.getItem('user');
        if (!userJson) {
            router.push('/login');
            return;
        }

        try {
            const user = JSON.parse(userJson);
            if (allowedRoles.includes(user.role)) {
                setAuthorized(true);
            } else {
                router.push('/unauthorized');
            }
        } catch (e) {
            router.push('/login');
        }
    }, [allowedRoles, router]);

    if (!authorized) {
        return <div className="min-h-screen flex items-center justify-center">Checking Authorization...</div>;
    }

    return <>{children}</>;
}
