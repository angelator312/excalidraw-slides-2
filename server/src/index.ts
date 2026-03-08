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
import adminRouter from './api/admin.js';
import librariesRouter from './api/libraries.js';
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
  message: { error: 'Too many requests, please try again later' },
}));

/* ── Stricter rate limit for invite generation ── */
app.use('/api/admin/invite', rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite requests, please try again later' },
}));

/* ── Optional auth for all routes ── */
app.use(optionalAuth);

/* ── Routes ── */
app.use('/api/auth', authRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/presentations', presentationsRouter);
app.use('/api/presentations/:id/libraries', librariesRouter);
app.use('/api/admin', adminRouter);

/* ── Health ── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ── Static files (production build) + SPA fallback ── */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = join(__dirname, '../../../dist');
app.use(express.static(CLIENT_DIST));
// Serve index.html for all non-API routes so client-side routing works
// (e.g. /presentation/:id navigates correctly on direct load / refresh)
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) {
      // In development the dist folder may not exist — that's fine, Vite handles it
      res.status(404).json({ error: 'Not found' });
    }
  });
});

/* ── 404 (API-only catch-all) ── */
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
