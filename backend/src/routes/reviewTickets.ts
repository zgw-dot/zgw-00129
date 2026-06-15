import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';

const router = Router();
router.use(authMiddleware);

function generateTicketNo(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `RT-${yyyy}${mm}${dd}-${rand}`;
}

function createTicketHistory(
  ticketId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  userId: string | null,
  userRole: string | null,
  details: Record<string, unknown> = {}
) {
  const stmt = db.prepare(`
    INSERT INTO review_ticket_history (id, ticket_id, action, from_status, to_status, user_id, user_role, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    uuidv4(),
    ticketId,
    action,
    fromStatus,
    toStatus,
    userId,
    userRole,
    JSON.stringify(details)
  );
}

export function createReviewTicketsForClause(
  clauseId: string,
  triggerType: string,
  triggerReason: string,
  triggeredBy: string | null,
  triggeredByRole: string | null,
  originalVersion: number | null,
  newVersion: number | null,
  overwriteExistingPending = false
): string[] {
  const activeRounds = db.prepare(`
    SELECT cc.*, r.contract_id, r.status as round_status
    FROM countersign_clauses cc
    JOIN countersign_rounds r ON cc.round_id = r.id
    WHERE cc.clause_id = ? AND r.status IN ('active', 'completed') AND cc.invalidated = 0
  `).all(clauseId) as any[];

  const createdTicketIds: string[] = [];

  for (const cc of activeRounds) {
    const participants = db.prepare(`
      SELECT * FROM countersign_participants WHERE round_id = ? AND is_replaced = 0
    `).all(cc.round_id) as any[];

    for (const p of participants) {
      const existingPending = db.prepare(`
        SELECT * FROM review_tickets
        WHERE round_id = ? AND clause_id = ? AND participant_id = ?
          AND status IN ('pending', 'acknowledged', 'reopened')
      `).get(cc.round_id, clauseId, p.id) as any;

      if (existingPending && !overwriteExistingPending) {
        continue;
      }

      if (existingPending && overwriteExistingPending) {
        db.prepare(`
          UPDATE review_tickets
          SET status = 'invalid', invalidated_reason = ?, invalidated_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(`被新工单覆盖：${triggerReason}`, existingPending.id);

        createTicketHistory(
          existingPending.id, 'invalidate', existingPending.status, 'invalid',
          triggeredBy, triggeredByRole,
          { reason: '被新工单覆盖', new_trigger: triggerType, new_reason: triggerReason }
        );
      }

      const ticketId = uuidv4();
      const ticketNo = generateTicketNo();

      db.prepare(`
        INSERT INTO review_tickets (
          id, ticket_no, contract_id, round_id, countersign_clause_id, clause_id,
          participant_id, assignee_id, trigger_type, trigger_reason, triggered_by,
          original_version, new_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticketId, ticketNo, cc.contract_id, cc.round_id, cc.id, clauseId,
        p.id, p.user_id, triggerType, triggerReason, triggeredBy,
        originalVersion, newVersion
      );

      createTicketHistory(
        ticketId, 'create', null, 'pending',
        triggeredBy, triggeredByRole,
        {
          ticket_no: ticketNo,
          trigger_type: triggerType,
          trigger_reason: triggerReason,
          clause_id: clauseId,
          round_id: cc.round_id,
          assignee_id: p.user_id,
          original_version: originalVersion,
          new_version: newVersion
        }
      );

      createdTicketIds.push(ticketId);

      createAuditLog('create_review_ticket', 'review_ticket', ticketId, triggeredBy, triggeredByRole, {
        ticket_no: ticketNo,
        clause_id: clauseId,
        round_id: cc.round_id,
        assignee_id: p.user_id,
        trigger_type: triggerType,
        trigger_reason: triggerReason
      });
    }
  }

  return createdTicketIds;
}

export function createReviewTicketForReject(
  roundId: string,
  clauseId: string,
  participantId: string,
  rejectUserId: string,
  rejectUserRole: string,
  rejectComment: string,
  triggerType: 'reject_conclusion' | 'need_more_info'
): string[] {
  const cc = db.prepare(`
    SELECT cc.*, r.contract_id
    FROM countersign_clauses cc
    JOIN countersign_rounds r ON cc.round_id = r.id
    WHERE cc.round_id = ? AND cc.clause_id = ? AND cc.invalidated = 0
  `).get(roundId, clauseId) as any;

  if (!cc) return [];

  const rejectParticipant = db.prepare(`
    SELECT p.*, u.display_name as rejector_name
    FROM countersign_participants p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ? AND p.round_id = ? AND p.is_replaced = 0
  `).get(participantId, roundId) as any;

  const triggerReason = triggerType === 'reject_conclusion'
    ? `${rejectParticipant?.rejector_name || '参与人'} 退回：${rejectComment || '无备注'}`
    : `${rejectParticipant?.rejector_name || '参与人'} 要求补资料：${rejectComment || '无备注'}`;

  const otherParticipants = db.prepare(`
    SELECT * FROM countersign_participants
    WHERE round_id = ? AND is_replaced = 0 AND id != ?
  `).all(roundId, participantId) as any[];

  const createdTicketIds: string[] = [];

  for (const p of otherParticipants) {
    const existingPending = db.prepare(`
      SELECT * FROM review_tickets
      WHERE round_id = ? AND clause_id = ? AND participant_id = ?
        AND status IN ('pending', 'acknowledged', 'reopened')
    `).get(roundId, clauseId, p.id) as any;

    if (existingPending) continue;

    const ticketId = uuidv4();
    const ticketNo = generateTicketNo();

    db.prepare(`
      INSERT INTO review_tickets (
        id, ticket_no, contract_id, round_id, countersign_clause_id, clause_id,
        participant_id, assignee_id, trigger_type, trigger_reason, triggered_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketId, ticketNo, cc.contract_id, roundId, cc.id, clauseId,
      p.id, p.user_id, triggerType, triggerReason, rejectUserId
    );

    createTicketHistory(
      ticketId, 'create', null, 'pending',
      rejectUserId, rejectUserRole,
      {
        ticket_no: ticketNo,
        trigger_type: triggerType,
        trigger_reason: triggerReason,
        clause_id: clauseId,
        round_id: roundId,
        assignee_id: p.user_id,
        source_participant_id: participantId
      }
    );

    createdTicketIds.push(ticketId);

    createAuditLog('create_review_ticket', 'review_ticket', ticketId, rejectUserId, rejectUserRole, {
      ticket_no: ticketNo,
      clause_id: clauseId,
      round_id: roundId,
      assignee_id: p.user_id,
      trigger_type: triggerType,
      source: 'countersign_reject'
    });
  }

  return createdTicketIds;
}

