import { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthPayload } from './auth';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录或Token无效' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token已过期或无效' });
    return;
  }

  req.user = payload;
  next();
}

export function requireRole(...roles: Array<'admin' | 'legal' | 'business'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: '未登录' });
      return;
    }
    if (req.user.role === 'admin' || roles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ error: '权限不足' });
    }
  };
}
