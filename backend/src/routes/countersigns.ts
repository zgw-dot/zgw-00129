import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';

const router = Router();

router.use(authMiddleware);

function createCountersignHistory(
  roundId: string,
  action: string,
  userId: string | null,
  userRole: string | null,
  details: Record<string, unknown> = {}
) {
  const stmt = db.prepare(`
    INSERT INTO countersign_history (id, round_id, action, user_id, user_role, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    uuidv4(),
    roundId,
    action,
    userId,
    userRole,
    JSON.stringify(details)
  );
}

function checkRoundComplete(roundId: string): boolean {
  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(roundId) as any;
  if (!round || round.status !== 'active') return false;

  const participants = db.prepare(`
    SELECT * FROM countersign_participants WHERE round_id = ? AND is_replaced = 0
  `).all(roundId) as any[];

  const clauses = db.prepare(`
    SELECT * FROM countersign_clauses WHERE round_id = ? AND invalidated = 0
  `).all(roundId) as any[];

  if (participants.length === 0 || clauses.length === 0) return false;

  for (const p of participants) {
    for (const c of clauses) {
      const conclusion = db.prepare(`
        SELECT * FROM countersign_conclusions
        WHERE round_id = ? AND participant_id = ? AND clause_id = ?
      `).get(roundId, p.id, c.clause_id) as any;
      if (!conclusion || !conclusion.concluded_at) {
        return false;
      }
    }
  }

  return true;
}

function tryCompleteRound(roundId: string) {
  if (checkRoundComplete(roundId)) {
    db.prepare(`
      UPDATE countersign_rounds SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active'
    `).run(roundId);
    createCountersignHistory(roundId, 'conclude', null, null, { auto_completed: true });
    return true;
  }
  return false;
}

router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  const { contract_id, round_name, description, deadline, participant_ids, clause_ids } = req.body;

  if (!contract_id || !round_name) {
    res.status(400).json({ error: '合同ID和会签名称不能为空' });
    return;
  }
  if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
    res.status(400).json({ error: '必须指定至少一个参与人' });
    return;
  }
  if (!Array.isArray(clause_ids) || clause_ids.length === 0) {
    res.status(400).json({ error: '必须指定至少一条必看条款' });
    return;
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id) as any;
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }

  const validParticipants = db.prepare(`
    SELECT id, username, display_name, role FROM users WHERE id IN (${participant_ids.map(() => '?').join(',')})
  `).all(...participant_ids) as any[];
  if (validParticipants.length !== participant_ids.length) {
    res.status(400).json({ error: '部分参与人不存在' });
    return;
  }

  const clauseRows = db.prepare(`
    SELECT id, clause_number, title, current_version FROM clauses WHERE id IN (${clause_ids.map(() => '?').join(',')}) AND contract_id = ?
  `).all(...clause_ids, contract_id) as any[];
  if (clauseRows.length !== clause_ids.length) {
    res.status(400).json({ error: '部分条款不存在或不属于此合同' });
    return;
  }

  const roundId = uuidv4();
  const deadlineVal = deadline || null;

  try {
    db.exec('BEGIN TRANSACTION');

    db.prepare(`
      INSERT INTO countersign_rounds (id, contract_id, round_name, description, deadline, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(roundId, contract_id, round_name, description || '', deadlineVal, req.user!.userId);

    const insertParticipant = db.prepare(`
      INSERT INTO countersign_participants (id, round_id, user_id)
      VALUES (?, ?, ?)
    `);
    const participantMap = new Map<string, string>();
    for (const pid of participant_ids) {
      const cpId = uuidv4();
      insertParticipant.run(cpId, roundId, pid);
      participantMap.set(pid, cpId);
    }

    const insertClause = db.prepare(`
      INSERT INTO countersign_clauses (id, round_id, clause_id, clause_version_at_create)
      VALUES (?, ?, ?, ?)
    `);
    for (const clause of clauseRows) {
      insertClause.run(uuidv4(), roundId, clause.id, clause.current_version);
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '创建会签失败', detail: msg });
    return;
  }

  createCountersignHistory(roundId, 'create_round', req.user!.userId, req.user!.role, {
    round_name,
    participant_count: participant_ids.length,
    clause_count: clause_ids.length,
    deadline: deadlineVal
  });
  createAuditLog('create_countersign', 'countersign_round', roundId, req.user!.userId, req.user!.role, {
    contract_id,
    round_name,
    participant_ids,
    clause_ids
  });

  const round = db.prepare(`
    SELECT r.*, u.display_name as creator_name
    FROM countersign_rounds r LEFT JOIN users u ON r.created_by = u.id
    WHERE r.id = ?
  `).get(roundId);

  const participantCount = db.prepare('SELECT COUNT(*) as c FROM countersign_participants WHERE round_id = ? AND is_replaced = 0').get(roundId).c;
  const clauseCount = db.prepare('SELECT COUNT(*) as c FROM countersign_clauses WHERE round_id = ?').get(roundId).c;

  res.status(201).json({
    round,
    participant_count: participantCount,
    clause_count: clauseCount
  });
});

