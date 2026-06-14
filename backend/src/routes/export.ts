import { Router, Request, Response } from 'express';
import db from '../database';
import { authMiddleware, requireRole } from '../middleware';

const router = Router();

router.use(authMiddleware);

router.get('/audit-logs', (req: Request, res: Response) => {
  const { entity_type, entity_id, user_id, limit = 200, offset = 0 } = req.query;

  let sql = `
    SELECT a.*, u.display_name as user_name
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (entity_type) { sql += ' AND a.entity_type = ?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND a.entity_id = ?'; params.push(entity_id); }
  if (user_id) { sql += ' AND a.user_id = ?'; params.push(user_id); }

  sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = db.prepare(sql).all(...params).map((log: any) => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));
  res.json(logs);
});

router.get('/contract/:id/export', requireRole('admin', 'legal'), (req: Request, res: Response) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id) as any;
  if (!contract) { res.status(404).json({ error: '合同不存在' }); return; }

  const clauses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM suggestions s WHERE s.clause_id = c.id AND s.status = 'pending') as pending_count
    FROM clauses c WHERE c.contract_id = ? ORDER BY CAST(c.clause_number AS TEXT) ASC
  `).all(req.params.id);

  const clauseIds = (clauses as any[]).map(c => c.id);

  const versions = clauseIds.length > 0 ? db.prepare(`
    SELECT v.*, u.display_name as creator_name
    FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
    WHERE v.clause_id IN (${clauseIds.map(() => '?').join(',')})
    ORDER BY v.clause_id, v.version_number DESC
  `).all(...clauseIds) : [];

  const suggestions = clauseIds.length > 0 ? db.prepare(`
    SELECT s.*, u.display_name as creator_name, u2.display_name as resolver_name
    FROM suggestions s
    LEFT JOIN users u ON s.created_by = u.id
    LEFT JOIN users u2 ON s.resolved_by = u2.id
    WHERE s.clause_id IN (${clauseIds.map(() => '?').join(',')})
    ORDER BY s.clause_id, s.created_at DESC
  `).all(...clauseIds) : [];

  const auditLogs = db.prepare(`
    SELECT a.*, u.display_name as user_name
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    WHERE (a.entity_type = 'contract' AND a.entity_id = ?)
       OR (a.entity_type = 'clause' AND a.entity_id IN (${clauseIds.map(() => '?').join(',')}))
       OR (a.entity_type = 'suggestion' AND a.entity_id IN (${(suggestions as any[]).map(() => '?').join(',')}))
    ORDER BY a.created_at ASC
  `).all(req.params.id, ...clauseIds, ...(suggestions as any[]).map(s => (s as any).id)).map((log: any) => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  const exportData = {
    exported_at: new Date().toISOString(),
    contract: {
      id: contract.id,
      name: contract.name,
      description: contract.description,
      created_at: contract.created_at
    },
    clauses: clauses.map((c: any) => ({
      ...c,
      versions: (versions as any[]).filter(v => v.clause_id === c.id),
      suggestions: (suggestions as any[]).filter(s => s.clause_id === c.id)
    })),
    audit_logs: auditLogs
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contract-review-${contract.id}.json"`);
  res.json(exportData);
});

router.get('/clause/:id/version-history', (req: Request, res: Response) => {
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }

  const versions = db.prepare(`
    SELECT v.*, u.display_name as creator_name
    FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
    WHERE v.clause_id = ? ORDER BY v.version_number DESC
  `).all(req.params.id);

  const suggestions = db.prepare(`
    SELECT s.*, u.display_name as creator_name, u2.display_name as resolver_name
    FROM suggestions s
    LEFT JOIN users u ON s.created_by = u.id
    LEFT JOIN users u2 ON s.resolved_by = u2.id
    WHERE s.clause_id = ? ORDER BY s.created_at DESC
  `).all(req.params.id);

  const auditLogs = db.prepare(`
    SELECT a.*, u.display_name as user_name
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    WHERE a.entity_type IN ('clause', 'suggestion')
      AND (a.entity_id = ? OR a.entity_id IN (${(suggestions as any[]).map(() => '?').join(',')}))
    ORDER BY a.created_at ASC
  `).all(req.params.id, ...(suggestions as any[]).map(s => (s as any).id)).map((log: any) => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  res.json({ clause, versions, suggestions, audit_logs: auditLogs });
});

export default router;
