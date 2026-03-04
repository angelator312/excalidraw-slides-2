import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { setupWebSocket } from './ws.js';
import authRouter from './api/auth.js';
import teamsRouter from './api/teams.js';
import presentationsRouter from './api/presentations.js';
import { optionalAuth } from './middleware/auth.js';

// Validate required environment in production
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable must be set in production');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set; using an insecure default (development only)');
}

const rawPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const PORT = Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 4000;
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/excalidraw-slides';

const app = express();

/* ── Security & parsing ── */
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

/* ── Rate limiting ── */
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

/* ── Optional auth for all routes ── */
app.use(optionalAuth);

/* ── Routes ── */
app.use('/api/auth', authRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/presentations', presentationsRouter);

/* ── Health ── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ── 404 ── */
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* ── Global error handler ── */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ── MongoDB + Start ── */
async function start(): Promise<void> {
  await mongoose.connect(MONGO_URI);
  console.log(`MongoDB connected: ${MONGO_URI}`);

  const httpServer = createServer(app);
  setupWebSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
