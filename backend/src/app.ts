/**
 * Express application factory
 * Sets up middleware and routes
 */
import express, { Express } from 'express';
import cors from 'cors';
import tokenRoutes from './routes/allocations';

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check route
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API v1 routes
  app.use('/api/v1', tokenRoutes);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  return app;
}
