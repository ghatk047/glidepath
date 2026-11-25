# Server composition (API-09)

What `app/start.ts` wires beyond the app itself.

| File | What |
|---|---|
| `queue.ts` | `createJobQueue({ databaseUrl, schema })`: the server's pg-boss client. `enqueue(queue, payload)` sends; `run(queue, payload)` sends and polls `getJobById` until the output (a failed job rejects with the handler's `name`, `code`, `message`). Direct `DATABASE_URL` (libpq sslmode via `connectionConfig`), so Neon and pgbouncer work: single statements, no session state. Never installs or migrates the schema (the migrate step and the worker do) and runs no maintenance. Connects on first use; a missing schema or unreachable database is a 503 (`QueueUnavailableError`), retried on the next job, so the server still starts without it. |
| `excel-jobs.ts` | `excelJobsOverQueue(queue)`: API-10's `ExcelJobs` port on `excel.export` / `excel.import` / `excel.apply`. Export and apply await the job; `startImport` sends and returns. |

`startServer` creates one `dbScenarioLoader` for the WebSocket hub and the quick solver runs, the queue (`JOB_QUEUE_SCHEMA`, default `pgboss`; `StartOverrides.queue` replaces it in tests), `createSolverSubmitter` on it, the JOB-02 relay (`JOB_RELAY_POLL_MS`, started after listening, stopped first on shutdown) and the Excel deps (`PostgresObjectStore`, `importMaxBytes(env)` from `IMPORT_MAX_BYTES`). Shutdown: relay, sessions, HTTP server, queue, auth, pool.
