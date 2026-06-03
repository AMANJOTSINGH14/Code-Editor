# Node.js Best Practices — Exhaustive Code Review Guide

## Architecture & Project Structure

- Use layered architecture: routes → controllers → services → data access. Never put business logic in controllers or routes.
- Separate configuration from code — use environment variables with validation (Zod, Joi, convict).
- Use a single entry point (`server.js`) that wires up the app, starts listening, and handles graceful shutdown.
- Split the Express app (`app.js`) from the server (`server.js`) so you can import the app for testing without starting a listener.
- Group files by feature/domain, not by type (e.g., `users/` not `controllers/`, `models/`, `routes/`).
- Keep `node_modules` out of version control. Use `.gitignore`.
- Use `.env` files for local dev only; use real environment variables or secrets managers in production.
- Never hardcode secrets, API keys, or connection strings in source code.

## Error Handling

- Always handle errors — unhandled promise rejections terminate Node.js v15+.
- Use centralized error-handling middleware in Express: `app.use((err, req, res, next) => {...})`.
- Create custom error classes: `class AppError extends Error { constructor(message, statusCode, code) {...} }`.
- Distinguish between operational errors (expected, like 404) and programmer errors (bugs, like TypeError).
- Operational errors: send appropriate HTTP status and message to client.
- Programmer errors: log full stack, return 500 to client, consider restarting the process.
- Use `express-async-errors` or wrap async handlers: `const asyncHandler = fn => (req, res, next) => fn(req, res, next).catch(next);`.
- Never ignore errors in callbacks: always check the `err` parameter first.
- Use `process.on('uncaughtException')` and `process.on('unhandledRejection')` as safety nets — log and exit.
- Don't use `try/catch` around every line — use it at operation boundaries (route handler, service method).
- Include contextual info in errors: user ID, request path, input that caused failure.
- Use error codes (e.g., `'USER_NOT_FOUND'`, `'VALIDATION_ERROR'`) for programmatic handling.
- Log errors with structured data (JSON), not just `console.error(err.message)`.
- Use `Error.cause` for wrapping errors: `throw new AppError('Failed', 500, { cause: originalError })`.
- Never expose stack traces or internal details to API clients in production.

## Security

- Use `helmet` middleware for secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.).
- Use `cors` middleware with explicit origin whitelist — never use `cors({ origin: '*' })` with credentials.
- Rate-limit all endpoints — especially auth, registration, and API routes. Use `express-rate-limit` or Redis-backed sliding windows.
- Validate and sanitize all input with schema validation (Zod, Joi, express-validator). Never trust `req.body`, `req.query`, or `req.params`.
- Use parameterized queries for all database operations — never concatenate user input into queries.
- For MongoDB, guard against NoSQL injection: reject objects in string fields, use `$eq` explicitly.
- Hash passwords with `bcrypt` (cost factor 10-12) or `argon2`. Never store plain text or MD5/SHA hashes.
- Use JWT with short expiry (15 minutes access token) and refresh tokens in HttpOnly, Secure, SameSite cookies.
- Never store JWTs in localStorage — vulnerable to XSS.
- Use HttpOnly cookies for refresh tokens — inaccessible to JavaScript.
- Set `Secure` flag on cookies in production (HTTPS only). Set `SameSite=Lax` or `Strict`.
- Implement CSRF protection for cookie-based auth or use token-based auth with Authorization header.
- Use `crypto.timingSafeEqual()` for comparing secrets — prevents timing attacks.
- Use `crypto.randomUUID()` or `crypto.randomBytes()` for tokens and IDs — never `Math.random()`.
- Limit request body size: `express.json({ limit: '1mb' })`.
- Validate `Content-Type` headers — reject unexpected types.
- Use `express.urlencoded({ extended: false })` to prevent prototype pollution via `qs`.
- Never use `eval()`, `vm.runInNewContext()`, or `child_process.exec()` with user input.
- Keep dependencies updated — run `npm audit` regularly.
- Use `--frozen-lockfile` in CI to prevent lockfile manipulation.
- Use `.npmrc` with `ignore-scripts=true` to prevent malicious install scripts.

## Performance