router.get('/', (req: Request, res: Response) => {
  const {
    contract_id, round_id, clause_id, assignee_id, status, trigger_type,
    include_closed = 'false', only_mine = 'false', limit = '200', offset = '0'
  } = req.query;

  let sql = `
    SELECT t.*,
      c.clause_number, c.title as clause_title, c.current_version,
      cr.round_name, cr.status as round_status,
      u.display_name as assignee_name, u.username as assignee_username, u.role as assignee_role,
      cu.display_name as triggerer_name,
      ct.name as contract_name
    FROM review_tickets t
    LEFT JOIN clauses c ON t.clause_id = c.id
    LEFT JOIN countersign_rounds cr ON t.round_id = cr.id
    LEFT JOIN users u ON t.assignee_id = u.id
    LEFT JOIN users cu ON t.triggered_by = cu.id
    LEFT JOIN contracts ct ON t.contract_id = ct.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (contract_id) { sql += ' AND t.contract_id = ?'; params.push(contract_id); }
  if (round_id) { sql += ' AND t.round_id = ?'; params.push(round_id); }
  if (clause_id) { sql += ' AND t.clause_id = ?'; params.push(clause_id); }
  if (assignee_id) { sql += ' AND t.assignee_id = ?'; params.push(assignee_id); }
  if (only_mine === 'true') {
    sql += ' AND t.assignee_id = ?';
    params.push(req.user!.userId);
  }
  if (status && ['pending', 'acknowledged', 'closed', 'reopened', 'invalid'].includes(status as string)) {
    sql += ' AND t.status = ?';
    params.push(status);
  } else if (include_closed === 'false') {
    sql += " AND t.status NOT IN ('invalid')";
  }
  if (trigger_type && [
    'import_override', 'import_update', 'rollback', 'merge_version',
    'reject_conclusion', 'need_more_info', 'admin_rereview'
  ].includes(trigger_type as string)) {
    sql += ' AND t.trigger_type = ?';
    params.push(trigger_type);
  }

  sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const tickets = db.prepare(sql).all(...params);

  let statsSql = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN t.status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_count,
      SUM(CASE WHEN t.status IN ('pending','acknowledged','reopened') THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) as closed_count,
      SUM(CASE WHEN t.status = 'reopened' THEN 1 ELSE 0 END) as reopened_count,
      SUM(CASE WHEN t.status = 'invalid' THEN 1 ELSE 0 END) as invalid_count
    FROM review_tickets t
    LEFT JOIN countersign_rounds cr ON t.round_id = cr.id
    WHERE 1=1
  `;
  const statsParams: any[] = [];
  if (contract_id) { statsSql += ' AND t.contract_id = ?'; statsParams.push(contract_id); }
  if (only_mine === 'true') {
    statsSql += ' AND t.assignee_id = ?';
    statsParams.push(req.user!.userId);
  }
  const stats = db.prepare(statsSql).get(...statsParams);

  res.json({ tickets, stats });
});

