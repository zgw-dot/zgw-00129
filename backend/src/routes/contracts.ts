import { Router, Request, Response } from 'express';
import db from '../database';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../middleware';
import { createAuditLog } from '../audit';

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

router.post('/:id/import', requireRole('admin', 'legal'), (req: Request, res: Response) => {
  const { clauses } = req.body;
  const contractId = req.params.id;

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) {
    res.status(404).json({ error: '合同不存在' });
    return;
  }

  if (!Array.isArray(clauses) || clauses.length === 0) {
    res.status(400).json({ error: '导入数据格式错误：需要clauses数组' });
    return;
  }

  const insertClause = db.prepare(`
    INSERT INTO clauses (id, contract_id, clause_number, title, content, risk_level, current_version)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO clause_versions (id, clause_id, version_number, title, content, risk_level, created_by, change_summary)
    VALUES (?, ?, 1, ?, ?, ?, ?, '初始版本')
  `);

  const imported: any[] = [];
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

      const clauseId = uuidv4();
      try {
        insertClause.run(clauseId, contractId, clause.clause_number, clause.title, clause.content, riskLevel);
        insertVersion.run(uuidv4(), clauseId, clause.title, clause.content, riskLevel, req.user!.userId);
        imported.push({ id: clauseId, clause_number: clause.clause_number, title: clause.title });
      } catch (e: any) {
        const msg = typeof e === 'string' ? e : e?.message || String(e);
        if (msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('constraint')) {
          errors.push(`条款编号重复: ${clause.clause_number}`);
        } else {
          errors.push(`导入失败: ${clause.clause_number} - ${msg}`);
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
    imported_count: imported.length,
    error_count: errors.length
  });

  res.json({ imported, errors, imported_count: imported.length, error_count: errors.length });
});

export default router;
