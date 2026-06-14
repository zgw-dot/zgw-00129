import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const JWT_SECRET = process.env.JWT_SECRET || 'contract-review-secret-key-2026';

export interface AuthPayload {
  userId: string;
  username: string;
  role: 'admin' | 'legal' | 'business';
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type UserRole = 'admin' | 'legal' | 'business';

export function hasPermission(userRole: UserRole, requiredRole: UserRole[]): boolean {
  if (userRole === 'admin') return true;
  return requiredRole.includes(userRole);
}