router.get('/contract/:contractId', (req: Request, res: Response) => {
  const isAdmin = req.user!.role === 'admin';
  let rows: any[];
  if (isAdmin) {
    rows = db.prepare(`
      SELECT r.*, u.display_name as creator_name,
        (SELECT COUNT(*) FROM countersign_participants p WHERE p.round_id = r.id AND p.is_replaced = 0) as participant_count,
        (SELECT COUNT(*) FROM countersign_clauses c WHERE c.round_id = r.id) as clause_count,
        (SELECT COUNT(*) FROM countersign_conclusions co
          JOIN countersign_participants p ON co.participant_id = p.id
          WHERE co.round_id = r.id AND p.is_replaced = 0 AND co.concluded_at IS NOT NULL) as concluded_count,
        (SELECT COUNT(*) FROM countersign_conclusions co
          JOIN countersign_participants p ON co.participant_id = p.id
          WHERE co.round_id = r.id AND p.is_replaced = 0 AND co.acknowledged_at IS NOT NULL AND co.concluded_at IS NULL) as acknowledged_count
      FROM countersign_rounds r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.contract_id = ?
      ORDER BY r.created_at DESC
    `).all(req.params.contractId);
  } else {
    rows = db.prepare(`
      SELECT r.*, u.display_name as creator_name,
        (SELECT COUNT(*) FROM countersign_participants p WHERE p.round_id = r.id AND p.is_replaced = 0) as participant_count,
        (SELECT COUNT(*) FROM countersign_clauses c WHERE c.round_id = r.id) as clause_count,
        (SELECT COUNT(*) FROM countersign_conclusions co
          JOIN countersign_participants p ON co.participant_id = p.id
          WHERE co.round_id = r.id AND p.is_replaced = 0 AND co.concluded_at IS NOT NULL) as concluded_count,
        (SELECT COUNT(*) FROM countersign_conclusions co
          JOIN countersign_participants p ON co.participant_id = p.id
          WHERE co.round_id = r.id AND p.is_replaced = 0 AND co.acknowledged_at IS NOT NULL AND co.concluded_at IS NULL) as acknowledged_count
      FROM countersign_rounds r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.contract_id = ?
        AND EXISTS (SELECT 1 FROM countersign_participants p WHERE p.round_id = r.id AND p.user_id = ? AND p.is_replaced = 0)
      ORDER BY r.created_at DESC
    `).all(req.params.contractId, req.user!.userId);
  }
  res.json(rows);
});

