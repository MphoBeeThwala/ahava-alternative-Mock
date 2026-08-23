/**
 * AuditLog Service
 * 
 * Service for creating and managing audit log entries for PHI access tracking
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * AuditLog action types
 */
export type AuditAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'LIST';

/**
 * Entity types for AuditLog
 */
export type AuditEntityType = 
  | 'User'
  | 'Patient'
  | 'Doctor'
  | 'Nurse'
  | 'TriageCase'
  | 'TriageCaseReview'
  | 'Booking'
  | 'Visit'
  | 'Prescription'
  | 'Payment'
  | 'BiometricReading'
  | 'Message'
  | 'AdminAction'
  | 'Profile'
  | 'Consent'
  | 'HealthAlert'
  | 'Referral';

/**
 * Input for creating an AuditLog entry
 */
export interface CreateAuditLogInput {
  userId?: string | null;
  userRole?: string;
  action: AuditAction;
  resource: AuditEntityType;
  resourceId?: string | null;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Compute checksum for audit entry data
 */
function computeChecksum(data: Record<string, any>): string {
  const { checksum, ...dataWithoutChecksum } = data;
  const sortedKeys = Object.keys(dataWithoutChecksum).sort();
  const sortedData: Record<string, any> = {};
  sortedKeys.forEach(key => {
    sortedData[key] = dataWithoutChecksum[key];
  });
  
  const stringified = JSON.stringify(sortedData);
  const hash = require('crypto').createHash('sha256').update(stringified).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Create a new AuditLog entry
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<any> {
  const checksum = computeChecksum({
    userId: input.userId,
    userRole: input.userRole,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    metadata: input.metadata,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const auditLog = await prisma.auditLog.create({
    data: {
      userId: input.userId || null,
      userRole: input.userRole as any || null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId || null,
      metadata: input.metadata || null,
      checksum,
    },
  });

  return auditLog;
}

export default {
  createAuditLog,
};
