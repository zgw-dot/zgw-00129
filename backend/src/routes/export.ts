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
    SELECT v.*, u.display_name as creator_name, u.role as created_by_role
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

  const draftAuditClause = clauseIds.length > 0
    ? clauseIds.map(cid => `a.details LIKE '%"clause_id":"${cid}"%'`).join(' OR ')
    : '1=0';

  const auditLogs = db.prepare(`
    SELECT a.*, u.display_name as user_name
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    WHERE (a.entity_type = 'contract' AND a.entity_id = ?)
       OR (a.entity_type = 'clause' AND a.entity_id IN (${clauseIds.map(() => '?').join(',')}))
       OR (a.entity_type = 'suggestion' AND a.entity_id IN (${(suggestions as any[]).map(() => '?').join(',')}))
       OR (a.entity_type = 'draft' AND (${draftAuditClause}))
    ORDER BY a.created_at ASC
  `).all(req.params.id, ...clauseIds, ...(suggestions as any[]).map(s => (s as any).id)).map((log: any) => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  const drafts = clauseIds.length > 0 ? db.prepare(`
    SELECT d.*, u.display_name as user_name, u.role as user_role
    FROM suggestion_drafts d LEFT JOIN users u ON d.user_id = u.id
    WHERE d.clause_id IN (${clauseIds.map(() => '?').join(',')})
    ORDER BY d.updated_at DESC
  `).all(...clauseIds).map((d: any) => ({
    ...d,
    context_snapshot: d.context_snapshot ? JSON.parse(d.context_snapshot) : null
  })) : [];

  const countersignRounds = db.prepare(`
    SELECT r.*, u.display_name as creator_name, uw.display_name as withdrawer_name
    FROM countersign_rounds r
    LEFT JOIN users u ON r.created_by = u.id
    LEFT JOIN users uw ON r.withdrawn_by = uw.id
    WHERE r.contract_id = ?
    ORDER BY r.created_at ASC
  `).all(req.params.id);

  const roundIds = (countersignRounds as any[]).map(r => (r as any).id);
  let countersignParticipants: any[] = [];
  let countersignClauses: any[] = [];
  let countersignConclusions: any[] = [];
  let countersignHistory: any[] = [];

  if (roundIds.length > 0) {
    countersignParticipants = db.prepare(`
      SELECT p.*, u.username, u.display_name, u.role,
        uo.display_name as original_user_name
      FROM countersign_participants p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN countersign_participants po ON p.original_participant_id = po.id
      LEFT JOIN users uo ON po.user_id = uo.id
      WHERE p.round_id IN (${roundIds.map(() => '?').join(',')})
      ORDER BY p.created_at ASC
    `).all(...roundIds);

    countersignClauses = db.prepare(`
      SELECT cc.*, cl.clause_number, cl.title
      FROM countersign_clauses cc
      LEFT JOIN clauses cl ON cc.clause_id = cl.id
      WHERE cc.round_id IN (${roundIds.map(() => '?').join(',')})
      ORDER BY cc.created_at ASC
    `).all(...roundIds);

    countersignConclusions = db.prepare(`
      SELECT co.*, u.display_name as user_name, up.display_name as participant_name
      FROM countersign_conclusions co
      LEFT JOIN users u ON co.user_id = u.id
      LEFT JOIN countersign_participants p ON co.participant_id = p.id
      LEFT JOIN users up ON p.user_id = up.id
      WHERE co.round_id IN (${roundIds.map(() => '?').join(',')})
      ORDER BY co.updated_at ASC
    `).all(...roundIds);

    countersignHistory = db.prepare(`
      SELECT h.*, u.display_name as user_name
      FROM countersign_history h
      LEFT JOIN users u ON h.user_id = u.id
      WHERE h.round_id IN (${roundIds.map(() => '?').join(',')})
      ORDER BY h.created_at ASC
    `).all(...roundIds).map((h: any) => ({
      ...h,
      details: h.details ? JSON.parse(h.details) : null
    }));
  }

  const incompleteItems: any[] = [];
  for (const round of countersignRounds as any[]) {
    if (round.status === 'withdrawn') continue;
    const roundParticipants = countersignParticipants.filter(
      (p: any) => p.round_id === round.id && !p.is_replaced
    );
    const roundClauses = countersignClauses.filter(
      (c: any) => c.round_id === round.id && !c.invalidated
    );
    for (const p of roundParticipants) {
      for (const c of roundClauses) {
        const concl = countersignConclusions.find(
          (co: any) => co.round_id === round.id && co.participant_id === p.id && co.clause_id === c.clause_id
        );
        if (!concl || !concl.concluded_at) {
          incompleteItems.push({
            round_id: round.id,
            round_name: round.round_name,
            round_status: round.status,
            participant_id: p.id,
            participant_name: p.display_name,
            participant_role: p.role,
            clause_id: c.clause_id,
            clause_number: c.clause_number,
            clause_title: c.title,
            acknowledged: !!(concl && concl.acknowledged_at),
            concluded: !!(concl && concl.concluded_at),
            needs_rereview: !!c.needs_rereview,
            rereview_reason: c.rereview_reason || null,
            invalidation_reason: c.invalidation_reason || null
          });
        }
      }
    }
  }

  const invalidationReasons: any[] = [];
  for (const c of countersignClauses as any[]) {
    if (c.invalidated && c.invalidation_reason) {
      invalidationReasons.push({
        round_id: c.round_id,
        clause_id: c.clause_id,
        clause_number: c.clause_number,
        clause_title: c.title,
        reason: c.invalidation_reason
      });
    }
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    contract: {
      id: contract.id,
      name: contract.name,
      description: contract.description,
      created_at: contract.created_at,
      can_be_marked_complete: incompleteItems.length === 0
    },
    clauses: clauses.map((c: any) => ({
      ...c,
      versions: (versions as any[]).filter(v => v.clause_id === c.id),
      suggestions: (suggestions as any[]).filter(s => s.clause_id === c.id)
    })),
    drafts,
    audit_logs: auditLogs,
    countersign: {
      rounds: countersignRounds.map((r: any) => ({
        ...r,
        participants: countersignParticipants.filter((p: any) => p.round_id === r.id),
        clauses: countersignClauses.filter((c: any) => c.round_id === r.id),
        conclusions: countersignConclusions.filter((co: any) => co.round_id === r.id),
        history: countersignHistory.filter((h: any) => h.round_id === r.id)
      })),
      incomplete_items: incompleteItems,
      invalidation_reasons: invalidationReasons
    }
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contract-review-${contract.id}.json"`);
  res.json(exportData);
});

router.get('/clause/:id/version-history', (req: Request, res: Response) => {
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }

  const versions = db.prepare(`
    SELECT v.*, u.display_name as creator_name, u.role as created_by_role
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
    WHERE (a.entity_type IN ('clause', 'suggestion')
      AND (a.entity_id = ? OR a.entity_id IN (${(suggestions as any[]).map(() => '?').join(',')})))
       OR (a.entity_type = 'draft' AND a.details LIKE '%"clause_id":"' || ? || '"%')
    ORDER BY a.created_at ASC
  `).all(req.params.id, ...(suggestions as any[]).map(s => (s as any).id), req.params.id).map((log: any) => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  res.json({ clause, versions, suggestions, audit_logs: auditLogs });
});

export default router;