router.get('/mine', (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT r.*, c.name as contract_name, u.display_name as creator_name,
      (SELECT COUNT(*) FROM countersign_participants p WHERE p.round_id = r.id AND p.is_replaced = 0) as participant_count,
      (SELECT COUNT(*) FROM countersign_clauses cl WHERE cl.round_id = r.id) as clause_count,
      (SELECT COUNT(*) FROM countersign_conclusions co
        JOIN countersign_participants p ON co.participant_id = p.id
        WHERE co.round_id = r.id AND p.user_id = ? AND co.concluded_at IS NOT NULL) as my_concluded,
      (SELECT COUNT(*) FROM countersign_conclusions co
        JOIN countersign_participants p ON co.participant_id = p.id
        WHERE co.round_id = r.id AND p.user_id = ? AND co.acknowledged_at IS NOT NULL AND co.concluded_at IS NULL) as my_acknowledged
    FROM countersign_rounds r
    JOIN contracts c ON r.contract_id = c.id
    LEFT JOIN users u ON r.created_by = u.id
    WHERE r.status = 'active'
      AND EXISTS (SELECT 1 FROM countersign_participants p WHERE p.round_id = r.id AND p.user_id = ? AND p.is_replaced = 0)
    ORDER BY r.created_at DESC
  `).all(req.user!.userId, req.user!.userId, req.user!.userId);
  res.json(rows);
});

router.get('/:id', (req: Request, res: Response) => {
  const round = db.prepare(`
    SELECT r.*, c.name as contract_name, u.display_name as creator_name,
      uw.display_name as withdrawer_name
    FROM countersign_rounds r
    JOIN contracts c ON r.contract_id = c.id
    LEFT JOIN users u ON r.created_by = u.id
    LEFT JOIN users uw ON r.withdrawn_by = uw.id
    WHERE r.id = ?
  `).get(req.params.id) as any;

  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }

  if (req.user!.role !== 'admin') {
    const myP = db.prepare(`
      SELECT id FROM countersign_participants
      WHERE round_id = ? AND user_id = ? AND is_replaced = 0
    `).get(req.params.id, req.user!.userId);
    if (!myP) {
      res.status(403).json({ error: '您不是该会签的参与人，无权查看' });
      return;
    }
  }

  const participants = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.role,
      po.user_id as original_user_id, uo.display_name as original_user_name
    FROM countersign_participants p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN countersign_participants po ON p.original_participant_id = po.id
    LEFT JOIN users uo ON po.user_id = uo.id
    WHERE p.round_id = ?
    ORDER BY p.created_at ASC
  `).all(req.params.id);

  const clauses = db.prepare(`
    SELECT cc.*, cl.clause_number, cl.title, cl.current_version, cl.content, cl.risk_level
    FROM countersign_clauses cc
    JOIN clauses cl ON cc.clause_id = cl.id
    WHERE cc.round_id = ?
    ORDER BY CAST(cl.clause_number AS TEXT) ASC
  `).all(req.params.id);

  const clauseIds = (clauses as any[]).map(c => (c as any).clause_id);
  const conclusions: any[] = [];
  if (clauseIds.length > 0) {
    const concs = db.prepare(`
      SELECT co.*, u.display_name as user_name, p.user_id,
        up.display_name as participant_name
      FROM countersign_conclusions co
      JOIN countersign_participants p ON co.participant_id = p.id
      LEFT JOIN users u ON co.user_id = u.id
      LEFT JOIN users up ON p.user_id = up.id
      WHERE co.round_id = ?
    `).all(req.params.id);
    conclusions.push(...(concs as any[]));
  }

  const history = db.prepare(`
    SELECT h.*, u.display_name as user_name
    FROM countersign_history h
    LEFT JOIN users u ON h.user_id = u.id
    WHERE h.round_id = ?
    ORDER BY h.created_at ASC
  `).all(req.params.id).map((h: any) => ({
    ...h,
    details: h.details ? JSON.parse(h.details) : null
  }));

  const myParticipation = (participants as any[]).find(
    (p: any) => p.user_id === req.user!.userId && !p.is_replaced
  );

  res.json({
    ...round,
    participants,
    clauses,
    conclusions,
    history,
    my_participation: myParticipation || null
  });
});

