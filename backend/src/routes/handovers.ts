import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';

const router = Router();
router.use(authMiddleware);

function generateHandoverNo(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `HO-${yyyy}${mm}${dd}-${rand}`;
}

function createHandoverHistory(
  handoverId: string,
  action: string,
  userId: string | null,
  userRole: string | null,
  details: Record<string, unknown> = {}
) {
  db.prepare(`
    INSERT INTO handover_history (id, handover_id, action, user_id, user_role, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), handoverId, action, userId, userRole, JSON.stringify(details));
}

function gatherHandoverItems(fromUserId: string, scope: string, customItems?: Array<{ item_type: string; item_id: string }>) {
  const items: Array<{ item_type: string; item_id: string; snapshot: string; status_at_handover: string; version_at_handover: number | null }> = [];

  if (scope === 'all' || scope === 'drafts' || scope === 'custom') {
    const drafts = db.prepare(`
      SELECT d.*, c.clause_number, c.title, c.current_version
      FROM suggestion_drafts d
      LEFT JOIN clauses c ON d.clause_id = c.id
      WHERE d.user_id = ?
    `).all(fromUserId) as any[];
    for (const d of drafts) {
      if (scope === 'custom' && customItems && !customItems.some(ci => ci.item_type === 'draft' && ci.item_id === d.id)) continue;
      items.push({
        item_type: 'draft',
        item_id: d.id,
        snapshot: JSON.stringify({
          clause_id: d.clause_id,
          clause_number: d.clause_number,
          title: d.title,
          type: d.type,
          base_version: d.base_version,
          current_version: d.current_version
        }),
        status_at_handover: 'active',
        version_at_handover: d.base_version
      });
    }
  }

  if (scope === 'all' || scope === 'countersigns' || scope === 'custom') {
    const myRounds = db.prepare(`
      SELECT DISTINCT r.id as round_id, r.round_name, r.status as round_status, r.contract_id,
        c.name as contract_name
      FROM countersign_participants p
      JOIN countersign_rounds r ON p.round_id = r.id
      LEFT JOIN contracts c ON r.contract_id = c.id
      WHERE p.user_id = ? AND p.is_replaced = 0 AND r.status = 'active'
    `).all(fromUserId) as any[];
    for (const r of myRounds) {
      if (scope === 'custom' && customItems && !customItems.some(ci => ci.item_type === 'countersign' && ci.item_id === r.round_id)) continue;
      items.push({
        item_type: 'countersign',
        item_id: r.round_id,
        snapshot: JSON.stringify({
          round_id: r.round_id,
          round_name: r.round_name,
          round_status: r.round_status,
          contract_id: r.contract_id,
          contract_name: r.contract_name
        }),
        status_at_handover: r.round_status,
        version_at_handover: null
      });
    }
  }

  if (scope === 'all' || scope === 'tickets' || scope === 'custom') {
    const tickets = db.prepare(`
      SELECT t.*, c.clause_number, c.title as clause_title, c.current_version,
        cr.round_name, ct.name as contract_name
      FROM review_tickets t
      LEFT JOIN clauses c ON t.clause_id = c.id
      LEFT JOIN countersign_rounds cr ON t.round_id = cr.id
      LEFT JOIN contracts ct ON t.contract_id = ct.id
      WHERE t.assignee_id = ? AND t.status IN ('pending', 'acknowledged', 'reopened')
    `).all(fromUserId) as any[];
    for (const t of tickets) {
      if (scope === 'custom' && customItems && !customItems.some(ci => ci.item_type === 'ticket' && ci.item_id === t.id)) continue;
      items.push({
        item_type: 'ticket',
        item_id: t.id,
        snapshot: JSON.stringify({
          ticket_no: t.ticket_no,
          clause_number: t.clause_number,
          clause_title: t.clause_title,
          round_name: t.round_name,
          contract_name: t.contract_name,
          trigger_type: t.trigger_type,
          trigger_reason: t.trigger_reason
        }),
        status_at_handover: t.status,
        version_at_handover: t.new_version || t.original_version || null
      });
    }
  }

  if (scope === 'all' || scope === 'custom') {
    const suggestions = db.prepare(`
      SELECT s.*, c.clause_number, c.title, c.current_version
      FROM suggestions s
      LEFT JOIN clauses c ON s.clause_id = c.id
      WHERE s.created_by = ? AND s.status = 'pending'
    `).all(fromUserId) as any[];
    for (const s of suggestions) {
      if (scope === 'custom' && customItems && !customItems.some(ci => ci.item_type === 'suggestion' && ci.item_id === s.id)) continue;
      items.push({
        item_type: 'suggestion',
        item_id: s.id,
        snapshot: JSON.stringify({
          clause_id: s.clause_id,
          clause_number: s.clause_number,
          title: s.title,
          type: s.type,
          base_version: s.base_version,
          current_version: s.current_version
        }),
        status_at_handover: 'pending',
        version_at_handover: s.base_version
      });
    }
  }

  return items;
}

router.post('/preview', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { to_user_id, scope, custom_items } = req.body;

  if (!to_user_id) {
    res.status(400).json({ error: '接收人不能为空' });
    return;
  }
  if (!scope || !['all', 'drafts', 'countersigns', 'tickets', 'custom'].includes(scope)) {
    res.status(400).json({ error: '交接范围无效' });
    return;
  }
  if (to_user_id === req.user!.userId) {
    res.status(400).json({ error: '不能交接给自己' });
    return;
  }

  const toUser = db.prepare('SELECT * FROM users WHERE id = ?').get(to_user_id) as any;
  if (!toUser) {
    res.status(404).json({ error: '接收人不存在' });
    return;
  }

  const items = gatherHandoverItems(req.user!.userId, scope, custom_items);

  const draftsCount = items.filter(i => i.item_type === 'draft').length;
  const countersignsCount = items.filter(i => i.item_type === 'countersign').length;
  const ticketsCount = items.filter(i => i.item_type === 'ticket').length;
  const suggestionsCount = items.filter(i => i.item_type === 'suggestion').length;

  res.json({
    from_user_id: req.user!.userId,
    from_user_name: req.user!.username,
    to_user_id,
    to_user_name: toUser.display_name,
    to_user_role: toUser.role,
    scope,
    summary: {
      total: items.length,
      drafts: draftsCount,
      countersigns: countersignsCount,
      tickets: ticketsCount,
      suggestions: suggestionsCount
    },
    items: items.map(i => ({
      ...i,
      snapshot: JSON.parse(i.snapshot)
    }))
  });
});

router.post('/', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { to_user_id, scope, reason, custom_items } = req.body;

  if (!to_user_id) {
    res.status(400).json({ error: '接收人不能为空' });
    return;
  }
  if (!scope || !['all', 'drafts', 'countersigns', 'tickets', 'custom'].includes(scope)) {
    res.status(400).json({ error: '交接范围无效' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '交接原因不能为空' });
    return;
  }
  if (to_user_id === req.user!.userId) {
    res.status(400).json({ error: '不能交接给自己' });
    return;
  }

  const toUser = db.prepare('SELECT * FROM users WHERE id = ?').get(to_user_id) as any;
  if (!toUser) {
    res.status(404).json({ error: '接收人不存在' });
    return;
  }

  const items = gatherHandoverItems(req.user!.userId, scope, custom_items);
  if (items.length === 0) {
    res.status(400).json({ error: '没有可交接的项目' });
    return;
  }

  const handoverId = uuidv4();
  const handoverNo = generateHandoverNo();

  try {
    db.exec('BEGIN TRANSACTION');

    db.prepare(`
      INSERT INTO handovers (id, handover_no, from_user_id, to_user_id, scope, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(handoverId, handoverNo, req.user!.userId, to_user_id, scope, reason.trim());

    const insertItem = db.prepare(`
      INSERT INTO handover_items (id, handover_id, item_type, item_id, snapshot, status_at_handover, version_at_handover)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(uuidv4(), handoverId, item.item_type, item.item_id, item.snapshot, item.status_at_handover, item.version_at_handover);
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '创建交接单失败', detail: msg });
    return;
  }

  createHandoverHistory(handoverId, 'create', req.user!.userId, req.user!.role, {
    handover_no: handoverNo,
    to_user_id,
    scope,
    item_count: items.length,
    reason: reason.trim()
  });

  createAuditLog('create_handover', 'handover', handoverId, req.user!.userId, req.user!.role, {
    handover_no: handoverNo,
    to_user_id,
    scope,
    item_count: items.length,
    reason: reason.trim()
  });

  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(handoverId) as any;
  const fromU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(handover.from_user_id) as any;
  const toU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(handover.to_user_id) as any;

  const handoverItems = db.prepare('SELECT * FROM handover_items WHERE handover_id = ?').all(handoverId);

  const handoverResult = {
    ...handover,
    from_user_name: fromU?.display_name || null,
    to_user_name: toU?.display_name || null
  };

  res.status(201).json({
    ...handoverResult,
    handover: handoverResult,
    items: handoverItems.map((i: any) => ({
      ...i,
      snapshot: i.snapshot ? JSON.parse(i.snapshot) : null
    }))
  });
});

router.get('/', (req: Request, res: Response) => {
  const { status, from_user_id, to_user_id, limit = '200', offset = '0' } = req.query;

  let sql = `
    SELECT h.*, (SELECT COUNT(*) FROM handover_items hi WHERE hi.handover_id = h.id) as item_count
    FROM handovers h
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && ['pending', 'signed', 'withdrawn', 'conflict'].includes(status as string)) {
    sql += ' AND h.status = ?';
    params.push(status);
  }
  if (req.user!.role !== 'admin') {
    sql += ' AND (h.from_user_id = ? OR h.to_user_id = ?)';
    params.push(req.user!.userId, req.user!.userId);
  }
  if (from_user_id) {
    sql += ' AND h.from_user_id = ?';
    params.push(from_user_id);
  }
  if (to_user_id) {
    sql += ' AND h.to_user_id = ?';
    params.push(to_user_id);
  }

  sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const handovers = db.prepare(sql).all(...params) as any[];

  const userIds = new Set<string>();
  for (const h of handovers) {
    if (h.from_user_id) userIds.add(h.from_user_id);
    if (h.to_user_id) userIds.add(h.to_user_id);
  }
  const userMap: Record<string, string> = {};
  if (userIds.size > 0) {
    const ids = Array.from(userIds);
    const users = db.prepare(`
      SELECT id, display_name FROM users WHERE id IN (${ids.map(() => '?').join(',')})
    `).all(...ids) as any[];
    for (const u of users) {
      userMap[u.id] = u.display_name;
    }
  }

  const result = handovers.map((h: any) => ({
    ...h,
    from_user_name: userMap[h.from_user_id] || null,
    to_user_name: userMap[h.to_user_id] || null
  }));

  res.json(result);
});

router.get('/:id', (req: Request, res: Response) => {
  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;

  if (!handover) {
    res.status(404).json({ error: '交接单不存在' });
    return;
  }

  if (req.user!.role !== 'admin' && handover.from_user_id !== req.user!.userId && handover.to_user_id !== req.user!.userId) {
    res.status(403).json({ error: '您无权查看此交接单' });
    return;
  }

  const fromUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(handover.from_user_id) as any;
  const toUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(handover.to_user_id) as any;

  const items = db.prepare('SELECT * FROM handover_items WHERE handover_id = ?').all(req.params.id)
    .map((i: any) => ({
      ...i,
      snapshot: i.snapshot ? JSON.parse(i.snapshot) : null
    }));

  const history = db.prepare(`
    SELECT hh.*, u.display_name as user_name
    FROM handover_history hh
    LEFT JOIN users u ON hh.user_id = u.id
    WHERE hh.handover_id = ?
    ORDER BY hh.created_at ASC
  `).all(req.params.id).map((h: any) => ({
    ...h,
    details: h.details ? JSON.parse(h.details) : null
  }));

  res.json({ ...handover, from_user_name: fromUser?.display_name || null, to_user_name: toUser?.display_name || null, items, history });
});

router.post('/:id/sign', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { note } = req.body;
  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  if (!handover) {
    res.status(404).json({ error: '交接单不存在' });
    return;
  }

  if (handover.to_user_id !== req.user!.userId) {
    res.status(403).json({ error: '只有接收人可以签收交接单' });
    return;
  }
  if (handover.status !== 'pending') {
    res.status(400).json({ error: `交接单状态为${handover.status}，无法签收` });
    return;
  }

  const conflicts = checkConflicts(req.params.id);
  if (conflicts.length > 0) {
    db.prepare(`
      UPDATE handovers SET status = 'conflict', conflict_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(conflicts), req.params.id);

    createHandoverHistory(req.params.id, 'conflict_detected', req.user!.userId, req.user!.role, {
      conflict_count: conflicts.length,
      conflicts
    });

    createAuditLog('handover_conflict', 'handover', req.params.id, req.user!.userId, req.user!.role, {
      conflict_count: conflicts.length
    });

    res.status(409).json({
      error: '交接期间项目状态发生变化，存在冲突，请重新确认',
      conflicts,
      handover_id: req.params.id
    });
    return;
  }

  try {
    db.exec('BEGIN TRANSACTION');

    const items = db.prepare('SELECT * FROM handover_items WHERE handover_id = ?').all(req.params.id) as any[];

    for (const item of items) {
      if (item.item_type === 'draft') {
        const draft = db.prepare('SELECT * FROM suggestion_drafts WHERE id = ?').get(item.item_id) as any;
        if (draft && draft.user_id === handover.from_user_id) {
          const existingDraft = db.prepare(
            'SELECT id FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
          ).get(draft.clause_id, handover.to_user_id) as any;
          if (existingDraft) {
            db.prepare(`
              UPDATE suggestion_drafts SET type = ?, content = ?, base_version = ?,
                amended_title = ?, amended_content = ?, risk_level = ?, exclusive_role = ?,
                context_snapshot = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              draft.type, draft.content, draft.base_version,
              draft.amended_title, draft.amended_content, draft.risk_level,
              draft.exclusive_role, draft.context_snapshot, existingDraft.id
            );
            db.prepare('DELETE FROM suggestion_drafts WHERE id = ?').run(draft.id);
          } else {
            db.prepare(`
              UPDATE suggestion_drafts SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(handover.to_user_id, draft.id);
          }
        }
      }

      if (item.item_type === 'countersign') {
        const participant = db.prepare(`
          SELECT * FROM countersign_participants
          WHERE round_id = ? AND user_id = ? AND is_replaced = 0
        `).get(item.item_id, handover.from_user_id) as any;
        if (participant) {
          const existingP = db.prepare(`
            SELECT * FROM countersign_participants
            WHERE round_id = ? AND user_id = ? AND is_replaced = 0
          `).get(item.item_id, handover.to_user_id) as any;
          if (!existingP) {
            db.prepare(`
              INSERT INTO countersign_participants (id, round_id, user_id, original_participant_id)
              VALUES (?, ?, ?, ?)
            `).run(uuidv4(), item.item_id, handover.to_user_id, participant.id);

            db.prepare(`
              UPDATE countersign_participants SET is_replaced = 1, replaced_by = ?, replaced_at = CURRENT_TIMESTAMP, replaced_reason = ?
              WHERE id = ?
            `).run(handover.to_user_id, `评审交接单 ${handover.handover_no} 替换`, participant.id);

            const conclusions = db.prepare(`
              SELECT * FROM countersign_conclusions WHERE participant_id = ? AND round_id = ?
            `).all(participant.id, item.item_id) as any[];
            const newP = db.prepare(`
              SELECT * FROM countersign_participants
              WHERE round_id = ? AND user_id = ? AND is_replaced = 0 AND id != ?
            `).get(item.item_id, handover.to_user_id, participant.id) as any;
            if (newP) {
              for (const conc of conclusions) {
                if (conc.concluded_at) continue;
                db.prepare(`
                  INSERT INTO countersign_conclusions (id, round_id, participant_id, user_id, clause_id, acknowledged_at, original_version)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                `).run(uuidv4(), item.item_id, newP.id, handover.to_user_id, conc.clause_id, conc.original_version);
              }
            }
          }
        }
      }

      if (item.item_type === 'ticket') {
        const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(item.item_id) as any;
        if (ticket && ticket.assignee_id === handover.from_user_id && ['pending', 'acknowledged', 'reopened'].includes(ticket.status)) {
          const newParticipant = db.prepare(`
            SELECT * FROM countersign_participants
            WHERE round_id = ? AND user_id = ? AND is_replaced = 0
          `).get(ticket.round_id, handover.to_user_id) as any;

          if (newParticipant) {
            const fromStatus = ticket.status;
            db.prepare(`
              UPDATE review_tickets SET assignee_id = ?, participant_id = ?,
                acknowledged_at = CASE WHEN status = 'acknowledged' THEN NULL ELSE acknowledged_at END,
                status = CASE WHEN status = 'acknowledged' THEN 'pending' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(handover.to_user_id, newParticipant.id, item.item_id);

            db.prepare(`
              INSERT INTO review_ticket_history (id, ticket_id, action, from_status, to_status, user_id, user_role, details)
              VALUES (?, ?, 'reassign', ?, ?, ?, ?, ?)
            `).run(
              uuidv4(), item.item_id, fromStatus,
              fromStatus === 'acknowledged' ? 'pending' : fromStatus,
              handover.to_user_id, 'admin',
              JSON.stringify({
                reason: `评审交接单 ${handover.handover_no} 自动改派`,
                handover_id: req.params.id,
                old_assignee_id: handover.from_user_id,
                new_assignee_id: handover.to_user_id
              })
            );
          }
        }
      }

      if (item.item_type === 'suggestion') {
        // suggestions remain from original creator; just mark as transferred
      }

      db.prepare('UPDATE handover_items SET transferred = 1 WHERE id = ?').run(item.id);
    }

    db.prepare(`
      UPDATE handovers SET status = 'signed', signed_at = CURRENT_TIMESTAMP, sign_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note || '', req.params.id);

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '签收失败', detail: msg });
    return;
  }

  createHandoverHistory(req.params.id, 'sign', req.user!.userId, req.user!.role, {
    note: note || ''
  });

  createAuditLog('sign_handover', 'handover', req.params.id, req.user!.userId, req.user!.role, {
    handover_no: handover.handover_no,
    from_user_id: handover.from_user_id,
    note: note || ''
  });

  const updated = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  const fromU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.from_user_id) as any;
  const toU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.to_user_id) as any;

  res.json({ ...updated, from_user_name: fromU?.display_name || null, to_user_name: toU?.display_name || null });
});

router.post('/:id/withdraw', requireRole('admin'), (req: Request, res: Response) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '撤回原因不能为空' });
    return;
  }

  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  if (!handover) {
    res.status(404).json({ error: '交接单不存在' });
    return;
  }
  if (handover.status === 'signed') {
    res.status(400).json({ error: '已签收的交接单不能撤回' });
    return;
  }
  if (handover.status === 'withdrawn') {
    res.status(400).json({ error: '交接单已撤回' });
    return;
  }

  db.prepare(`
    UPDATE handovers SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP,
      withdraw_reason = ?, withdrawn_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reason.trim(), req.user!.userId, req.params.id);

  createHandoverHistory(req.params.id, 'withdraw', req.user!.userId, req.user!.role, {
    reason: reason.trim()
  });

  createAuditLog('withdraw_handover', 'handover', req.params.id, req.user!.userId, req.user!.role, {
    handover_no: handover.handover_no,
    reason: reason.trim()
  });

  const updated = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  const fromU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.from_user_id) as any;
  const toU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.to_user_id) as any;

  res.json({ ...updated, from_user_name: fromU?.display_name || null, to_user_name: toU?.display_name || null });
});

