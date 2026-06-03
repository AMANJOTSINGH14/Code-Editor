# Go (Golang) Best Practices — Exhaustive Code Review Guide

## Naming & Style

- Follow the Go convention: `MixedCaps` or `mixedCaps`, never underscores in names.
- Exported names start with uppercase: `func ProcessOrder()`. Unexported names start with lowercase: `func validateInput()`.
- Package names are lowercase, single-word, no underscores: `package http`, not `package httpUtil`.
- Avoid stutter: `http.Client`, not `http.HTTPClient`. Don't repeat the package name in the type name.
- Interface names should be `-er` suffixes for single-method interfaces: `Reader`, `Writer`, `Closer`, `Stringer`.
- Use short variable names in small scopes: `r` for reader, `w` for writer, `ctx` for context, `err` for error.
- Use descriptive names in larger scopes — clarity over brevity.
- Acronyms should be all caps: `HTTPClient`, `XMLParser`, `ID`, `URL`, not `HttpClient`, `XmlParser`, `Id`, `Url`.
- Use `MustXxx` for functions that panic on error (used in init/setup only): `regexp.MustCompile()`.
- Boolean variables/functions: `isReady`, `hasAccess`, `canDelete` — or just `ready`, `valid`, `empty`.
- Constants use `MixedCaps`: `MaxRetries`, not `MAX_RETRIES` (Go convention, not C convention).
- Use `gofmt` or `goimports` — non-negotiable. All Go code must be formatted.
- Use `golangci-lint` with multiple linters enabled for comprehensive static analysis.

## Error Handling

- Always check errors — never ignore the `error` return value. `result, err := doSomething(); if err != nil { ... }`.
- Handle errors immediately after the call — don't defer error checking.
- Return errors, don't panic. `panic` is for unrecoverable programmer errors, not operational failures.
- Wrap errors with context: `fmt.Errorf("failed to process order %d: %w", orderID, err)`.
- Use `%w` verb for wrapping (enables `errors.Is` and `errors.As` on the chain).
- Use `errors.Is(err, target)` for sentinel error comparison — works through wrapped errors.
- Use `errors.As(err, &target)` to extract typed errors from the chain.
- Define sentinel errors as package-level variables: `var ErrNotFound = errors.New("not found")`.
- Define error types for errors that carry data: `type ValidationError struct { Field, Message string }`.
- Implement `Error() string` method on custom error types.
- Don't use `log.Fatal()` in library code — it calls `os.Exit()` and prevents cleanup.
- Return the zero value along with the error: `return 0, fmt.Errorf("...")`, `return nil, err`.
- Don't use `errors.New()` for formatted errors — use `fmt.Errorf()`.
- Don't log and return the same error — do one or the other (usually return).
- Use `defer` for cleanup that must happen regardless of error path.
- Consider using `Result` pattern (custom type) for complex error handling flows.

## Concurrency

- Don't communicate by sharing memory; share memory by communicating — use channels.
- Goroutines are cheap — but not free. Always ensure goroutines can exit (use context cancellation, done channels).
- Always use `sync.WaitGroup` or channels to wait for goroutines to complete.
- Use `context.Context` for cancellation, deadlines, and request-scoped values.
- Pass `context.Context` as the first parameter of functions: `func ProcessOrder(ctx context.Context, id int) error`.
- Check `ctx.Done()` in long-running loops: `select { case <-ctx.Done(): return ctx.Err(); default: ... }`.
- Use `sync.Mutex` for protecting shared state. Use `sync.RWMutex` when reads far exceed writes.
- Lock and unlock in the same function — use `defer mu.Unlock()` immediately after `mu.Lock()`.
- Never copy a `sync.Mutex` — embed it or use a pointer.
- Use `sync.Once` for one-time initialization: `var once sync.Once; once.Do(func() { ... })`.
- Use `sync.Pool` for reusing expensive objects (buffers, connections).
- Use buffered channels when the producer and consumer run at different rates.
- Use unbuffered channels for synchronization — both goroutines must be ready.
- Close channels from the sender side only — never the receiver. Closing a closed channel panics.
- Use `select` with `default` for non-blocking channel operations.
- Use `select` with multiple cases for multiplexing channels.
- Use `errgroup.Group` from `golang.org/x/sync/errgroup` for concurrent operations with error propagation.
- Use `semaphore.Weighted` for limiting concurrency.
- Use `-race` flag during testing and development: `go test -race ./...`.
- Avoid goroutine leaks — every goroutine must have a way to terminate.

## Interfaces

