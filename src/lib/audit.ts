/**
 * Audit Logging Module
 * Provides comprehensive audit trail for HIPAA/POPIA compliance
 */

export type AuditAction =
  | "VIEW_REPORT"
  | "CREATE_REPORT"
  | "UPDATE_REPORT"
  | "DELETE_REPORT"
  | "VIEW_PATIENT_DATA"
  | "UPDATE_PROFILE"
  | "UPLOAD_IMAGE"
  | "DELETE_IMAGE"
  | "APPROVE_DIAGNOSIS"
  | "REJECT_DIAGNOSIS"
  | "ESCALATE_CASE"
  | "CREATE_APPOINTMENT"
  | "ACCEPT_APPOINTMENT"
  | "COMPLETE_APPOINTMENT"
  | "CANCEL_APPOINTMENT"
  | "UPDATE_BASELINE"
  | "RECORD_BIOMETRIC"
  | "TRIGGER_PANIC_ALERT"
  | "VIEW_ADMIN_PANEL"
  | "SIGN_IN"
  | "SIGN_OUT";

export type ResourceType =
  | "diagnostic_report"
  | "profile"
  | "image"
  | "appointment"
  | "biometric"
  | "baseline"
  | "panic_alert"
  | "user"
  | "system";

interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string | null;
  details?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Log an audit event
 */
export async function logAudit(
  db: D1Database,
  entry: AuditLogEntry
): Promise<void> {
  try {
    const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
    
    await db
      .prepare(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.userId,
        entry.action,
        entry.resourceType,
        entry.resourceId || null,
        detailsJson,
        entry.ipAddress || null,
        entry.userAgent || null
      )
      .run();
  } catch (error) {
    // Log audit failure but don't throw - audit logging should not break main functionality
    console.error("Audit logging failed:", error);
  }
}

/**
 * Extract request metadata for audit logging
 */
export function extractRequestMetadata(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    ipAddress: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Query audit logs for a specific user
 */
export async function getUserAuditLogs(
  db: D1Database,
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<any[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM audit_logs 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all();

  return results;
}

/**
 * Query audit logs for a specific resource
 */
export async function getResourceAuditLogs(
  db: D1Database,
  resourceType: ResourceType,
  resourceId: string,
  limit: number = 100
): Promise<any[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM audit_logs 
       WHERE resource_type = ? AND resource_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`
    )
    .bind(resourceType, resourceId, limit)
    .all();

  return results;
}

/**
 * Get audit log statistics for admin dashboard
 */
export async function getAuditStats(
  db: D1Database,
  startDate?: string,
  endDate?: string
): Promise<{
  totalLogs: number;
  byAction: Record<string, number>;
  byUser: Array<{ userId: string; count: number }>;
}> {
  let query = "SELECT COUNT(*) as total FROM audit_logs";
  const params: any[] = [];

  if (startDate && endDate) {
    query += " WHERE created_at BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  const total = await db.prepare(query).bind(...params).first<{ total: number }>();

  // Get counts by action
  const byActionQuery = startDate && endDate
    ? "SELECT action, COUNT(*) as count FROM audit_logs WHERE created_at BETWEEN ? AND ? GROUP BY action"
    : "SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action";
  
  const { results: byActionResults } = await db
    .prepare(byActionQuery)
    .bind(...params)
    .all();

  const byAction: Record<string, number> = {};
  for (const row of byActionResults) {
    byAction[(row as any).action] = (row as any).count;
  }

  // Get top users by activity
  const byUserQuery = startDate && endDate
    ? "SELECT user_id, COUNT(*) as count FROM audit_logs WHERE created_at BETWEEN ? AND ? GROUP BY user_id ORDER BY count DESC LIMIT 10"
    : "SELECT user_id, COUNT(*) as count FROM audit_logs GROUP BY user_id ORDER BY count DESC LIMIT 10";

  const { results: byUserResults } = await db
    .prepare(byUserQuery)
    .bind(...params)
    .all();

  return {
    totalLogs: total?.total || 0,
    byAction,
    byUser: byUserResults.map((row: any) => ({
      userId: row.user_id,
      count: row.count,
    })),
  };
}