router.post('/:id/acknowledge', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(req.params.id) as any;
  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }
  if (round.status !== 'active') {
    res.status(400).json({ error: `会签状态为${round.status}，无法签收` });
    return;
  }

  const participation = db.prepare(`
    SELECT * FROM countersign_participants
    WHERE round_id = ? AND user_id = ? AND is_replaced = 0
  `).get(req.params.id, req.user!.userId) as any;
  if (!participation) {
    res.status(403).json({ error: '您不是该会签的参与人' });
    return;
  }

  const clauses = db.prepare(`
    SELECT cc.*, cl.current_version
    FROM countersign_clauses cc JOIN clauses cl ON cc.clause_id = cl.id
    WHERE cc.round_id = ? AND cc.invalidated = 0
  `).all(req.params.id) as any[];

  const results: any[] = [];
  try {
    db.exec('BEGIN TRANSACTION');
    for (const c of clauses) {
      const existing = db.prepare(`
        SELECT * FROM countersign_conclusions
        WHERE round_id = ? AND participant_id = ? AND clause_id = ?
      `).get(req.params.id, participation.id, c.clause_id) as any;

      if (!existing) {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO countersign_conclusions
            (id, round_id, participant_id, user_id, clause_id, acknowledged_at, original_version)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).run(id, req.params.id, participation.id, req.user!.userId, c.clause_id, c.current_version);
        results.push({ clause_id: c.clause_id, acknowledged: true, is_new: true });
      } else if (!existing.acknowledged_at) {
        db.prepare(`
          UPDATE countersign_conclusions SET acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(existing.id);
        results.push({ clause_id: c.clause_id, acknowledged: true, is_new: false });
      } else {
        results.push({ clause_id: c.clause_id, acknowledged: false, reason: 'already_acknowledged' });
      }
    }
    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '签收失败', detail: msg });
    return;
  }

  createCountersignHistory(req.params.id, 'acknowledge', req.user!.userId, req.user!.role, {
    clause_count: clauses.length,
    results
  });

  res.json({
    success: true,
    acknowledged_count: results.filter((r: any) => r.acknowledged).length,
    results
  });
});

router.post('/:id/conclude', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { clause_id, conclusion, comment } = req.body;

  if (!clause_id || !conclusion) {
    res.status(400).json({ error: '条款ID和结论不能为空' });
    return;
  }
  if (!['pass', 'reject', 'need_more_info'].includes(conclusion)) {
    res.status(400).json({ error: '结论必须是 pass/reject/need_more_info' });
    return;
  }

  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(req.params.id) as any;
  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }
  if (round.status !== 'active') {
    res.status(400).json({ error: `会签状态为${round.status}，无法提交结论` });
    return;
  }

  const participation = db.prepare(`
    SELECT * FROM countersign_participants
    WHERE round_id = ? AND user_id = ? AND is_replaced = 0
  `).get(req.params.id, req.user!.userId) as any;
  if (!participation) {
    res.status(403).json({ error: '您不是该会签的参与人' });
    return;
  }

  const cc = db.prepare(`
    SELECT * FROM countersign_clauses WHERE round_id = ? AND clause_id = ?
  `).get(req.params.id, clause_id) as any;
  if (!cc) {
    res.status(400).json({ error: '该条款不在此会签范围内' });
    return;
  }
  if (cc.invalidated) {
    res.status(400).json({ error: '该条款已失效，无法签署' });
    return;
  }

  const existing = db.prepare(`
    SELECT * FROM countersign_conclusions
    WHERE round_id = ? AND participant_id = ? AND clause_id = ?
  `).get(req.params.id, participation.id, clause_id) as any;

  if (!existing) {
    res.status(400).json({ error: '请先签收再提交结论' });
    return;
  }
  if (!existing.acknowledged_at) {
    res.status(400).json({ error: '请先签收再提交结论' });
    return;
  }

  const clause = db.prepare('SELECT current_version FROM clauses WHERE id = ?').get(clause_id) as any;
  const versionChanged = clause && existing.original_version < clause.current_version;

  db.prepare(`
    UPDATE countersign_conclusions
    SET conclusion = ?, comment = ?, concluded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(conclusion, comment || '', existing.id);

  createCountersignHistory(req.params.id, 'conclude', req.user!.userId, req.user!.role, {
    clause_id,
    conclusion,
    comment: comment || '',
    has_comment: !!comment,
    version_changed_at_conclude: versionChanged,
    original_version: existing.original_version,
    current_version: clause?.current_version
  });

  tryCompleteRound(req.params.id);

  const updated = db.prepare(`
    SELECT co.*, u.display_name as user_name
    FROM countersign_conclusions co LEFT JOIN users u ON co.user_id = u.id
    WHERE co.id = ?
  `).get(existing.id);

  res.json({ conclusion: updated, version_mismatch: versionChanged });
});

router.post('/:id/withdraw', requireRole('admin'), (req: Request, res: Response) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '撤回原因不能为空' });
    return;
  }

  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(req.params.id) as any;
  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }
  if (round.status !== 'active') {
    res.status(400).json({ error: `会签状态为${round.status}，无法撤回` });
    return;
  }

  db.prepare(`
    UPDATE countersign_rounds
    SET status = 'withdrawn', withdraw_reason = ?, withdrawn_at = CURRENT_TIMESTAMP,
        withdrawn_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reason, req.user!.userId, req.params.id);

  createCountersignHistory(req.params.id, 'withdraw_round', req.user!.userId, req.user!.role, {
    reason
  });
  createAuditLog('withdraw_countersign', 'countersign_round', req.params.id, req.user!.userId, req.user!.role, {
    reason
  });

  const updated = db.prepare(`
    SELECT r.*, u.display_name as withdrawer_name
    FROM countersign_rounds r LEFT JOIN users u ON r.withdrawn_by = u.id
    WHERE r.id = ?
  `).get(req.params.id);

  res.json({ round: updated });
});

router.post('/:id/replace-participant', requireRole('admin'), (req: Request, res: Response) => {
  const { old_participant_id, new_user_id, reason } = req.body;

  if (!old_participant_id || !new_user_id) {
    res.status(400).json({ error: '原参与人和新参与人不能为空' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '替换原因不能为空' });
    return;
  }

  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(req.params.id) as any;
  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }
  if (round.status !== 'active') {
    res.status(400).json({ error: `会签状态为${round.status}，无法替换参与人` });
    return;
  }

  const oldP = db.prepare(`
    SELECT * FROM countersign_participants WHERE id = ? AND round_id = ? AND is_replaced = 0
  `).get(old_participant_id, req.params.id) as any;
  if (!oldP) {
    res.status(400).json({ error: '原参与人记录不存在或已被替换' });
    return;
  }

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(new_user_id) as any;
  if (!newUser) {
    res.status(400).json({ error: '新参与人不存在' });
    return;
  }

  const duplicate = db.prepare(`
    SELECT * FROM countersign_participants
    WHERE round_id = ? AND user_id = ? AND is_replaced = 0
  `).get(req.params.id, new_user_id) as any;
  if (duplicate) {
    res.status(400).json({ error: '新参与人已是该会签的有效参与人' });
    return;
  }

  const oldConclusions = db.prepare(`
    SELECT * FROM countersign_conclusions WHERE participant_id = ? AND round_id = ?
  `).all(old_participant_id, req.params.id) as any[];

  let newPId: string;
  try {
    db.exec('BEGIN TRANSACTION');

    db.prepare(`
      UPDATE countersign_participants
      SET is_replaced = 1, replaced_by = ?, replaced_at = CURRENT_TIMESTAMP, replaced_reason = ?
      WHERE id = ?
    `).run(req.user!.userId, reason, old_participant_id);

    newPId = uuidv4();
    db.prepare(`
      INSERT INTO countersign_participants (id, round_id, user_id, original_participant_id)
      VALUES (?, ?, ?, ?)
    `).run(newPId, req.params.id, new_user_id, old_participant_id);

    const clauses = db.prepare(`
      SELECT cc.*, cl.current_version
      FROM countersign_clauses cc JOIN clauses cl ON cc.clause_id = cl.id
      WHERE cc.round_id = ? AND cc.invalidated = 0
    `).all(req.params.id) as any[];

    const insertConc = db.prepare(`
      INSERT INTO countersign_conclusions
        (id, round_id, participant_id, user_id, clause_id, original_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const c of clauses) {
      insertConc.run(uuidv4(), req.params.id, newPId, new_user_id, c.clause_id, c.current_version);
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '替换参与人失败', detail: msg });
    return;
  }

  createCountersignHistory(req.params.id, 'replace_participant', req.user!.userId, req.user!.role, {
    old_participant_id,
    old_user_id: oldP.user_id,
    new_user_id,
    reason,
    old_conclusions_preserved: oldConclusions.length
  });
  createAuditLog('replace_countersign_participant', 'countersign_round', req.params.id, req.user!.userId, req.user!.role, {
    old_user_id: oldP.user_id,
    new_user_id,
    reason
  });

  const newP = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.role
    FROM countersign_participants p LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(newPId);

  const oldPUpdated = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.role
    FROM countersign_participants p LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(old_participant_id);

  res.json({
    new_participant: newP,
    old_participant: oldPUpdated,
    old_conclusions_preserved: oldConclusions.length
  });
});

