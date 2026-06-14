import { initDatabase } from './database';
import db from './database';
import { hashPassword } from './auth';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  await initDatabase();

  const row: any = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const existingUsers = Number(row?.count ?? 0);
  if (existingUsers > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  const users = [
    {
      id: uuidv4(),
      username: 'admin',
      password: 'admin123',
      role: 'admin' as const,
      display_name: '系统管理员'
    },
    {
      id: uuidv4(),
      username: 'legal1',
      password: 'legal123',
      role: 'legal' as const,
      display_name: '法务-张明'
    },
    {
      id: uuidv4(),
      username: 'legal2',
      password: 'legal123',
      role: 'legal' as const,
      display_name: '法务-李华'
    },
    {
      id: uuidv4(),
      username: 'business1',
      password: 'biz123',
      role: 'business' as const,
      display_name: '业务-王芳'
    },
    {
      id: uuidv4(),
      username: 'business2',
      password: 'biz123',
      role: 'business' as const,
      display_name: '业务-赵强'
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, display_name)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const user of users) {
    const hash = await hashPassword(user.password);
    insertUser.run(user.id, user.username, hash, user.role, user.display_name);
    console.log(`Created user: ${user.username} (${user.role})`);
  }

  console.log('\nSeed completed successfully!');
  console.log('\nLogin credentials:');
  console.log('  admin / admin123    (管理员 - 全部权限)');
  console.log('  legal1 / legal123   (法务评审)');
  console.log('  legal2 / legal123   (法务评审)');
  console.log('  business1 / biz123  (业务评审)');
  console.log('  business2 / biz123  (业务评审)');
}

seed().catch(console.error);