router.get('/:id', (req: Request, res: Response) => {
  const ticket = db.prepare(`
    SELECT t.*,
      c.clause_number, c.title as clause_title, c.content as clause_content, c.current_version, c.risk_level,
      cr.round_name, cr.description as round_description, cr.status as round_status, cr.deadline,
      u.display_name as assignee_name, u.username as assignee_username, u.role as assignee_role,
      cu.display_name as triggerer_name, cu.role as triggerer_role,
      ct.name as contract_name, ct.id as contract_id
    FROM review_tickets t
    LEFT JOIN clauses c ON t.clause_id = c.id
    LEFT JOIN countersign_rounds cr ON t.round_id = cr.id
    LEFT JOIN users u ON t.assignee_id = u.id
    LEFT JOIN users cu ON t.triggered_by = cu.id
    LEFT JOIN contracts ct ON t.contract_id = ct.id
    WHERE t.id = ?
  `).get(req.params.id) as any;

  if (!ticket) {
    res.status(404).json({ error: '工单不存在' });
    return;
  }

  if (req.user!.role !== 'admin' && ticket.assignee_id !== req.user!.userId) {
    const myParticipant = db.prepare(`
      SELECT id FROM countersign_participants
      WHERE round_id = ? AND user_id = ? AND is_replaced = 0
    `).get(ticket.round_id, req.user!.userId);
    if (!myParticipant) {
      res.status(403).json({ error: '您无权查看此工单' });
      return;
    }
  }

  const history = db.prepare(`
    SELECT h.*, u.display_name as user_name
    FROM review_ticket_history h
    LEFT JOIN users u ON h.user_id = u.id
    WHERE h.ticket_id = ?
    ORDER BY h.created_at ASC
  `).all(req.params.id).map((h: any) => ({
    ...h,
    details: h.details ? JSON.parse(h.details) : null
  }));

  const versionInfo = (ticket.original_version || ticket.new_version) ? db.prepare(`
    SELECT v.version_number, v.title, v.change_summary, v.created_at, u.display_name as creator_name
    FROM clause_versions v
    LEFT JOIN users u ON v.created_by = u.id
    WHERE v.clause_id = ?
    ORDER BY v.version_number DESC
  `).all(ticket.clause_id) : [];

  res.json({ ...ticket, history, version_history: versionInfo });
});

router.post('/:id/acknowledge', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) { res.status(404).json({ error: '工单不存在' }); return; }

  if (ticket.status === 'invalid') {
    res.status(400).json({ error: '工单已失效，无法签收' });
    return;
  }
  if (ticket.status === 'closed') {
    res.status(400).json({ error: '工单已关闭，无法签收' });
    return;
  }
  if (ticket.status === 'acknowledged' && ticket.acknowledged_at) {
    res.status(400).json({ error: '工单已签收' });
    return;
  }

  if (req.user!.role !== 'admin' && ticket.assignee_id !== req.user!.userId) {
    res.status(403).json({ error: '非责任人禁止代签收，仅责任人本人或管理员可以操作' });
    return;
  }

  const fromStatus = ticket.status;
  db.prepare(`
    UPDATE review_tickets
    SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  createTicketHistory(
    req.params.id, 'acknowledge', fromStatus, 'acknowledged',
    req.user!.userId, req.user!.role,
    { original_assignee: ticket.assignee_id, acknowledged_by: req.user!.userId }
  );

  createAuditLog('acknowledge_review_ticket', 'review_ticket', req.params.id, req.user!.userId, req.user!.role, {
    ticket_no: ticket.ticket_no,
    clause_id: ticket.clause_id,
    round_id: ticket.round_id
  });

  const updated = db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.id = ?
  `).get(req.params.id);

  res.json(updated);
});

