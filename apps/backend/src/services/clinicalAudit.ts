import { UserRole } from '@prisma/client';
import { createHash } from 'crypto';
import prisma from '../lib/prisma';

export interface ClinicalAuditEvent {
    userId?: string | null;
    userRole?: UserRole | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
}

function makeChecksum(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export async function writeClinicalAudit(event: ClinicalAuditEvent): Promise<void> {
    try {
        const envelope = {
            action: event.action,
            resource: event.resource,
            resourceId: event.resourceId ?? null,
            userId: event.userId ?? null,
            userRole: event.userRole ?? null,
            metadata: event.metadata ?? {},
            at: new Date().toISOString(),
        };
        const checksum = makeChecksum(envelope);

        await prisma.auditLog.create({
            data: {
                userId: event.userId ?? null,
                userRole: event.userRole ?? null,
                action: event.action,
                resource: event.resource,
                resourceId: event.resourceId ?? null,
                metadata: (event.metadata ?? {}) as object,
                checksum,
            },
        });
    } catch (err) {
        console.warn('[clinicalAudit] failed to persist audit log (non-fatal):', (err as Error).message);
    }
}