- Use `cluster` module or PM2 cluster mode to utilize all CPU cores.
- Use connection pooling for databases (Mongoose default pool is 5; increase for high concurrency).
- Cache frequently accessed data with Redis or in-memory LRU caches.
- Use cache TTLs — never cache indefinitely without eviction.
- Invalidate caches explicitly when data changes.
- Use streaming (`stream.pipe()`, `pipeline()`) for large files — never load entire files into memory.
- Use `Buffer.allocUnsafe()` only when you'll immediately fill the buffer; use `Buffer.alloc()` for zero-initialized buffers.
- Avoid synchronous functions in production: `fs.readFileSync`, `crypto.pbkdf2Sync`, `JSON.parse` on huge strings. Use async versions.
- Use `worker_threads` for CPU-intensive tasks (image processing, compression, crypto).
- Set appropriate timeouts on HTTP clients, database connections, and external service calls.
- Use `compression` middleware for gzip/brotli — but prefer a reverse proxy (nginx) for this.
- Enable HTTP/2 for multiplexed connections.
- Use `304 Not Modified` responses with ETags for static and cacheable API responses.
- Use `setImmediate()` to break up CPU-heavy synchronous work and allow I/O to proceed.
- Monitor event loop lag with `monitorEventLoopDelay()` — lag > 100ms indicates blocking.
- Profile with `--prof`, `--inspect`, or `clinic.js` before optimizing.
- Use `fastify` instead of Express for maximum throughput in performance-critical services.

## Database (MongoDB/Mongoose)

- Always define schemas with strict types and validation.
- Use `required: true` on mandatory fields.
- Add indexes for fields used in queries: `schema.index({ email: 1 }, { unique: true })`.
- Use compound indexes for queries filtering on multiple fields.
- Use `.lean()` for read-only queries — returns plain objects instead of Mongoose documents, ~5x faster.
- Use `.select('field1 field2')` to fetch only needed fields — reduces data transfer.
- Use `.populate()` sparingly — it causes additional queries. Prefer embedding for small, bounded data.
- Use `$projection` in aggregation for performance.
- Use transactions for multi-document writes that must be atomic.
- Handle duplicate key errors (`error.code === 11000`) explicitly.
- Use `schema.pre('save')` hooks for validation/transformation, not for business logic.
- Paginate large queries: use `.skip()` and `.limit()` or cursor-based pagination with `_id > lastId`.
- Never use `.find()` without limits on large collections — it can return millions of documents.
- Use `updateOne`/`updateMany` with `$set`, `$push`, etc. — avoid fetching, modifying, and saving.
- Use `bulkWrite()` for batch operations — much faster than individual operations.
- Set connection pool size based on concurrency: `mongoose.connect(uri, { maxPoolSize: 10 })`.
- Handle connection errors and reconnection: `mongoose.connection.on('error', ...)`.
- Use TTL indexes for auto-expiring documents (sessions, tokens).

## API Design

- Use RESTful conventions: `GET /users`, `POST /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id`.
- Return consistent response shapes: `{ success: true, data: {...} }` or `{ success: false, error: { message, code } }`.
- Use appropriate HTTP status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.
- Use `PATCH` for partial updates, `PUT` for full replacements.
- Use query parameters for filtering, sorting, pagination: `?page=1&limit=20&sort=-createdAt`.
- Version your API: `/api/v1/users`.
- Return `Location` header on resource creation (201).
- Use `204 No Content` for successful DELETE operations.
- Validate request bodies against schemas before processing.
- Document API endpoints with OpenAPI/Swagger.
- Use cursor-based pagination for real-time or large datasets — offset pagination is slow at high offsets.

## Logging & Monitoring

- Use structured logging (JSON format) with Winston, Pino, or Bunyan — never `console.log` in production.
- Log at appropriate levels: `error` for failures, `warn` for degraded state, `info` for business events, `debug` for development.
- Include correlation IDs in logs for request tracing across services.
- Log request method, path, status code, response time for HTTP access logs.
- Never log sensitive data: passwords, tokens, credit card numbers, PII.
- Use log aggregation (ELK stack, Datadog, CloudWatch) in production.
- Monitor key metrics: response time (p50, p95, p99), error rate, throughput, event loop lag, memory usage.
- Set up health check endpoints: `GET /health` returning 200 with uptime, memory, db connection status.
- Use APM tools (Datadog APM, New Relic, OpenTelemetry) for distributed tracing.
- Alert on error rate spikes, high latency, memory leaks, and process restarts.

## Process Management & Deployment

