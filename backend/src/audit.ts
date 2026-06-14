import db from './database';
import { v4 as uuidv4 } from 'uuid';

export function createAuditLog(
  action: string,
  entityType: string,
  entityId: string | null,
  userId: string | null,
  userRole: string | null,
  details: Record<string, unknown> = {}
) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, entity_id, user_id, user_role, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    uuidv4(),
    action,
    entityType,
    entityId,
    userId,
    userRole,
    JSON.stringify(details)
  );
}