function checkConflicts(handoverId: string): Array<{ item_type: string; item_id: string; field: string; old_value: any; new_value: any; description: string }> {
  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(handoverId) as any;
  if (!handover) return [];

  const items = db.prepare('SELECT * FROM handover_items WHERE handover_id = ?').all(handoverId) as any[];
  const conflicts: Array<{ item_type: string; item_id: string; field: string; old_value: any; new_value: any; description: string }> = [];

  for (const item of items) {
    if (item.item_type === 'draft') {
      const draft = db.prepare('SELECT * FROM suggestion_drafts WHERE id = ?').get(item.item_id) as any;
      if (!draft) {
        conflicts.push({
          item_type: 'draft', item_id: item.item_id, field: 'existence',
          old_value: 'exists', new_value: 'deleted',
          description: '草稿已被删除'
        });
        continue;
      }
      if (draft.user_id !== handover.from_user_id) {
        conflicts.push({
          item_type: 'draft', item_id: item.item_id, field: 'user_id',
          old_value: handover.from_user_id, new_value: draft.user_id,
          description: '草稿已不属于原负责人'
        });
      }
      const clause = db.prepare('SELECT current_version FROM clauses WHERE id = ?').get(draft.clause_id) as any;
      if (clause && draft.base_version < clause.current_version && item.version_at_handover === draft.base_version) {
        conflicts.push({
          item_type: 'draft', item_id: item.item_id, field: 'version',
          old_value: item.version_at_handover, new_value: clause.current_version,
          description: `条款版本已从 v${item.version_at_handover} 变更到 v${clause.current_version}`
        });
      }
    }

    if (item.item_type === 'countersign') {
      const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(item.item_id) as any;
      if (!round) {
        conflicts.push({
          item_type: 'countersign', item_id: item.item_id, field: 'existence',
          old_value: 'exists', new_value: 'deleted',
          description: '会签已被删除'
        });
        continue;
      }
      if (round.status !== item.status_at_handover) {
        conflicts.push({
          item_type: 'countersign', item_id: item.item_id, field: 'status',
          old_value: item.status_at_handover, new_value: round.status,
          description: `会签状态已从 ${item.status_at_handover} 变为 ${round.status}`
        });
      }
    }

    if (item.item_type === 'ticket') {
      const ticket = db.prepare('SELECT * FROM review_tickets WHERE id = ?').get(item.item_id) as any;
      if (!ticket) {
        conflicts.push({
          item_type: 'ticket', item_id: item.item_id, field: 'existence',
          old_value: 'exists', new_value: 'deleted',
          description: '工单已被删除'
        });
        continue;
      }
      if (ticket.status !== item.status_at_handover) {
        conflicts.push({
          item_type: 'ticket', item_id: item.item_id, field: 'status',
          old_value: item.status_at_handover, new_value: ticket.status,
          description: `工单状态已从 ${item.status_at_handover} 变为 ${ticket.status}`
        });
      }
      if (ticket.assignee_id !== handover.from_user_id) {
        conflicts.push({
          item_type: 'ticket', item_id: item.item_id, field: 'assignee_id',
          old_value: handover.from_user_id, new_value: ticket.assignee_id,
          description: '工单已不属于原负责人'
        });
      }
    }

    if (item.item_type === 'suggestion') {
      const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(item.item_id) as any;
      if (!suggestion) {
        conflicts.push({
          item_type: 'suggestion', item_id: item.item_id, field: 'existence',
          old_value: 'exists', new_value: 'deleted',
          description: '建议已被删除'
        });
        continue;
      }
      if (suggestion.status !== item.status_at_handover) {
        conflicts.push({
          item_type: 'suggestion', item_id: item.item_id, field: 'status',
          old_value: item.status_at_handover, new_value: suggestion.status,
          description: `建议状态已从 ${item.status_at_handover} 变为 ${suggestion.status}`
        });
      }
    }
  }

  return conflicts;
}