- Keep interfaces small — one or two methods. Go interfaces are implicitly satisfied.
- Define interfaces where they're used (consumer), not where they're implemented (producer).
- Accept interfaces, return concrete types.
- Don't create interfaces for a single implementation — only when you have multiple implementations or need mocking.
- Use `io.Reader`, `io.Writer`, `io.Closer` — the standard library interfaces are well-designed. Compose them: `io.ReadWriteCloser`.
- Use the empty interface `interface{}` (or `any` in Go 1.18+) sparingly — it loses type safety.
- Use type assertions with the comma-ok pattern: `value, ok := i.(string)`.
- Use type switches for handling multiple types: `switch v := i.(type) { case string: ... }`.
- Test interface satisfaction at compile time: `var _ Interface = (*Struct)(nil)`.
- Use `fmt.Stringer` interface (`String() string`) for custom string representation.

## Structs & Types

- Use struct literals with field names: `User{Name: "Alice", Age: 30}`, not positional `User{"Alice", 30}`.
- Use pointer receivers for methods that mutate the receiver or for large structs.
- Use value receivers for immutable operations on small structs.
- Be consistent — if one method has a pointer receiver, all methods on that type should.
- Use `struct{}` (empty struct) for set implementations: `map[string]struct{}` — zero memory per entry.
- Use type aliases for domain clarity: `type UserID int64`, `type Email string`.
- Use `json` struct tags for API serialization: `` `json:"name,omitempty"` ``.
- Use embedded structs for composition: `type Admin struct { User; Permissions []string }`.
- Don't export struct fields unless they need to be accessed outside the package.
- Use constructor functions: `func NewServer(addr string, opts ...Option) *Server`.
- Use the functional options pattern for configurable constructors: `func WithTimeout(d time.Duration) Option`.

## Generics (Go 1.18+)

- Use generics for type-safe data structures and algorithms.
- Use type constraints to limit type parameters: `func Max[T constraints.Ordered](a, b T) T`.
- Define custom constraints with interfaces: `type Number interface { int | float64 }`.
- Use `comparable` constraint for types that support `==` and `!=`.
- Use `any` instead of `interface{}` in generic code.
- Don't overuse generics — most Go code doesn't need them. Use concrete types when possible.
- Avoid complex generic constraints — keep them simple and readable.

## Testing

- Use `testing.T` for unit tests, `testing.B` for benchmarks, `testing.F` for fuzzing.
- Name test functions `TestXxx(t *testing.T)` — the `Xxx` part must start with uppercase.
- Use table-driven tests for testing multiple inputs: `tests := []struct{ name string; input int; expected int }{ ... }`.
- Use `t.Run(name, func(t *testing.T))` for subtests — enables selective test running.
- Use `t.Parallel()` for tests that can run concurrently.
- Use `t.Helper()` in test helper functions for correct error line reporting.
- Use `t.Cleanup(func())` for cleanup instead of `defer` — runs even if test panics.
- Use `testify/assert` or `testify/require` for readable assertions.
- Use `httptest.NewServer()` for testing HTTP handlers.
- Use `httptest.NewRecorder()` for testing handler responses without a server.
- Use `t.TempDir()` for temporary directories — auto-cleaned after test.
- Use build tags for integration tests: `//go:build integration`.
- Use `go test -cover` for coverage reports.
- Use `go test -race` to detect race conditions.
- Use `go test -fuzz` for fuzz testing (Go 1.18+).
- Mock interfaces with hand-written mocks or `gomock`/`mockgen`.

## Standard Library

- Use `net/http` for HTTP servers and clients — it's production-ready.
- Use `http.Client` with timeouts: `&http.Client{Timeout: 10 * time.Second}`.
- Always close `resp.Body`: `defer resp.Body.Close()`.
- Use `context.WithTimeout` for request-scoped deadlines.
- Use `encoding/json` with struct tags for JSON serialization.
- Use `json.Decoder` for streaming JSON; `json.Unmarshal` for small payloads.
- Use `time.Duration` for durations, not integers. `5 * time.Second`, not `5000`.
- Never use `time.Sleep` in production code (except for testing/debugging) — use timers or tickers.
- Use `filepath` for OS-specific paths, `path` for URL paths.
- Use `strings.Builder` for efficient string concatenation in loops.
- Use `strconv` for string-to-number conversion — never `fmt.Sprintf` for simple conversions.
- Use `sort.Slice()` for sorting: `sort.Slice(users, func(i, j int) bool { return users[i].Age < users[j].Age })`.
- Use `slices` package (Go 1.21+) for slice operations: `slices.Sort()`, `slices.Contains()`.
- Use `maps` package (Go 1.21+) for map operations.
- Use `slog` (Go 1.21+) for structured logging.
- Use `log/slog` with JSON handler for production logging.

## Performance

