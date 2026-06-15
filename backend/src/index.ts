import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './database';
import authRoutes from './routes/auth';
import contractRoutes from './routes/contracts';
import clauseRoutes from './routes/clauses';
import exportRoutes from './routes/export';

const PORT = Number(process.env.PORT) || 3001;

async function bootstrap() {
  await initDatabase();

  const app = express();

  app.use(cors({
    origin: ['http://127.0.0.1:8080', 'http://localhost:8080'],
    credentials: true
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/contracts', contractRoutes);
  app.use('/api/clauses', clauseRoutes);
  app.use('/api/reports', exportRoutes);

  const dataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(dataDir)) {
    app.use('/data', express.static(dataDir));
  }

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Server Error]', err);
    res.status(err.status || 500).json({
      error: err.message || '服务器内部错误',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  合同条款协同评审系统 - 后端服务启动成功                       ║
╠══════════════════════════════════════════════════════════════╣
║  服务地址: http://localhost:${PORT.toString().padEnd(40)}║
║  健康检查: http://localhost:${PORT}/api/health                 ║
║  数据目录: ${(dataDir || '').padEnd(40)}║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}

bootstrap().catch(e => {
  console.error('服务启动失败:', e);
  process.exit(1);
});
