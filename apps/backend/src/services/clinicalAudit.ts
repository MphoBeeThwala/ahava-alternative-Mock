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

export interface RequestAuditEvent {
    userId?: string | null;
    userRole?: UserRole | string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

function makeChecksum(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function toUserRole(value: RequestAuditEvent['userRole']): UserRole | null {
    if (!value) return null;
    return Object.values(UserRole).includes(value as UserRole) ? (value as UserRole) : null;
}

function withRequestContext(params: {
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}): Record<string, unknown> {
    const metadata = { ...(params.metadata ?? {}) };
    if (params.ipAddress) metadata.ipAddress = params.ipAddress;
    if (params.userAgent) metadata.userAgent = params.userAgent;
    return metadata;
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

/**
 * Compatibility helper for HTTP route audit events. Historic rows may use the
 * previous checksum envelope written before the audit-log consolidation cutover.
 */
export async function writeRequestAudit(event: RequestAuditEvent): Promise<void> {
    await writeClinicalAudit({
        userId: event.userId ?? null,
        userRole: toUserRole(event.userRole),
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId ?? null,
        metadata: withRequestContext({
            metadata: event.metadata,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
        }),
    });
}

