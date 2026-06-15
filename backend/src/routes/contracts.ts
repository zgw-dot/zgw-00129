import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';
import { handleClauseVersionChange } from './countersigns';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: Request, res: Response) => {
  const contracts = db.prepare(`
    SELECT c.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM clauses cl WHERE cl.contract_id = c.id) as clause_count,
      (SELECT COUNT(*) FROM suggestions s JOIN clauses cl ON s.clause_id = cl.id WHERE cl.contract_id = c.id AND s.status = 'pending') as pending_suggestions
    FROM contracts c LEFT JOIN users u ON c.created_by = u.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(contracts);
});

router.post('/', requireRole('admin', 'legal', 'business'), (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: '合同名称不能为空' });
    return;
  }
  const id = uuidv4();
  db.prepare('INSERT INTO contracts (id, name, description, created_by) VALUES (?, ?, ?, ?)')
    .run(id, name, description || '', req.user!.userId);

  createAuditLog('create_contract', 'contract', id, req.user!.userId, req.user!.role, { name });
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  res.status(201).json(contract);
});

router.get('/:id', (req: Request, res: Response) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }
  res.json(contract);
});

router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }
  db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id);
  createAuditLog('delete_contract', 'contract', req.params.id, req.user!.userId, req.user!.role, {});
  res.json({ success: true });
});

router.post('/:id/import-precheck', requireRole('admin', 'legal'), (req: Request, res: Response) => {
  const contractId = req.params.id;
  let clauses: any[];

  if (Array.isArray(req.body)) {
    clauses = req.body;
  } else if (Array.isArray(req.body.clauses)) {
    clauses = req.body.clauses;
  } else {
    res.status(400).json({ error: '导入数据格式错误：需要条款数组或包含 clauses 字段的对象' });
    return;
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }

  if (!Array.isArray(clauses) || clauses.length === 0) {
    res.status(400).json({ error: '导入数据格式错误：需要clauses数组' });
    return;
  }

  const existingClauses = db.prepare(`
    SELECT * FROM clauses WHERE contract_id = ?
  `).all(contractId);

  const existingByNumber = new Map<string, any>();
  for (const c of existingClauses as any[]) {
    existingByNumber.set(c.clause_number, c);
  }

  const newClauses: any[] = [];
  const updateClauses: any[] = [];
  const skipClauses: any[] = [];
  const errors: string[] = [];

  for (const clause of clauses) {
    if (!clause.clause_number || !clause.title || !clause.content) {
      errors.push(`条款数据不完整: ${JSON.stringify(clause)}`);
      continue;
    }

    const riskLevel = clause.risk_level && ['low', 'medium', 'high', 'critical'].includes(clause.risk_level)
      ? clause.risk_level : 'low';

    const existing = existingByNumber.get(clause.clause_number);
    if (!existing) {
      newClauses.push({
        clause_number: clause.clause_number,
        title: clause.title,
        content: clause.content,
        risk_level: riskLevel
      });
    } else {
      const contentSame = existing.title === clause.title &&
        existing.content === clause.content &&
        existing.risk_level === riskLevel;

      if (contentSame) {
        skipClauses.push({
          clause_id: existing.id,
          clause_number: existing.clause_number,
          title: existing.title,
          current_version: existing.current_version,
          risk_level: existing.risk_level
        });
      } else {
        const pendingSuggestions = db.prepare(`
          SELECT COUNT(*) as count FROM suggestions
          WHERE clause_id = ? AND status = 'pending'
        `).get(existing.id) as any;

        const drafts = db.prepare(`
          SELECT d.*, u.display_name as user_name, u.role as user_role
          FROM suggestion_drafts d
          LEFT JOIN users u ON d.user_id = u.id
          WHERE d.clause_id = ?
        `).all(existing.id);

        const hasPendingSuggestions = Number(pendingSuggestions?.count ?? 0) > 0;
        const hasDrafts = (drafts as any[]).length > 0;
        const blocked = hasPendingSuggestions || hasDrafts;

        const pendingSuggestionList = hasPendingSuggestions ? db.prepare(`
          SELECT s.*, u.display_name as creator_name
          FROM suggestions s LEFT JOIN users u ON s.created_by = u.id
          WHERE s.clause_id = ? AND s.status = 'pending'
          ORDER BY s.created_at DESC
        `).all(existing.id) : [];

        updateClauses.push({
          clause_id: existing.id,
          clause_number: existing.clause_number,
          old_title: existing.title,
          new_title: clause.title,
          old_content: existing.content,
          new_content: clause.content,
          old_risk_level: existing.risk_level,
          new_risk_level: riskLevel,
          current_version: existing.current_version,
          has_pending_suggestions: hasPendingSuggestions,
          pending_suggestions_count: Number(pendingSuggestions?.count ?? 0),
          pending_suggestions: pendingSuggestionList,
          has_drafts: hasDrafts,
          drafts: drafts,
          blocked: blocked
        });
      }
    }
  }

  const blockedCount = updateClauses.filter((c: any) => c.blocked).length;

  res.json({
    contract_id: contractId,
    total_input: clauses.length,
    new_count: newClauses.length,
    update_count: updateClauses.length,
    skip_count: skipClauses.length,
    error_count: errors.length,
    blocked_count: blockedCount,
    new_clauses: newClauses,
    update_clauses: updateClauses,
    skip_clauses: skipClauses,
    errors
  });
});

router.post('/:id/import', requireRole('admin', 'legal'), (req: Request, res: Response) => {
  const contractId = req.params.id;
  const { mode, clauses: clausesInput, confirm_overrides } = req.body;

  let clauses: any[];
  if (Array.isArray(clausesInput)) {
    clauses = clausesInput;
  } else if (Array.isArray(req.body)) {
    clauses = req.body;
  } else {
    res.status(400).json({ error: '导入数据格式错误：需要 clauses 数组' });
    return;
  }

  const importMode = mode === 'add_only' ? 'add_only' : 'update_by_number';

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }

  if (!Array.isArray(clauses) || clauses.length === 0) {
    res.status(400).json({ error: '导入数据格式错误：需要clauses数组' });
    return;
  }

  const confirmMap = new Map<string, string>();
  if (Array.isArray(confirm_overrides)) {
    for (const item of confirm_overrides) {
      if (item.clause_number && item.reason) {
        confirmMap.set(item.clause_number, item.reason);
      }
    }
  }

  const existingClauses = db.prepare(`
    SELECT * FROM clauses WHERE contract_id = ?
  `).all(contractId);

  const existingByNumber = new Map<string, any>();
  for (const c of existingClauses as any[]) {
    existingByNumber.set(c.clause_number, c);
  }

  const insertClause = db.prepare(`
    INSERT INTO clauses (id, contract_id, clause_number, title, content, risk_level, current_version)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO clause_versions (id, clause_id, version_number, title, content, risk_level, created_by, change_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateClause = db.prepare(`
    UPDATE clauses SET title = ?, content = ?, risk_level = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const importedNew: any[] = [];
  const updated: any[] = [];
  const skipped: any[] = [];
  const blocked: any[] = [];
  const errors: string[] = [];

  try {
    db.exec('BEGIN TRANSACTION');

    for (const clause of clauses) {
      if (!clause.clause_number || !clause.title || !clause.content) {
        errors.push(`条款数据不完整: ${JSON.stringify(clause)}`);
        continue;
      }

      const riskLevel = clause.risk_level && ['low', 'medium', 'high', 'critical'].includes(clause.risk_level)
        ? clause.risk_level : 'low';

      const existing = existingByNumber.get(clause.clause_number);

      if (!existing) {
        const clauseId = uuidv4();
        try {
          insertClause.run(clauseId, contractId, clause.clause_number, clause.title, clause.content, riskLevel);
          insertVersion.run(uuidv4(), clauseId, 1, clause.title, clause.content, riskLevel, req.user!.userId, '初始导入');
          importedNew.push({ id: clauseId, clause_number: clause.clause_number, title: clause.title, action: 'new' });

          createAuditLog('import_clause_new', 'clause', clauseId, req.user!.userId, req.user!.role, {
            clause_number: clause.clause_number,
            title: clause.title,
            risk_level: riskLevel,
            import_mode: importMode
          });
        } catch (e: any) {
          const msg = typeof e === 'string' ? e : e?.message || String(e);
          errors.push(`导入失败: ${clause.clause_number} - ${msg}`);
        }
      } else {
        if (importMode === 'add_only') {
          skipped.push({
            id: existing.id,
            clause_number: existing.clause_number,
            title: existing.title,
            action: 'skip',
            reason: 'add_only 模式：已存在的条款跳过'
          });
          continue;
        }

        const contentSame = existing.title === clause.title &&
          existing.content === clause.content &&
          existing.risk_level === riskLevel;

        if (contentSame) {
          skipped.push({
            id: existing.id,
            clause_number: existing.clause_number,
            title: existing.title,
            action: 'skip',
            reason: '内容无变化'
          });
          continue;
        }

        const pendingSuggestions = db.prepare(`
          SELECT COUNT(*) as count FROM suggestions
          WHERE clause_id = ? AND status = 'pending'
        `).get(existing.id) as any;

        const drafts = db.prepare(`
          SELECT COUNT(*) as count FROM suggestion_drafts
          WHERE clause_id = ?
        `).get(existing.id) as any;

        const hasPending = Number(pendingSuggestions?.count ?? 0) > 0;
        const hasDrafts = Number(drafts?.count ?? 0) > 0;
        const isBlocked = hasPending || hasDrafts;

        if (isBlocked) {
          const confirmReason = confirmMap.get(clause.clause_number);
          if (!confirmReason || !confirmReason.trim()) {
            blocked.push({
              id: existing.id,
              clause_number: existing.clause_number,
              title: existing.title,
              action: 'blocked',
              reason: '存在未处理建议或未提交草稿，且未提供覆盖确认原因',
              has_pending_suggestions: hasPending,
              has_drafts: hasDrafts
            });
            continue;
          }

          const newVersion = existing.current_version + 1;
          updateClause.run(clause.title, clause.content, riskLevel, newVersion, existing.id);
          insertVersion.run(
            uuidv4(), existing.id, newVersion, clause.title, clause.content, riskLevel,
            req.user!.userId,
            `导入覆盖：${confirmReason}`
          );

          if (hasDrafts) {
            db.prepare(`
              UPDATE suggestion_drafts SET updated_at = CURRENT_TIMESTAMP
              WHERE clause_id = ?
            `).run(existing.id);
          }

          handleClauseVersionChange(
            existing.id, existing.current_version, newVersion,
            'import_override', confirmReason, req.user!.userId, req.user!.role
          );

          updated.push({
            id: existing.id,
            clause_number: existing.clause_number,
            title: clause.title,
            action: 'update',
            old_version: existing.current_version,
            new_version: newVersion,
            override_reason: confirmReason,
            had_pending_suggestions: hasPending,
            had_drafts: hasDrafts
          });

          createAuditLog('import_clause_update', 'clause', existing.id, req.user!.userId, req.user!.role, {
            clause_number: clause.clause_number,
            old_title: existing.title,
            new_title: clause.title,
            old_version: existing.current_version,
            new_version: newVersion,
            override_reason: confirmReason,
            had_pending_suggestions: hasPending,
            had_drafts: hasDrafts,
            import_mode: importMode
          });
        } else {
          const newVersion = existing.current_version + 1;
          updateClause.run(clause.title, clause.content, riskLevel, newVersion, existing.id);
          insertVersion.run(
            uuidv4(), existing.id, newVersion, clause.title, clause.content, riskLevel,
            req.user!.userId,
            '导入更新'
          );

          handleClauseVersionChange(
            existing.id, existing.current_version, newVersion,
            'import_update', '导入更新', req.user!.userId, req.user!.role
          );

          updated.push({
            id: existing.id,
            clause_number: existing.clause_number,
            title: clause.title,
            action: 'update',
            old_version: existing.current_version,
            new_version: newVersion
          });

          createAuditLog('import_clause_update', 'clause', existing.id, req.user!.userId, req.user!.role, {
            clause_number: clause.clause_number,
            old_title: existing.title,
            new_title: clause.title,
            old_version: existing.current_version,
            new_version: newVersion,
            import_mode: importMode
          });
        }
      }
    }

    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    const msg = typeof e === 'string' ? e : e?.message || String(e);
    res.status(500).json({ error: '导入事务失败', detail: msg });
    return;
  }

  createAuditLog('import_clauses', 'contract', contractId, req.user!.userId, req.user!.role, {
    import_mode: importMode,
    new_count: importedNew.length,
    update_count: updated.length,
    skip_count: skipped.length,
    block_count: blocked.length,
    error_count: errors.length
  });

  res.json({
    import_mode: importMode,
    imported_new: importedNew,
    updated: updated,
    skipped: skipped,
    blocked: blocked,
    errors,
    new_count: importedNew.length,
    update_count: updated.length,
    skip_count: skipped.length,
    block_count: blocked.length,
    error_count: errors.length
  });
});

export default router;
