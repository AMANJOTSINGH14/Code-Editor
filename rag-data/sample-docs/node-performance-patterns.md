# Node Performance Patterns

- Reuse database connections; avoid reconnecting per request.
- Use pagination for large collections; never fetch unbounded lists.
- Cache metadata separately from large blobs or snapshots.
- Apply backpressure for streams to prevent memory spikes.
- Use Redis for rate limiting and short-lived caches.
- Prefer async I/O; avoid CPU-heavy work on the event loop.
- Instrument slow operations with structured logs and timings.
