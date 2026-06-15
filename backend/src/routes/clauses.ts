import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';
import { handleClauseVersionChange } from './countersigns';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: Request, res: Response) => {
  const { contract_id, status, risk_level, has_pending } = req.query;

  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM suggestions s WHERE s.clause_id = c.id AND s.status = 'pending') as pending_count,
      (SELECT COUNT(*) FROM suggestions s WHERE s.clause_id = c.id) as total_suggestions
    FROM clauses c WHERE 1=1
  `;
  const params: any[] = [];

  if (contract_id) {
    sql += ' AND c.contract_id = ?';
    params.push(contract_id);
  }
  if (risk_level && ['low', 'medium', 'high', 'critical'].includes(risk_level as string)) {
    sql += ' AND c.risk_level = ?';
    params.push(risk_level);
  }
  if (has_pending === 'true') {
    sql += ' AND EXISTS (SELECT 1 FROM suggestions s WHERE s.clause_id = c.id AND s.status = ?)';
    params.push('pending');
  } else if (has_pending === 'false') {
    sql += ' AND NOT EXISTS (SELECT 1 FROM suggestions s WHERE s.clause_id = c.id AND s.status = ?)';
    params.push('pending');
  }

  sql += ' ORDER BY CAST(c.clause_number AS TEXT) ASC';
  const clauses = db.prepare(sql).all(...params);
  res.json(clauses);
});

router.get('/:id', (req: Request, res: Response) => {
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) {
    res.status(404).json({ error: '条款不存在' });
    return;
  }

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

  res.json({ ...clause, versions, suggestions });
});

router.get('/:id/versions', (req: Request, res: Response) => {
  const versions = db.prepare(`
    SELECT v.*, u.display_name as creator_name, u.role as created_by_role
    FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
    WHERE v.clause_id = ? ORDER BY v.version_number DESC
  `).all(req.params.id);
  res.json(versions);
});

router.post('/:id/suggestions', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { type, content, base_version, amended_title, amended_content, risk_level, exclusive_role } = req.body;
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) {
    res.status(404).json({ error: '条款不存在' });
    return;
  }
  if (!type || !['comment', 'amendment'].includes(type)) {
    res.status(400).json({ error: '建议类型无效' });
    return;
  }
  if (!content || !content.trim()) {
    res.status(400).json({ error: '建议内容不能为空' });
    return;
  }
  if (type === 'amendment' && (!amended_content || !amended_content.trim())) {
    res.status(400).json({ error: '修改建议必须提供修改后的内容' });
    return;
  }
  if (!base_version || base_version < 1) {
    res.status(400).json({ error: '必须指定基于哪个版本' });
    return;
  }
  if (risk_level && !['low', 'medium', 'high', 'critical'].includes(risk_level)) {
    res.status(400).json({ error: '风险等级无效' });
    return;
  }
  const exclusiveRole = exclusive_role && ['legal', 'business'].includes(exclusive_role) ? exclusive_role : 'all';
  const currentVersion = clause.current_version;
  let version_conflict = false;
  let conflict_detail = null;

  if (base_version < currentVersion) {
    version_conflict = true;
    const newerVersions = db.prepare(`
      SELECT v.version_number, v.change_summary, v.created_at, u.display_name
      FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
      WHERE v.clause_id = ? AND v.version_number > ?
      ORDER BY v.version_number ASC
    `).all(req.params.id, base_version);

    const newerSuggestions = db.prepare(`
      SELECT s.id, s.type, s.content, s.created_at, u.display_name, s.status
      FROM suggestions s LEFT JOIN users u ON s.created_by = u.id
      WHERE s.clause_id = ? AND s.base_version >= ? AND s.status IN ('approved', 'merged')
      ORDER BY s.created_at ASC
    `).all(req.params.id, base_version);

    conflict_detail = {
      base_version,
      current_version: currentVersion,
      newer_versions: newerVersions,
      newer_decisions: newerSuggestions
    };
  }

  const targetVersion = db.prepare('SELECT * FROM clause_versions WHERE clause_id = ? AND version_number = ?')
    .get(req.params.id, base_version);
  if (!targetVersion) {
    res.status(400).json({ error: `指定的基础版本 v${base_version} 不存在` });
    return;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO suggestions (id, clause_id, clause_version_id, base_version, type, content,
      amended_title, amended_content, risk_level, created_by, created_by_role, exclusive_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, clause.id, (targetVersion as any).id, base_version, type, content,
    amended_title || null, amended_content || null, risk_level || null,
    req.user!.userId, req.user!.role, exclusiveRole
  );

  createAuditLog('create_suggestion', 'suggestion', id, req.user!.userId, req.user!.role, {
    clause_id: clause.id,
    clause_number: clause.clause_number,
    type,
    base_version,
    version_conflict
  });

  const draftRow = db.prepare(
    'SELECT id FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
  ).get(clause.id, req.user!.userId) as any;
  if (draftRow) {
    db.prepare('DELETE FROM suggestion_drafts WHERE id = ?').run(draftRow.id);
    createAuditLog('submit_draft', 'draft', draftRow.id, req.user!.userId, req.user!.role, {
      clause_id: clause.id,
      clause_number: clause.clause_number,
      submitted_suggestion_id: id
    });
  }

  const suggestion = db.prepare(`
    SELECT s.*, u.display_name as creator_name
    FROM suggestions s LEFT JOIN users u ON s.created_by = u.id WHERE s.id = ?
  `).get(id);

  res.status(201).json({
    suggestion,
    version_conflict,
    conflict_detail
  });
});

router.post('/:id/suggestions/:sid/approve', requireRole('admin', 'legal', 'business'), (req: Request, res: Response) => {
  const { reason } = req.body;
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }
  const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ? AND clause_id = ?').get(req.params.sid, req.params.id) as any;
  if (!suggestion) { res.status(404).json({ error: '建议不存在' }); return; }
  if (suggestion.status !== 'pending') { res.status(400).json({ error: `建议状态为${suggestion.status}，无法处理` }); return; }

  if (suggestion.exclusive_role !== 'all' && suggestion.exclusive_role !== req.user!.role && req.user!.role !== 'admin') {
    res.status(403).json({ error: `此为${suggestion.exclusive_role === 'legal' ? '法务' : '业务'}专属建议，${req.user!.role === 'business' ? '业务' : '法务'}角色无权处理` });
    return;
  }

  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '决策原因不能为空' });
    return;
  }

  if (suggestion.type !== 'comment') {
    res.status(400).json({ error: '只有评论类型的建议可以直接通过，修改建议需要使用合并接口' });
    return;
  }

  db.prepare(`
    UPDATE suggestions SET status = 'approved', resolved_at = CURRENT_TIMESTAMP,
    resolved_by = ?, decision_reason = ? WHERE id = ?
  `).run(req.user!.userId, reason, req.params.sid);

  createAuditLog('approve_suggestion', 'suggestion', req.params.sid, req.user!.userId, req.user!.role, {
    clause_id: clause.id,
    suggestion_type: suggestion.type,
    reason
  });

  const updated = db.prepare(`
    SELECT s.*, u.display_name as resolver_name FROM suggestions s
    LEFT JOIN users u ON s.resolved_by = u.id WHERE s.id = ?
  `).get(req.params.sid);
  res.json(updated);
});

router.post('/:id/suggestions/:sid/reject', requireRole('admin', 'legal', 'business'), (req: Request, res: Response) => {
  const { reason } = req.body;
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }
  const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ? AND clause_id = ?').get(req.params.sid, req.params.id) as any;
  if (!suggestion) { res.status(404).json({ error: '建议不存在' }); return; }
  if (suggestion.status !== 'pending') { res.status(400).json({ error: `建议状态为${suggestion.status}，无法处理` }); return; }

  if (suggestion.exclusive_role !== 'all' && suggestion.exclusive_role !== req.user!.role && req.user!.role !== 'admin') {
    res.status(403).json({ error: `此为${suggestion.exclusive_role === 'legal' ? '法务' : '业务'}专属建议，${req.user!.role === 'business' ? '业务' : '法务'}角色无权驳回` });
    return;
  }

  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '驳回原因不能为空' });
    return;
  }

  db.prepare(`
    UPDATE suggestions SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP,
    resolved_by = ?, decision_reason = ? WHERE id = ?
  `).run(req.user!.userId, reason, req.params.sid);

  createAuditLog('reject_suggestion', 'suggestion', req.params.sid, req.user!.userId, req.user!.role, {
    clause_id: clause.id,
    suggestion_type: suggestion.type,
    reason
  });

  const updated = db.prepare(`
    SELECT s.*, u.display_name as resolver_name FROM suggestions s
    LEFT JOIN users u ON s.resolved_by = u.id WHERE s.id = ?
  `).get(req.params.sid);
  res.json(updated);
});

router.post('/:id/suggestions/:sid/merge', requireRole('admin', 'legal'), (req: Request, res: Response) => {
  const { reason } = req.body;
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }
  const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ? AND clause_id = ?').get(req.params.sid, req.params.id) as any;
  if (!suggestion) { res.status(404).json({ error: '建议不存在' }); return; }
  if (suggestion.status !== 'pending') { res.status(400).json({ error: `建议状态为${suggestion.status}，无法合并` }); return; }
  if (suggestion.type !== 'amendment') { res.status(400).json({ error: '只有修改建议可以合并' }); return; }
  if (!reason || !reason.trim()) { res.status(400).json({ error: '合并原因不能为空' }); return; }

  if (suggestion.base_version < clause.current_version) {
    res.status(409).json({
      error: '版本冲突：建议基于旧版本提交，条款已有新版本，请先审阅差异后重新提交',
      conflict: {
        base_version: suggestion.base_version,
        current_version: clause.current_version
      }
    });
    return;
  }

  const newVersion = clause.current_version + 1;
  const newTitle = suggestion.amended_title || clause.title;
  const newContent = suggestion.amended_content || clause.content;
  const newRisk = suggestion.risk_level || clause.risk_level;

  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare(`
      INSERT INTO clause_versions (id, clause_id, version_number, title, content, risk_level, created_by, change_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), clause.id, newVersion, newTitle, newContent, newRisk, req.user!.userId, reason);

    db.prepare(`
      UPDATE clauses SET title = ?, content = ?, risk_level = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newTitle, newContent, newRisk, newVersion, clause.id);

    db.prepare(`
      UPDATE suggestions SET status = 'merged', resolved_at = CURRENT_TIMESTAMP,
      resolved_by = ?, decision_reason = ? WHERE id = ?
    `).run(req.user!.userId, reason, req.params.sid);
    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '合并失败', detail: msg });
    return;
  }

  const oldVersion = clause.current_version;
  handleClauseVersionChange(
    clause.id, oldVersion, newVersion,
    'merge_suggestion', reason, req.user!.userId, req.user!.role
  );

  createAuditLog('merge_suggestion', 'suggestion', req.params.sid, req.user!.userId, req.user!.role, {
    clause_id: clause.id,
    old_version: oldVersion,
    new_version: newVersion,
    reason
  });
  createAuditLog('new_version', 'clause', clause.id, req.user!.userId, req.user!.role, {
    from_version: oldVersion,
    to_version: newVersion,
    from_suggestion: req.params.sid,
    reason
  });

  const updatedClause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(clause.id);
  const updatedSuggestion = db.prepare(`
    SELECT s.*, u.display_name as resolver_name FROM suggestions s
    LEFT JOIN users u ON s.resolved_by = u.id WHERE s.id = ?
  `).get(req.params.sid);

  res.json({ clause: updatedClause, suggestion: updatedSuggestion, new_version: newVersion });
});

router.post('/:id/rollback', requireRole('admin'), (req: Request, res: Response) => {
  const { target_version, reason } = req.body;
  if (!target_version || target_version < 1) {
    res.status(400).json({ error: '目标版本无效' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: '回滚原因不能为空' });
    return;
  }
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) { res.status(404).json({ error: '条款不存在' }); return; }

  const targetVersion = db.prepare('SELECT * FROM clause_versions WHERE clause_id = ? AND version_number = ?')
    .get(req.params.id, target_version);
  if (!targetVersion) {
    res.status(404).json({
      error: `版本 v${target_version} 不存在，无法回滚`,
      detail: `当前条款存在的最高历史版本为 v${clause.current_version}`
    });
    return;
  }

  if (target_version >= clause.current_version) {
    res.status(400).json({ error: `目标版本 v${target_version} 不小于当前版本 v${clause.current_version}，无需回滚` });
    return;
  }

  const newVersion = clause.current_version + 1;

  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare(`
      INSERT INTO clause_versions (id, clause_id, version_number, title, content, risk_level, created_by, change_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), clause.id, newVersion, (targetVersion as any).title, (targetVersion as any).content,
      (targetVersion as any).risk_level, req.user!.userId, `回滚至 v${target_version}：${reason}`);

    db.prepare(`
      UPDATE clauses SET title = ?, content = ?, risk_level = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run((targetVersion as any).title, (targetVersion as any).content, (targetVersion as any).risk_level, newVersion, clause.id);
    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '回滚失败', detail: msg });
    return;
  }

  const oldVersion = clause.current_version;
  handleClauseVersionChange(
    clause.id, oldVersion, newVersion,
    'rollback', `回滚至 v${target_version}：${reason}`, req.user!.userId, req.user!.role
  );

  createAuditLog('rollback', 'clause', clause.id, req.user!.userId, req.user!.role, {
    from_version: oldVersion,
    to_version: newVersion,
    rollback_target: target_version,
    reason
  });

  const updatedClause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(clause.id);
  res.json({ clause: updatedClause, new_version: newVersion, rollback_from: oldVersion, rollback_to: target_version });
});

router.get('/:id/suggestions', (req: Request, res: Response) => {
  const { status } = req.query;
  let sql = `
    SELECT s.*, u.display_name as creator_name, u2.display_name as resolver_name
    FROM suggestions s
    LEFT JOIN users u ON s.created_by = u.id
    LEFT JOIN users u2 ON s.resolved_by = u2.id
    WHERE s.clause_id = ?
  `;
  const params: any[] = [req.params.id];
  if (status && ['pending', 'approved', 'rejected', 'merged'].includes(status as string)) {
    sql += ' AND s.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY s.created_at DESC';
  const suggestions = db.prepare(sql).all(...params);
  res.json(suggestions);
});

router.get('/:id/drafts', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const draft = db.prepare(
    'SELECT * FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;
  if (!draft) {
    res.json(null);
    return;
  }
  const clause = db.prepare('SELECT current_version, updated_at FROM clauses WHERE id = ?').get(req.params.id) as any;
  const version_conflict = clause && draft.base_version < clause.current_version;
  let conflict_detail = null;
  if (version_conflict) {
    const newerVersions = db.prepare(`
      SELECT v.version_number, v.change_summary, v.created_at, u.display_name
      FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
      WHERE v.clause_id = ? AND v.version_number > ?
      ORDER BY v.version_number ASC
    `).all(req.params.id, draft.base_version);
    conflict_detail = {
      base_version: draft.base_version,
      current_version: clause.current_version,
      newer_versions: newerVersions
    };
  }
  let context_snapshot = null;
  if (draft.context_snapshot) {
    try { context_snapshot = JSON.parse(draft.context_snapshot); } catch {}
  }
  res.json({
    ...draft,
    context_snapshot,
    version_conflict,
    current_version: clause?.current_version,
    last_save_time: draft.updated_at,
    conflict_detail
  });
});

router.post('/:id/drafts', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { type, content, base_version, amended_title, amended_content, risk_level, exclusive_role } = req.body;
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) {
    res.status(404).json({ error: '条款不存在' });
    return;
  }
  if (!type || !['comment', 'amendment'].includes(type)) {
    res.status(400).json({ error: '建议类型无效' });
    return;
  }
  if (!base_version || base_version < 1) {
    res.status(400).json({ error: '必须指定基于哪个版本' });
    return;
  }

  const targetVersion = db.prepare(
    'SELECT * FROM clause_versions WHERE clause_id = ? AND version_number = ?'
  ).get(req.params.id, base_version) as any;

  const snapshot = JSON.stringify({
    clause_title: clause.title,
    clause_content: clause.content,
    clause_risk_level: clause.risk_level,
    clause_updated_at: clause.updated_at,
    version_number: base_version,
    version_title: targetVersion?.title || clause.title,
    version_content: targetVersion?.content || clause.content
  });

  const existing = db.prepare(
    'SELECT id FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;

  let draftId: string;
  if (existing) {
    draftId = existing.id;
    db.prepare(`
      UPDATE suggestion_drafts SET type = ?, content = ?, base_version = ?,
        amended_title = ?, amended_content = ?, risk_level = ?, exclusive_role = ?,
        context_snapshot = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      type, content || '', base_version,
      amended_title || null, amended_content || null,
      risk_level || null, exclusive_role || 'all', snapshot, draftId
    );
  } else {
    draftId = uuidv4();
    db.prepare(`
      INSERT INTO suggestion_drafts (id, clause_id, user_id, base_version, type, content,
        amended_title, amended_content, risk_level, exclusive_role, context_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draftId, clause.id, req.user!.userId, base_version, type, content || '',
      amended_title || null, amended_content || null,
      risk_level || null, exclusive_role || 'all', snapshot
    );
  }

  createAuditLog('save_draft', 'draft', draftId, req.user!.userId, req.user!.role, {
    clause_id: clause.id,
    clause_number: clause.clause_number,
    type,
    base_version,
    is_update: !!existing
  });

  const draft = db.prepare('SELECT * FROM suggestion_drafts WHERE id = ?').get(draftId) as any;
  const version_conflict = base_version < clause.current_version;
  let context_snapshot = null;
  if (draft.context_snapshot) {
    try { context_snapshot = JSON.parse(draft.context_snapshot); } catch {}
  }
  res.json({ ...draft, context_snapshot, version_conflict, current_version: clause.current_version });
});

router.post('/:id/drafts/restore', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const draft = db.prepare(
    'SELECT * FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;
  if (!draft) {
    res.status(404).json({ error: '草稿不存在' });
    return;
  }
  const clause = db.prepare('SELECT current_version FROM clauses WHERE id = ?').get(req.params.id) as any;
  const version_conflict = clause && draft.base_version < clause.current_version;

  createAuditLog('restore_draft', 'draft', draft.id, req.user!.userId, req.user!.role, {
    clause_id: draft.clause_id,
    base_version: draft.base_version,
    current_version: clause?.current_version,
    version_conflict
  });

  let conflict_detail = null;
  if (version_conflict) {
    const newerVersions = db.prepare(`
      SELECT v.version_number, v.change_summary, v.created_at, u.display_name
      FROM clause_versions v LEFT JOIN users u ON v.created_by = u.id
      WHERE v.clause_id = ? AND v.version_number > ?
      ORDER BY v.version_number ASC
    `).all(req.params.id, draft.base_version);
    conflict_detail = {
      base_version: draft.base_version,
      current_version: clause.current_version,
      newer_versions: newerVersions
    };
  }

  let context_snapshot = null;
  if (draft.context_snapshot) {
    try { context_snapshot = JSON.parse(draft.context_snapshot); } catch {}
  }

  res.json({
    ...draft,
    context_snapshot,
    version_conflict,
    current_version: clause?.current_version,
    last_save_time: draft.updated_at,
    conflict_detail
  });
});

router.post('/:id/drafts/conflict-action', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const { action } = req.body;
  if (!action || !['continue', 'copy', 'discard'].includes(action)) {
    res.status(400).json({ error: '冲突操作类型无效，必须为 continue/copy/discard' });
    return;
  }
  const draft = db.prepare(
    'SELECT * FROM suggestion_drafts WHERE clause_id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;
  if (!draft) {
    res.status(404).json({ error: '草稿不存在' });
    return;
  }
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ?').get(req.params.id) as any;
  if (!clause) {
    res.status(404).json({ error: '条款不存在' });
    return;
  }

  const parseSnapshot = (raw: any) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };

  const auditAction = action === 'continue' ? 'draft_conflict_continue'
    : action === 'copy' ? 'draft_conflict_copy'
    : 'draft_conflict_discard';

  createAuditLog(auditAction, 'draft', draft.id, req.user!.userId, req.user!.role, {
    clause_id: draft.clause_id,
    base_version: draft.base_version,
    current_version: clause.current_version,
    conflict_action: action
  });

  if (action === 'discard') {
    db.prepare('DELETE FROM suggestion_drafts WHERE id = ?').run(draft.id);
    res.json({ success: true, action: 'discard' });
    return;
  }

  if (action === 'continue') {
    const version_conflict = draft.base_version < clause.current_version;
    res.json({
      ...draft,
      context_snapshot: parseSnapshot(draft.context_snapshot),
      version_conflict,
      current_version: clause.current_version,
      last_save_time: draft.updated_at,
      action: 'continue'
    });
    return;
  }

  if (action === 'copy') {
    const targetVersion = db.prepare(
      'SELECT * FROM clause_versions WHERE clause_id = ? AND version_number = ?'
    ).get(req.params.id, clause.current_version) as any;
    const newSnapshot = JSON.stringify({
      clause_title: clause.title,
      clause_content: clause.content,
      clause_risk_level: clause.risk_level,
      clause_updated_at: clause.updated_at,
      version_number: clause.current_version,
      version_title: targetVersion?.title || clause.title,
      version_content: targetVersion?.content || clause.content
    });
    db.prepare(`
      UPDATE suggestion_drafts SET base_version = ?, context_snapshot = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(clause.current_version, newSnapshot, draft.id);
    const updated = db.prepare('SELECT * FROM suggestion_drafts WHERE id = ?').get(draft.id) as any;
    res.json({
      ...updated,
      context_snapshot: parseSnapshot(updated.context_snapshot),
      version_conflict: false,
      current_version: clause.current_version,
      last_save_time: updated.updated_at,
      action: 'copy'
    });
    return;
  }
});

router.delete('/:id/drafts/:draftId', requireRole('legal', 'business', 'admin'), (req: Request, res: Response) => {
  const draft = db.prepare('SELECT * FROM suggestion_drafts WHERE id = ?').get(req.params.draftId) as any;
  if (!draft) {
    res.status(404).json({ error: '草稿不存在' });
    return;
  }
  if (draft.user_id !== req.user!.userId) {
    res.status(403).json({ error: '只能删除自己的草稿' });
    return;
  }
  if (draft.clause_id !== req.params.id) {
    res.status(400).json({ error: '草稿与条款不匹配' });
    return;
  }

  db.prepare('DELETE FROM suggestion_drafts WHERE id = ?').run(req.params.draftId);

  createAuditLog('delete_draft', 'draft', req.params.draftId, req.user!.userId, req.user!.role, {
    clause_id: draft.clause_id,
    type: draft.type,
    base_version: draft.base_version
  });

  res.json({ success: true });
});

export default router;