- Profile before optimizing: use `pprof` for CPU and memory profiling.
- Use `sync.Pool` for frequently allocated objects (buffers, structs).
- Preallocate slices with `make([]T, 0, expectedCap)` when the size is known.
- Preallocate maps with `make(map[K]V, expectedSize)`.
- Use `strings.Builder` for string concatenation — avoid `+` in loops.
- Use value types for small structs (< 64 bytes) to avoid heap allocation.
- Use `[]byte` for mutable string operations — avoid string-to-byte-slice conversions in loops.
- Use `binary.Read`/`binary.Write` for binary protocols — avoid manual byte manipulation.
- Use `io.Copy` for transferring data between readers and writers — it uses a buffer.
- Use `bufio.Scanner` for line-by-line file reading.
- Avoid `reflect` in hot paths — it's slow. Use type switches or code generation.
- Use `unsafe.Sizeof()` to understand memory layout — but avoid `unsafe` in production.
- Use benchmarks (`testing.B`) to measure before and after optimization.
- Use escape analysis: `go build -gcflags='-m'` to see what escapes to heap.

## Security

- Validate all external input — query params, headers, request bodies.
- Use `html/template` for HTML output — it auto-escapes. Never use `text/template` for HTML.
- Use parameterized queries for SQL: `db.Query("SELECT * FROM users WHERE id = $1", id)`.
- Use `crypto/rand` for secure random numbers — never `math/rand` for security.
- Use `bcrypt` or `argon2` for password hashing — never MD5 or SHA for passwords.
- Use `crypto/subtle.ConstantTimeCompare()` for comparing secrets.
- Set timeouts on HTTP servers: `ReadTimeout`, `WriteTimeout`, `IdleTimeout`.
- Limit request body size: `http.MaxBytesReader(w, r.Body, maxBytes)`.
- Use TLS for all network communication.
- Don't log sensitive data — passwords, tokens, PII.
- Use `go vet` and `staticcheck` for catching security issues.

## Project Structure

- Use the standard Go project layout: `cmd/`, `internal/`, `pkg/` (if needed).
- Use `internal/` for packages that should not be imported by other modules.
- Use `cmd/appname/main.go` for application entry points.
- Keep `main()` minimal — it should wire dependencies and start the app.
- Use dependency injection — pass dependencies as function/struct parameters, not globals.
- Avoid `init()` functions — they make code hard to test and reason about.
- Use `go.mod` and `go.sum` for dependency management — commit both.
- Use semantic versioning for module versions.
- Run `go mod tidy` to clean up unused dependencies.

## Clean Code

- Write godoc comments for all exported types, functions, and constants.
- Comments start with the name of the thing being documented: `// ProcessOrder handles order processing.`
- Don't comment the obvious — comment the why, not the what.
- Keep functions short — under 50 lines. Extract helper functions.
- Return early to reduce nesting — use guard clauses.
- Avoid `else` after `return`: `if err != nil { return err } // continue` not `if err != nil { return err } else { ... }`.
- Use `switch` over `if-else` chains with more than 2 branches.
- Group related declarations: `var (...)`, `const (...)`, `type (...)`.
- Order: constants, types, variables, init, exported functions, unexported functions.
- Use meaningful variable names — `userCount` not `n`, `orderTotal` not `t` (except in tiny scopes).

## Optimization Tips

- Use `sync.Pool` for high-frequency allocations — recycles objects to reduce GC pressure.
- Use `bytes.Buffer` or `strings.Builder` for building strings/bytes in loops — never `s += chunk`.
- Use `map[string]struct{}` for sets — `struct{}` uses zero bytes.
- Channel direction annotations (`chan<-`, `<-chan`) document intent and catch bugs at compile time.
- Use `context.WithCancel` to stop goroutines early when results are no longer needed.
- Use `io.LimitReader` to prevent reading unbounded data.
- Avoid `interface{}` / `any` where concrete types work — interfaces have overhead from indirection.
- Use `encoding/binary` for fixed-size data instead of `encoding/json` — much faster.
- Use `GOGC` environment variable to tune GC frequency — higher values reduce GC overhead at the cost of memory.
- Profile memory with `runtime.MemStats` or `pprof` heap profile.
- Use connection pooling for database and HTTP clients — Go's `sql.DB` and `http.Client` pool by default.
- Batch database operations — use `INSERT INTO ... VALUES (...), (...), (...)` instead of individual inserts.

## Code Review Checklist

- Is every error checked and handled appropriately?
- Are goroutines properly managed (waitgroups, context cancellation, no leaks)?
- Is `context.Context` passed through the call chain?
- Are interfaces small and defined at the consumer?
- Are exported names documented with godoc comments?
- Is the code formatted with `gofmt`?
- Are tests written with table-driven patterns?
- Is `defer` used for cleanup (file close, mutex unlock)?
- Are concurrent accesses to shared state protected (mutex or channels)?
- Are timeouts set on HTTP clients and servers?
- Is input validated at boundaries?
- Are SQL queries parameterized?
- Is the code free of race conditions (`go test -race`)?
- Are dependencies minimal and well-maintained?