router.post('/:id/conclude', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { conclusion, comment } = req.body;

  if (!conclusion || !['pass', 'need_more_info', 'recountersign'].includes(conclusion)) {
    res.status(400).json({ error: '结论必须是 pass/need_more_info/recountersign' });
    return;
  }

  const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) { res.status(404).json({ error: '工单不存在' }); return; }

  if (ticket.status === 'invalid') {
    res.status(400).json({ error: '工单已失效，无法处理' });
    return;
  }
  if (ticket.status === 'closed') {
    res.status(400).json({ error: '工单已关闭' });
    return;
  }
  if (ticket.status === 'pending' && !ticket.acknowledged_at) {
    res.status(400).json({ error: '请先签收再提交结论' });
    return;
  }

  if (req.user!.role !== 'admin' && ticket.assignee_id !== req.user!.userId) {
    res.status(403).json({ error: '非责任人禁止代提交结论，仅责任人本人可以操作' });
    return;
  }

  const fromStatus = ticket.status;

  try {
    db.exec('BEGIN TRANSACTION');

    db.prepare(`
      UPDATE review_tickets
      SET status = 'closed', conclusion = ?, conclusion_comment = ?,
          concluded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(conclusion, comment || '', req.params.id);

    createTicketHistory(
      req.params.id, 'conclude', fromStatus, 'closed',
      req.user!.userId, req.user!.role,
      {
        conclusion,
        comment: comment || '',
        clause_id: ticket.clause_id
      }
    );

    if (conclusion === 'recountersign') {
      const existing = db.prepare(`
        SELECT * FROM countersign_conclusions
        WHERE round_id = ? AND participant_id = ? AND clause_id = ?
      `).get(ticket.round_id, ticket.participant_id, ticket.clause_id) as any;

      const clause = db.prepare('SELECT current_version FROM clauses WHERE id = ?').get(ticket.clause_id) as any;

      if (existing) {
        const existingComment = existing.comment || '';
        const newComment = existingComment
          ? `${existingComment}\n\n[复查工单 ${ticket.ticket_no} 要求重新会签：${comment || '无备注'}]`
          : `[复查工单 ${ticket.ticket_no} 要求重新会签：${comment || '无备注'}]`;
        db.prepare(`
          UPDATE countersign_conclusions
          SET conclusion = NULL, concluded_at = NULL, comment = ?,
              original_version = ?, acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newComment, clause?.current_version || existing.original_version, existing.id);
      } else {
        db.prepare(`
          INSERT INTO countersign_conclusions
            (id, round_id, participant_id, user_id, clause_id, acknowledged_at, original_version, comment)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        `).run(
          uuidv4(), ticket.round_id, ticket.participant_id, ticket.assignee_id, ticket.clause_id,
          clause?.current_version || ticket.new_version || 1,
          `[复查工单 ${ticket.ticket_no} 要求重新会签：${comment || '无备注'}]`
        );
      }

      db.prepare(`
        UPDATE countersign_rounds SET status = 'active', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'completed'
      `).run(ticket.round_id);

      db.prepare(`
        UPDATE countersign_clauses
        SET needs_rereview = 1, rereview_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(`复查工单 ${ticket.ticket_no} 要求重新会签：${comment || '无备注'}`, ticket.countersign_clause_id);
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '处理失败', detail: msg });
    return;
  }

  createAuditLog('conclude_review_ticket', 'review_ticket', req.params.id, req.user!.userId, req.user!.role, {
    ticket_no: ticket.ticket_no,
    clause_id: ticket.clause_id,
    round_id: ticket.round_id,
    conclusion,
    comment: comment || ''
  });

  const updated = db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.id = ?
  `).get(req.params.id);

  res.json(updated);
});