router.get('/:id/conflicts', (req: Request, res: Response) => {
  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  if (!handover) {
    res.status(404).json({ error: '交接单不存在' });
    return;
  }

  if (req.user!.role !== 'admin' && handover.from_user_id !== req.user!.userId && handover.to_user_id !== req.user!.userId) {
    res.status(403).json({ error: '您无权查看此交接单冲突' });
    return;
  }

  const conflicts = checkConflicts(req.params.id);
  res.json({ handover_id: req.params.id, conflict_count: conflicts.length, conflicts });
});

router.post('/:id/reconfirm', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const handover = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  if (!handover) {
    res.status(404).json({ error: '交接单不存在' });
    return;
  }

  if (handover.to_user_id !== req.user!.userId) {
    res.status(403).json({ error: '只有接收人可以重新确认' });
    return;
  }
  if (handover.status !== 'conflict') {
    res.status(400).json({ error: '交接单状态不是冲突状态，无需重新确认' });
    return;
  }

  const { remove_conflict_items, force } = req.body;

  try {
    db.exec('BEGIN TRANSACTION');

    if (remove_conflict_items && Array.isArray(remove_conflict_items)) {
      for (const ci of remove_conflict_items) {
        db.prepare('DELETE FROM handover_items WHERE handover_id = ? AND item_type = ? AND item_id = ?')
          .run(req.params.id, ci.item_type, ci.item_id);
      }
    }

    const remainingItems = db.prepare('SELECT COUNT(*) as c FROM handover_items WHERE handover_id = ?').get(req.params.id) as any;
    if (remainingItems.c === 0) {
      db.prepare(`
        UPDATE handovers SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP,
          withdraw_reason = '所有项目因冲突被移除', withdrawn_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.user!.userId, req.params.id);
      db.exec('COMMIT');
      res.json({ status: 'withdrawn', reason: 'all_items_removed' });
      return;
    }

    const newConflicts = checkConflicts(req.params.id);
    if (newConflicts.length > 0 && !force) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: '仍有冲突未解决',
        conflicts: newConflicts
      });
      return;
    }

    const newItems = gatherHandoverItems(
      handover.from_user_id,
      handover.scope,
      db.prepare('SELECT item_type, item_id FROM handover_items WHERE handover_id = ?').all(req.params.id)
        .map((i: any) => ({ item_type: i.item_type, item_id: i.item_id }))
    );

    db.prepare('DELETE FROM handover_items WHERE handover_id = ?').run(req.params.id);
    const insertItem = db.prepare(`
      INSERT INTO handover_items (id, handover_id, item_type, item_id, snapshot, status_at_handover, version_at_handover)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of newItems) {
      insertItem.run(uuidv4(), req.params.id, item.item_type, item.item_id, item.snapshot, item.status_at_handover, item.version_at_handover);
    }

    db.prepare(`
      UPDATE handovers SET status = 'pending', conflict_detail = NULL, conflict_resolved = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '重新确认失败', detail: msg });
    return;
  }

  createHandoverHistory(req.params.id, 'reconfirm', req.user!.userId, req.user!.role, {
    remove_conflict_items: remove_conflict_items || [],
    force: !!force
  });

  createAuditLog('reconfirm_handover', 'handover', req.params.id, req.user!.userId, req.user!.role, {
    handover_no: handover.handover_no
  });

  const updated = db.prepare('SELECT * FROM handovers WHERE id = ?').get(req.params.id) as any;
  const fromU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.from_user_id) as any;
  const toU = db.prepare('SELECT display_name FROM users WHERE id = ?').get(updated.to_user_id) as any;

  res.json({ ...updated, from_user_name: fromU?.display_name || null, to_user_name: toU?.display_name || null });
});

export default router;
