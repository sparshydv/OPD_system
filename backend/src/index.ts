/**
 * Application entry point
 */
import { createApp } from './app';

const PORT = process.env.PORT || 3000;

async function startServer(): Promise<void> {
  try {
    const app = createApp();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
