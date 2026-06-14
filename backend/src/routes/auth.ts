import { Router, Request, Response } from 'express';
import db from '../database';
import { comparePassword, generateToken } from '../auth';
import { authMiddleware } from '../middleware';
import { createAuditLog } from '../audit';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role
  });

  createAuditLog('login', 'user', user.id, user.id, user.role, {});

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name
    }
  });
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const user = db.prepare('SELECT id, username, role, display_name, created_at FROM users WHERE id = ?').get(req.user.userId);
  res.json(user);
});

router.get('/users', authMiddleware, (req: Request, res: Response) => {
  const users = db.prepare('SELECT id, username, role, display_name, created_at FROM users ORDER BY role, username').all();
  res.json(users);
});

export default router;
