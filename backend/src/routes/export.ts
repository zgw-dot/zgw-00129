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

  let reviewTickets: any[] = [];
  let reviewTicketHistory: any[] = [];
  if (roundIds.length > 0) {
    reviewTickets = db.prepare(`
      SELECT t.*,
        c.clause_number, c.title as clause_title,
        cr.round_name,
        u.display_name as assignee_name, u.username as assignee_username, u.role as assignee_role,
        cu.display_name as triggerer_name
      FROM review_tickets t
      LEFT JOIN clauses c ON t.clause_id = c.id
      LEFT JOIN countersign_rounds cr ON t.round_id = cr.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users cu ON t.triggered_by = cu.id
      WHERE t.round_id IN (${roundIds.map(() => '?').join(',')})
      ORDER BY t.created_at ASC
    `).all(...roundIds);

    const ticketIds = (reviewTickets as any[]).map(t => (t as any).id);
    if (ticketIds.length > 0) {
      reviewTicketHistory = db.prepare(`
        SELECT h.*, u.display_name as user_name
        FROM review_ticket_history h
        LEFT JOIN users u ON h.user_id = u.id
        WHERE h.ticket_id IN (${ticketIds.map(() => '?').join(',')})
        ORDER BY h.created_at ASC
      `).all(...ticketIds).map((h: any) => ({
        ...h,
        details: h.details ? JSON.parse(h.details) : null
      }));
    }
  }

  const openReviewTickets = (reviewTickets as any[]).filter(
    (t: any) => ['pending', 'acknowledged', 'reopened'].includes(t.status)
  );
  const invalidReviewTickets = (reviewTickets as any[]).filter(
    (t: any) => t.status === 'invalid'
  );

  const reviewChecklistSteps: any[] = [];
  for (const t of openReviewTickets) {
    reviewChecklistSteps.push({
      step_no: reviewChecklistSteps.length + 1,
      ticket_id: t.id,
      ticket_no: t.ticket_no,
      round_name: t.round_name,
      clause_number: t.clause_number,
      clause_title: t.clause_title,
      assignee_name: t.assignee_name,
      assignee_role: t.assignee_role,
      trigger_type: t.trigger_type,
      trigger_reason: t.trigger_reason,
      status: t.status,
      acknowledged: !!t.acknowledged_at,
      acknowledged_at: t.acknowledged_at || null,
      required_action: t.status === 'pending' ? '【未签收】请责任人先签收再处理'
        : t.status === 'acknowledged' ? '【处理中】责任人需给出通过/补资料/重新会签结论'
        : t.status === 'reopened' ? '【重开】责任人需重新签收并处理'
        : '待处理',
      priority: t.trigger_type === 'import_override' || t.trigger_type === 'rollback' || t.trigger_type === 'reject_conclusion' ? 'high' : 'medium'
    });
  }

  const ticketInvalidationReasons: any[] = [];
  for (const t of invalidReviewTickets) {
    ticketInvalidationReasons.push({
      ticket_id: t.id,
      ticket_no: t.ticket_no,
      round_name: t.round_name,
      clause_number: t.clause_number,
      clause_title: t.clause_title,
      assignee_name: t.assignee_name,
      trigger_type: t.trigger_type,
      original_reason: t.trigger_reason,
      invalidation_reason: t.invalidated_reason,
      invalidated_at: t.invalidated_at,
      reopened_count: t.reopened_count,
      old_conclusion: t.conclusion || null,
      old_comment: t.conclusion_comment || null
    });
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    contract: {
      id: contract.id,
      name: contract.name,
      description: contract.description,
      created_at: contract.created_at,
      can_be_marked_complete: incompleteItems.length === 0 && openReviewTickets.length === 0
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
    },
    review_tickets: {
      all_tickets: reviewTickets.map((t: any) => ({
        ...t,
        history: reviewTicketHistory.filter((h: any) => h.ticket_id === t.id)
      })),
      open_tickets: openReviewTickets,
      invalid_tickets: invalidReviewTickets,
      invalidation_reasons: ticketInvalidationReasons,
      checklist: reviewChecklistSteps,
      summary: {
        total: reviewTickets.length,
        open: openReviewTickets.length,
        closed: (reviewTickets as any[]).filter((t: any) => t.status === 'closed').length,
        reopened: (reviewTickets as any[]).filter((t: any) => t.status === 'reopened').length,
        invalid: invalidReviewTickets.length,
        pending: (reviewTickets as any[]).filter((t: any) => t.status === 'pending').length,
        acknowledged: (reviewTickets as any[]).filter((t: any) => t.status === 'acknowledged').length,
        by_trigger_type: {
          import_override: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'import_override').length,
          import_update: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'import_update').length,
          rollback: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'rollback').length,
          merge_version: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'merge_version').length,
          reject_conclusion: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'reject_conclusion').length,
          need_more_info: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'need_more_info').length,
          admin_rereview: (reviewTickets as any[]).filter((t: any) => t.trigger_type === 'admin_rereview').length
        }
      }
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