router.post('/:id/rerequest-rereview', requireRole('admin'), (req: Request, res: Response) => {
  const { clause_ids, reason } = req.body;
  if (!Array.isArray(clause_ids) || clause_ids.length === 0) {
    res.status(400).json({ error: '请指定需要重审的条款' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '重审原因不能为空' });
    return;
  }

  const round = db.prepare('SELECT * FROM countersign_rounds WHERE id = ?').get(req.params.id) as any;
  if (!round) {
    res.status(404).json({ error: '会签回合不存在' });
    return;
  }
  if (round.status === 'withdrawn') {
    res.status(400).json({ error: '已撤回的会签不能请求重审' });
    return;
  }

  const validClauses = db.prepare(`
    SELECT * FROM countersign_clauses WHERE round_id = ? AND clause_id IN (${clause_ids.map(() => '?').join(',')})
  `).all(req.params.id, ...clause_ids) as any[];

  if (validClauses.length === 0) {
    res.status(400).json({ error: '未找到匹配的会签条款' });
    return;
  }

  const clause = db.prepare('SELECT current_version FROM clauses WHERE id = ?').get(validClauses[0].clause_id) as any;
  const currentVersion = clause?.current_version || validClauses[0].clause_version_at_create;

  try {
    db.exec('BEGIN TRANSACTION');
    for (const cc of validClauses) {
      db.prepare(`
        UPDATE countersign_clauses
        SET needs_rereview = 1, rereview_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reason, cc.id);

      const participants = db.prepare(`
        SELECT * FROM countersign_participants WHERE round_id = ? AND is_replaced = 0
      `).all(req.params.id) as any[];

      for (const p of participants) {
        const existing = db.prepare(`
          SELECT * FROM countersign_conclusions
          WHERE round_id = ? AND participant_id = ? AND clause_id = ?
        `).get(req.params.id, p.id, cc.clause_id) as any;

        if (existing) {
          db.prepare(`
            UPDATE countersign_conclusions
            SET conclusion = NULL, comment = ?, concluded_at = NULL,
                acknowledged_at = CURRENT_TIMESTAMP, original_version = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            existing.comment
              ? `${existing.comment}\n\n[重审请求原因：${reason}]`
              : `[重审请求原因：${reason}]`,
            currentVersion,
            existing.id
          );
        } else {
          db.prepare(`
            INSERT INTO countersign_conclusions
              (id, round_id, participant_id, user_id, clause_id, acknowledged_at, original_version, comment)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
          `).run(
            uuidv4(), req.params.id, p.id, p.user_id, cc.clause_id,
            currentVersion, `[重审请求原因：${reason}]`
          );
        }
      }
    }
    if (round.status === 'completed') {
      db.prepare(`
        UPDATE countersign_rounds SET status = 'active', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.params.id);
    }
    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '请求重审失败', detail: msg });
    return;
  }

  createCountersignHistory(req.params.id, 'rereview_requested', req.user!.userId, req.user!.role, {
    clause_ids,
    reason,
    rereview_count: validClauses.length
  });

  res.json({
    success: true,
    rereviewed_count: validClauses.length,
    clause_ids
  });
});

export function handleClauseVersionChange(
  clauseId: string,
  oldVersion: number,
  newVersion: number,
  changeType: string,
  changeReason: string,
  userId: string,
  userRole: string
) {
  const activeRounds = db.prepare(`
    SELECT cc.*, r.status as round_status
    FROM countersign_clauses cc
    JOIN countersign_rounds r ON cc.round_id = r.id
    WHERE cc.clause_id = ? AND r.status IN ('active', 'completed') AND cc.invalidated = 0
  `).all(clauseId) as any[];

  if (activeRounds.length === 0) return;

  for (const cc of activeRounds) {
    db.prepare(`
      UPDATE countersign_clauses
      SET needs_rereview = 1, rereview_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(`条款版本变更：${changeType}（v${oldVersion}→v${newVersion}）：${changeReason || '未说明'}`, cc.id);

    const participants = db.prepare(`
      SELECT * FROM countersign_participants WHERE round_id = ? AND is_replaced = 0
    `).all(cc.round_id) as any[];

    for (const p of participants) {
      const existing = db.prepare(`
        SELECT * FROM countersign_conclusions
        WHERE round_id = ? AND participant_id = ? AND clause_id = ?
      `).get(cc.round_id, p.id, clauseId) as any;

      if (existing) {
        const existingComment = existing.comment || '';
        const newComment = existingComment
          ? `${existingComment}\n\n[条款版本变更：v${oldVersion}→v${newVersion}，原因：${changeReason || changeType}]`
          : `[条款版本变更：v${oldVersion}→v${newVersion}，原因：${changeReason || changeType}]`;
        db.prepare(`
          UPDATE countersign_conclusions
          SET conclusion = NULL, comment = ?, concluded_at = NULL,
              acknowledged_at = acknowledged_at, original_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newComment, newVersion, existing.id);
      }
    }

    if (cc.round_status === 'completed') {
      db.prepare(`
        UPDATE countersign_rounds SET status = 'active', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cc.round_id);
    }

    createCountersignHistory(cc.round_id, 'clause_version_change', userId, userRole, {
      clause_id: clauseId,
      old_version: oldVersion,
      new_version: newVersion,
      change_type: changeType,
      change_reason: changeReason
    });
  }
}

export default router;