router.post('/:id/reassign', requireRole('admin'), (req: Request, res: Response) => {
  const { new_user_id, reason } = req.body;
  if (!new_user_id) { res.status(400).json({ error: '新责任人不能为空' }); return; }
  if (!reason || !reason.trim()) { res.status(400).json({ error: '改派原因不能为空' }); return; }

  const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) { res.status(404).json({ error: '工单不存在' }); return; }
  if (ticket.status === 'invalid') { res.status(400).json({ error: '工单已失效，无法改派' }); return; }
  if (ticket.status === 'closed') { res.status(400).json({ error: '工单已关闭，无法改派' }); return; }

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(new_user_id) as any;
  if (!newUser) { res.status(400).json({ error: '新用户不存在' }); return; }

  const roundParticipant = db.prepare(`
    SELECT * FROM countersign_participants
    WHERE round_id = ? AND user_id = ? AND is_replaced = 0
  `).get(ticket.round_id, new_user_id) as any;

  if (!roundParticipant) {
    res.status(400).json({ error: '新责任人不是该会签的有效参与人' });
    return;
  }

  const oldAssigneeId = ticket.assignee_id;
  const oldParticipantId = ticket.participant_id;
  const fromStatus = ticket.status;

  db.prepare(`
    UPDATE review_tickets
    SET assignee_id = ?, participant_id = ?,
        acknowledged_at = CASE WHEN status = 'acknowledged' THEN NULL ELSE acknowledged_at END,
        status = CASE WHEN status = 'acknowledged' THEN 'pending' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(new_user_id, roundParticipant.id, req.params.id);

  const newStatus = fromStatus === 'acknowledged' ? 'pending' : fromStatus;

  createTicketHistory(
    req.params.id, 'reassign', fromStatus, newStatus,
    req.user!.userId, req.user!.role,
    {
      old_assignee_id: oldAssigneeId,
      old_participant_id: oldParticipantId,
      new_assignee_id: new_user_id,
      new_participant_id: roundParticipant.id,
      reason
    }
  );

  createAuditLog('reassign_review_ticket', 'review_ticket', req.params.id, req.user!.userId, req.user!.role, {
    ticket_no: ticket.ticket_no,
    old_assignee_id: oldAssigneeId,
    new_assignee_id: new_user_id,
    clause_id: ticket.clause_id,
    round_id: ticket.round_id,
    reason
  });

  const updated = db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.id = ?
  `).get(req.params.id);

  res.json(updated);
});

router.post('/:id/reopen', requireRole('admin'), (req: Request, res: Response) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) { res.status(400).json({ error: '重开原因不能为空' }); return; }

  const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) { res.status(404).json({ error: '工单不存在' }); return; }
  if (ticket.status === 'invalid') { res.status(400).json({ error: '工单已失效，无法重开，请创建新工单' }); return; }
  if (ticket.status !== 'closed') { res.status(400).json({ error: '只有已关闭的工单可以重开' }); return; }

  const fromStatus = ticket.status;

  db.prepare(`
    UPDATE review_tickets
    SET status = 'reopened',
        conclusion = NULL, conclusion_comment = NULL,
        concluded_at = NULL, acknowledged_at = NULL,
        reopened_count = reopened_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  createTicketHistory(
    req.params.id, 'reopen', fromStatus, 'reopened',
    req.user!.userId, req.user!.role,
    {
      reason,
      old_conclusion: ticket.conclusion,
      old_comment: ticket.conclusion_comment,
      reopened_count: ticket.reopened_count + 1
    }
  );

  createAuditLog('reopen_review_ticket', 'review_ticket', req.params.id, req.user!.userId, req.user!.role, {
    ticket_no: ticket.ticket_no,
    clause_id: ticket.clause_id,
    round_id: ticket.round_id,
    old_conclusion: ticket.conclusion,
    reason
  });

  const updated = db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.id = ?
  `).get(req.params.id);

  res.json(updated);
});