- Use a process manager: PM2 or Docker with restart policies.
- Implement graceful shutdown: handle `SIGTERM`/`SIGINT`, stop accepting new connections, finish in-flight requests, close DB connections, then exit.
- Use Docker for consistent environments — multi-stage builds for smaller images.
- Run as non-root user in Docker: `USER node`.
- Use `.dockerignore` to exclude `node_modules`, `.git`, tests, docs.
- Use `NODE_ENV=production` in production — enables optimizations in Express and other libraries.
- Pin dependency versions in production — use `package-lock.json` and `npm ci`.
- Use health checks in Docker: `HEALTHCHECK CMD curl -f http://localhost:3000/health`.
- Implement zero-downtime deployments with rolling updates or blue-green deployments.
- Use `--max-old-space-size` to set memory limits for the V8 heap.
- Monitor and restart on memory leaks — set memory limits in Docker/K8s.

## File System & Streams

- Always use async fs methods: `fs.promises.readFile()` or `fs/promises`.
- Use streams for large files: `fs.createReadStream()` piped to `res` for file downloads.
- Use `pipeline()` from `stream/promises` instead of `.pipe()` — it handles errors and cleanup.
- Set appropriate file permissions: never `0777`. Use `0644` for files, `0755` for directories.
- Validate file paths — prevent path traversal attacks: `path.resolve()` and check that resolved path is within allowed directory.
- Use `os.tmpdir()` for temporary files.
- Clean up temp files after use.
- Use `fs.watch()` or `chokidar` for file watching — `fs.watchFile()` uses polling and is slower.

## WebSockets & Real-time

- Use Socket.io or `ws` library for WebSocket connections.
- Authenticate WebSocket connections — validate JWT in the handshake.
- Use rooms/namespaces to scope broadcasts.
- Implement heartbeat/ping-pong to detect stale connections.
- Handle reconnection with exponential backoff on the client.
- Use Redis pub/sub adapter for horizontal scaling (multiple server instances).
- Limit message size and rate — prevent abuse.
- Always handle `disconnect` events for cleanup (presence, timers).
- Send structured messages with event names and payloads.

## Testing

- Use Jest or Vitest for unit tests; Supertest for HTTP integration tests.
- Use in-memory databases (mongodb-memory-server) for integration tests — faster and isolated.
- Mock external services (APIs, Redis, email) in tests.
- Test happy paths, error paths, edge cases, and authorization.
- Use `beforeEach`/`afterEach` for setup/teardown — clean database between tests.
- Test middleware independently with mock `req`, `res`, `next`.
- Test WebSocket handlers with real socket connections (socket.io-client).
- Aim for >80% coverage on critical paths (auth, payments, data mutation).
- Use CI to run tests on every push — fail the build on test failures.
- Use `--forceExit` and `--detectOpenHandles` to find test leaks.

## CommonJS vs ESM

- New projects should use ESM (`"type": "module"` in `package.json`).
- Use `import`/`export` syntax in ESM; `require`/`module.exports` in CJS.
- ESM `import` is statically analyzed — enables tree shaking.
- CJS `require()` is synchronous and cached — safe to call conditionally.
- Dynamic `import()` works in both CJS and ESM — returns a Promise.
- Some packages are ESM-only (e.g., `nanoid@5`, `node-fetch@3`) — can't be `require()`d in CJS.
- Use `createRequire(import.meta.url)` to use `require()` in ESM modules.
- `__dirname` and `__filename` don't exist in ESM — use `import.meta.url` with `fileURLToPath()`.
- Getters in `module.exports` (e.g., `get client() { return client; }`) are evaluated at access time — destructuring captures the value at import time, which may be `null` if initialization is deferred.

## Optimization Tips

- Use `Buffer.byteLength(str)` to get actual byte length of strings — `str.length` gives character count (misleading for multi-byte).
- Use `JSON.stringify()` with replacer for selective serialization — avoid sending unnecessary data.
- Use `setImmediate()` instead of `setTimeout(fn, 0)` — it's executed after I/O events, not after timer phase.
- Use `Promise.all()` for concurrent I/O operations — sequential awaits waste time.
- Use `stream.pipeline()` for safe piping with automatic error handling and cleanup.
- Use `http.Agent` with `keepAlive: true` for connection reuse to external services.
- Precompute and cache regex, JSON schemas, and other expensive initialization.
- Use `zlib` streams for compression — `createGzip()` for response compression.
- Use `dns.lookup()` caching or `cacheable-lookup` to reduce DNS resolution overhead.
- Avoid `JSON.parse()` on untrusted large input without size limits — it blocks the event loop.
- Use `AsyncLocalStorage` for request-scoped context (correlation IDs, user context) without passing through every function.
