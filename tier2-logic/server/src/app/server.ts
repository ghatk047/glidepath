import { startServer } from './start';

/** Entry point of `dist/server.js` (`node dist/server.js`, listens on PORT, default 8080). */
startServer().then(
  (server) => {
    const shutdown = (signal: string) => {
      server.logger.info('shutting down', { signal });
      server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  },
  (err: unknown) => {
    // Config errors list variable names only, never values.
    const message = err instanceof Error ? err.message : 'startup failed';
    process.stderr.write(`${JSON.stringify({ level: 'fatal', time: new Date().toISOString(), msg: message })}\n`);
    process.exit(1);
  },
);