router.post('/:id/withdraw', requireRole('admin'), (req: Request, res: Response) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) { res.status(400).json({ error: '撤回原因不能为空' }); return; }

  const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(req.params.id) as any;
  if (!ticket) { res.status(404).json({ error: '工单不存在' }); return; }
  if (ticket.status === 'invalid') { res.status(400).json({ error: '工单已失效' }); return; }

  const fromStatus = ticket.status;

  db.prepare(`
    UPDATE review_tickets
    SET status = 'invalid', invalidated_reason = ?, invalidated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reason, req.params.id);

  createTicketHistory(
    req.params.id, 'withdraw', fromStatus, 'invalid',
    req.user!.userId, req.user!.role,
    { reason }
  );

  createAuditLog('withdraw_review_ticket', 'review_ticket', req.params.id, req.user!.userId, req.user!.role, {
    ticket_no: ticket.ticket_no,
    clause_id: ticket.clause_id,
    round_id: ticket.round_id,
    from_status: fromStatus,
    reason
  });

  const updated = db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.id = ?
  `).get(req.params.id);

  res.json(updated);
});

router.post('/manual-create', requireRole('admin'), (req: Request, res: Response) => {
  const { round_id, clause_id, assignee_user_ids, reason } = req.body;

  if (!round_id || !clause_id || !Array.isArray(assignee_user_ids) || assignee_user_ids.length === 0) {
    res.status(400).json({ error: '会签ID、条款ID和责任人均不能为空' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '工单原因不能为空' });
    return;
  }

  const round = db.prepare(`
    SELECT r.*, c.name as contract_name, c.id as contract_id
    FROM countersign_rounds r
    JOIN contracts c ON r.contract_id = c.id
    WHERE r.id = ?
  `).get(round_id) as any;
  if (!round) { res.status(404).json({ error: '会签不存在' }); return; }

  const cc = db.prepare(`
    SELECT * FROM countersign_clauses
    WHERE round_id = ? AND clause_id = ? AND invalidated = 0
  `).get(round_id, clause_id) as any;
  if (!cc) { res.status(400).json({ error: '该条款不在会签范围内或已失效' }); return; }

  const createdTicketIds: string[] = [];

  try {
    db.exec('BEGIN TRANSACTION');

    for (const userId of assignee_user_ids) {
      const participant = db.prepare(`
        SELECT * FROM countersign_participants
        WHERE round_id = ? AND user_id = ? AND is_replaced = 0
      `).get(round_id, userId) as any;

      if (!participant) continue;

      const existingPending = db.prepare(`
        SELECT * FROM review_tickets
        WHERE round_id = ? AND clause_id = ? AND participant_id = ?
          AND status IN ('pending', 'acknowledged', 'reopened')
      `).get(round_id, clause_id, participant.id) as any;

      if (existingPending) continue;

      const ticketId = uuidv4();
      const ticketNo = generateTicketNo();

      db.prepare(`
        INSERT INTO review_tickets (
          id, ticket_no, contract_id, round_id, countersign_clause_id, clause_id,
          participant_id, assignee_id, trigger_type, trigger_reason, triggered_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticketId, ticketNo, round.contract_id, round_id, cc.id, clause_id,
        participant.id, userId, 'admin_rereview',
        `管理员手动重启复查：${reason}`,
        req.user!.userId
      );

      createTicketHistory(
        ticketId, 'create', null, 'pending',
        req.user!.userId, req.user!.role,
        {
          ticket_no: ticketNo,
          trigger_type: 'admin_rereview',
          trigger_reason: reason,
          clause_id: clause_id,
          round_id: round_id,
          assignee_id: userId,
          source: 'manual_admin_create'
        }
      );

      createdTicketIds.push(ticketId);

      createAuditLog('create_review_ticket', 'review_ticket', ticketId, req.user!.userId, req.user!.role, {
        ticket_no: ticketNo,
        clause_id: clause_id,
        round_id: round_id,
        assignee_id: userId,
        trigger_type: 'admin_rereview',
        source: 'manual'
      });
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '创建失败', detail: msg });
    return;
  }

  const tickets = createdTicketIds.length > 0 ? db.prepare(`
    SELECT t.*, u.display_name as assignee_name
    FROM review_tickets t LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.id IN (${createdTicketIds.map(() => '?').join(',')})
  `).all(...createdTicketIds) : [];

  res.status(201).json({
    created_count: createdTicketIds.length,
    tickets
  });
});

export default router;
