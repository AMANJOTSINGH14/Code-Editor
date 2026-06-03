# C# Best Practices — Exhaustive Code Review Guide

## Naming & Style

- Use `PascalCase` for classes, structs, interfaces, enums, methods, properties, events, and namespaces.
- Use `camelCase` for local variables and method parameters: `userName`, `orderTotal`.
- Prefix private fields with `_`: `_userId`, `_orderService`.
- Prefix interfaces with `I`: `IUserRepository`, `IOrderService`.
- Use `UPPER_SNAKE_CASE` for constants is NOT the C# convention — use `PascalCase`: `MaxRetries`, `DefaultTimeout`.
- Name booleans as assertions: `IsActive`, `HasPermission`, `CanDelete`.
- Avoid abbreviations unless universally understood (`id`, `url`, `dto`).
- Use `.editorconfig` and `StyleCop` / `Roslyn Analyzers` for style enforcement.
- Use `dotnet format` for automatic code formatting.
- Keep files focused — one primary type per file, named after the type.

## Modern C# (C# 8/9/10/11/12)

- Enable nullable reference types in `csproj`: `<Nullable>enable</Nullable>` — makes nullability explicit.
- Use `record` types for immutable data transfer objects: `record User(string Name, string Email);`.
- Use `record struct` for value-type records.
- Use `init`-only setters for immutable properties in classes: `public string Name { get; init; }`.
- Use `required` modifier (C# 11+) for properties that must be set at construction: `public required string Name { get; init; }`.
- Use pattern matching — `is` patterns, `switch` expressions, property patterns.
- Use `switch` expressions instead of `switch` statements where returning a value.
- Use top-level statements for minimal programs (C# 9+).
- Use global usings in `GlobalUsings.cs` for frequently used namespaces.
- Use file-scoped namespaces (C# 10+): `namespace Company.Project.Service;` — reduces nesting.
- Use `primary constructors` (C# 12+) for concise dependency injection.
- Use `collection expressions` (C# 12+): `List<int> nums = [1, 2, 3];`.

## Null Safety

- Enable nullable reference types — `string?` for nullable, `string` for non-nullable.
- Use `??` (null-coalescing operator): `var name = user.Name ?? "Guest"`.
- Use `?.` (null-conditional operator): `var city = user?.Address?.City`.
- Use `??=` (null-coalescing assignment): `_cache ??= new Dictionary<string, string>()`.
- Validate parameters with `ArgumentNullException.ThrowIfNull(param)` (C# 10+).
- Use `[NotNull]`, `[MaybeNull]`, `[NotNullIfNotNull]` attributes for nullable analysis.
- Avoid `null!` (null-forgiving) — it suppresses the null checker. Use only when you're certain.
- Return empty collections, not `null`, from collection-returning methods.
- Use `Nullable<T>` (or `T?`) for value types that may be absent.

## Properties & Fields

- Use properties over public fields — properties allow change in implementation.
- Use auto-properties when no logic is needed: `public string Name { get; set; }`.
- Use expression-bodied properties for simple computed values: `public string FullName => $"{First} {Last}";`.
- Use `private set` or `init` to restrict mutation: `public Guid Id { get; private set; }`.
- Use `required` for properties that must be set on object construction.
- Avoid exposing mutable collections as properties — return `IReadOnlyList<T>` or `IEnumerable<T>`.
- Don't expose internal list fields directly — use `AsReadOnly()` or a copy.

## LINQ

- Use LINQ for collection operations — prefer declarative over imperative loops.
- Use method syntax for most LINQ: `users.Where(u => u.IsActive).Select(u => u.Name)`.
- Use query syntax for complex joins or comprehensions.
- Avoid multiple enumerations — call `ToList()` or `ToArray()` to materialize before reuse.
- Use `FirstOrDefault()` instead of `First()` when the element may not exist.
- Use `SingleOrDefault()` when exactly one element is expected (or none).
- Avoid `Count()` to check for elements — use `Any()`: `if (list.Any())` not `if (list.Count() > 0)`.
- Use `Select` + `Where` instead of `foreach` + `if` for filtering and projecting.
- Use `Aggregate`, `GroupBy`, `Join`, `Zip` for complex transformations.
- Don't use LINQ in hot paths — it has overhead. Benchmark before using in performance-critical code.
- Use `IAsyncEnumerable<T>` with `await foreach` for async streaming data.

## Error Handling

- Use `try-catch` for recoverable errors; let unrecoverable errors propagate.
- Catch the most specific exception type — avoid bare `catch (Exception e)`.
- Never swallow exceptions silently: `catch (Exception) {}` — log at minimum.
- Create custom exception classes for domain errors: `class OrderNotFoundException : Exception`.
- Add meaningful messages to exceptions.
- Use `finally` or `using` for cleanup.
- Use `using` / `await using` for `IDisposable` / `IAsyncDisposable` resources.
- Use `ExceptionDispatchInfo` to re-throw without losing the stack trace.
- Use `ArgumentException`, `ArgumentNullException`, `InvalidOperationException` for precondition violations.
- Use `throw;` (not `throw e;`) to re-throw — preserves the original stack trace.

## Async/Await

- Use `async`/`await` for I/O-bound operations — don't block with `.Result` or `.Wait()`.
- Return `Task` from async methods, not `void` (except for event handlers).
- Return `ValueTask<T>` for high-performance async paths that frequently complete synchronously.
- Use `Task.WhenAll()` for concurrent independent async operations.
- Use `Task.WhenAny()` for racing tasks or timeout patterns.
- Use `CancellationToken` in all async methods: `async Task<User> GetUserAsync(int id, CancellationToken ct)`.
- Pass `CancellationToken` through the entire call chain.
- Use `ConfigureAwait(false)` in library code to avoid deadlocks.
- Don't use `async void` except for event handlers — exceptions are unobservable.
- Use `IAsyncEnumerable<T>` for async streaming with `yield return`.
- Use `SemaphoreSlim` for async-compatible locks — not `lock`.
- Never deadlock: don't call `.Result`/`.Wait()` on tasks in synchronous code that runs in a synchronization context.

## Dependency Injection

- Use constructor injection — it makes dependencies explicit and enables testing.
- Register services with appropriate lifetimes: `Transient`, `Scoped`, `Singleton`.
- Use `Scoped` for services that should be created once per HTTP request.
- Use `Singleton` for stateless or thread-safe services.
- Use `Transient` for lightweight, stateless services.
- Use `IOptions<T>` / `IOptionsSnapshot<T>` for typed configuration.
- Avoid service locator pattern (`IServiceProvider` injected directly) — it hides dependencies.
- Use `IServiceCollection` extension methods for registering related services.
- Use `Keyed services` (C# / .NET 8+) for registering multiple implementations of the same interface.

## Classes, Structs & Records

- Use `class` for reference semantics, identity, or when inheritance is needed.
- Use `struct` for small, value-type data without inheritance — keeps it stack-allocated.
- Use `record` for immutable data models — gives `Equals`, `GetHashCode`, `ToString`, and `with` for free.
- Use `record struct` for value-type records.
- Use `sealed` on classes not intended for inheritance — enables compiler optimizations.
- Implement `IEquatable<T>` on structs/classes that compare by value.
- Use `with` expressions on records to create modified copies: `var updated = original with { Name = "Bob" }`.
- Override `Equals()` and `GetHashCode()` together when implementing value equality.

## Collections & Generics

- Use `List<T>`, `Dictionary<TKey, TValue>`, `HashSet<T>` from `System.Collections.Generic`.
- Use `IReadOnlyList<T>`, `IReadOnlyDictionary<TKey, TValue>` for read-only return types.
- Use `IEnumerable<T>` for parameters that only need iteration.
- Use `Span<T>` and `Memory<T>` for zero-copy, high-performance buffer operations.
- Use `ArrayPool<T>` to rent buffers instead of allocating large arrays.
- Use `ImmutableList<T>`, `ImmutableDictionary<TKey, TValue>` (System.Collections.Immutable) for thread-safe immutable collections.
- Use `ConcurrentDictionary<TKey, TValue>` for thread-safe concurrent access.
- Initialize collections with expected capacity: `new List<T>(expectedCount)`.
- Use `CollectionsMarshal.GetValueRefOrAddDefault()` for high-performance dictionary access.

## Testing

- Use xUnit, NUnit, or MSTest for testing (xUnit is most popular in .NET ecosystem).
- Use FluentAssertions for readable assertions: `result.Should().Be(expected)`.
- Use Moq or NSubstitute for mocking dependencies.
- Follow AAA pattern: Arrange, Act, Assert.
- Name tests: `MethodName_Scenario_ExpectedBehavior()` or `Should_ExpectedBehavior_When_Scenario()`.
- Use `[Theory]` + `[InlineData]` / `[MemberData]` for data-driven tests (xUnit).
- Use `IClassFixture<T>` for expensive shared setup in xUnit.
- Use `CancellationToken` in async tests and set reasonable timeouts.
- Use `WebApplicationFactory<T>` for integration tests in ASP.NET Core.
- Use `TestContainers.NET` for integration tests with real databases.
- Mock `ILogger<T>` in unit tests — don't let logs interfere with test output.

## Performance

- Use `Span<T>` and `Memory<T>` for slice-based buffer processing — no heap allocations.
- Use `StringBuilder` for string concatenation in loops.
- Use `string.Create()` or `stackalloc` for hot-path string/buffer building.
- Use `ArrayPool<T>` to avoid large heap allocations.
- Use `ValueTask<T>` for frequently synchronous async paths.
- Minimize boxing — avoid passing value types as `object`.
- Use `readonly struct` for small value types to prevent defensive copies.
- Use `struct` and `ref struct` to keep data on the stack.
- Use `BenchmarkDotNet` for accurate micro-benchmarks.
- Profile with dotTrace, dotMemory, or PerfView before optimizing.
- Use `System.IO.Pipelines` for high-throughput I/O processing.
- Use `source generators` to move reflection-based code to compile time.

## Security

- Validate all inputs — use Data Annotations or FluentValidation.
- Use parameterized queries or EF Core — never string-concatenated SQL.
- Hash passwords with BCrypt.Net or ASP.NET Core's `PasswordHasher<T>`.
- Use `RandomNumberGenerator.GetBytes()` for cryptographic random values — never `Random`.
- Use `System.Security.Cryptography` for all cryptographic operations.
- Store secrets in Azure Key Vault, AWS Secrets Manager, or environment variables — never in code.
- Use ASP.NET Core's Data Protection API for encrypting/decrypting application data.
- Apply HTTPS redirection and HSTS in ASP.NET Core middleware.
- Use `Content-Security-Policy` and other security headers.
- Don't log sensitive data — passwords, tokens, PII.
- Keep NuGet packages updated — use Dependabot or OWASP Dependency-Check.

## Code Review Checklist

- Are nullable reference types enabled and respected?
- Is `using` / `await using` applied to all `IDisposable` / `IAsyncDisposable` resources?
- Are async methods using `async`/`await` — not `.Result` or `.Wait()`?
- Is `CancellationToken` threaded through all async calls?
- Are `catch` blocks handling specific exception types?
- Is constructor injection used over service locator?
- Are LINQ queries materialized before multiple enumeration?
- Are `record` types used for immutable data models?
- Is `IReadOnlyList<T>` used for collection return types?
- Are SQL queries parameterized?
- Are passwords hashed with BCrypt / `PasswordHasher`?
- Are tests following AAA with descriptive names?
- Are private fields prefixed with `_`?
- Is `ConfigureAwait(false)` used in library code?
