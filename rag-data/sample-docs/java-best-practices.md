# Java Best Practices — Exhaustive Code Review Guide

## Naming & Style

- Use `camelCase` for variables and methods: `userName`, `calculateTotal()`.
- Use `PascalCase` for classes, interfaces, enums, and annotations: `UserService`, `OrderStatus`.
- Use `UPPER_SNAKE_CASE` for constants: `MAX_RETRIES`, `DEFAULT_TIMEOUT`.
- Package names are lowercase, dot-separated, reverse domain: `com.company.project.service`.
- Interface names describe capability, not implementation: `Readable`, `OrderProcessor`, not `IOrderProcessor`.
- Avoid abbreviations unless universally understood (`id`, `url`, `db`).
- Boolean variables/methods: `isActive`, `hasPermission`, `canDelete`.
- Use `get`/`set` prefixes for accessors: `getName()`, `setName(String name)`.
- Follow Google Java Style Guide or Oracle Code Conventions consistently.
- Use `checkstyle` or `spotless` for automatic formatting enforcement.
- Use `PMD`, `SpotBugs`, or `SonarQube` for static analysis.

## OOP Principles

- Follow SOLID: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion.
- Prefer composition over inheritance — use interfaces and delegation.
- Code to interfaces, not implementations: `List<String> list = new ArrayList<>()`.
- Keep classes small and focused — a class with more than 300 lines likely violates SRP.
- Use `final` on classes that should not be subclassed.
- Use `final` on variables and parameters that should not be reassigned.
- Use `private` fields — expose state only through well-defined methods.
- Override `equals()` and `hashCode()` together — always. Use `Objects.equals()` and `Objects.hash()`.
- Override `toString()` for meaningful debug output.
- Use `Comparable<T>` for natural ordering; `Comparator<T>` for external ordering.

## Modern Java (Java 8/11/17/21)

- Use lambdas for functional interfaces: `list.forEach(item -> process(item))`.
- Use method references when cleaner: `list.forEach(this::process)`.
- Use `Stream` API for collection operations — prefer declarative over imperative.
- Use `Optional<T>` for values that may be absent — never return `null` from a method that might have no result.
- Use `Optional.orElse()`, `Optional.orElseGet()`, `Optional.orElseThrow()` — never `Optional.get()` without `isPresent()`.
- Don't use `Optional` for collection return types — return empty collections instead of `Optional<List>`.
- Use `var` (Java 10+) for local variable type inference when the type is obvious from the right-hand side.
- Use records (Java 16+) for immutable data carriers: `record Point(int x, int y) {}`.
- Use sealed classes (Java 17+) for restricted type hierarchies.
- Use pattern matching for `instanceof` (Java 16+): `if (obj instanceof String s) { ... }`.
- Use switch expressions (Java 14+): `int result = switch (day) { case MONDAY -> 1; ... };`.
- Use text blocks (Java 15+) for multiline strings.

## Collections & Streams

- Use `List.of()`, `Set.of()`, `Map.of()` for immutable collections (Java 9+).
- Use `Collections.unmodifiableList()` to wrap mutable lists for read-only views.
- Use `ArrayList` for random access; `LinkedList` for frequent insertions/deletions.
- Use `HashMap` for O(1) lookups; `TreeMap` for sorted keys; `LinkedHashMap` for insertion order.
- Use `HashSet` for O(1) membership; `TreeSet` for sorted sets.
- Use `ArrayDeque` over `Stack` and `LinkedList` as a deque/queue.
- Initialize collections with expected capacity to avoid rehashing: `new HashMap<>(expectedSize * 2)`.
- Use `EnumMap` / `EnumSet` when keys/elements are enums — much faster than generic maps/sets.
- Use `computeIfAbsent`, `putIfAbsent`, `getOrDefault` for cleaner map operations.
- Avoid `null` values in collections — use `Optional` or empty objects.
- Use `Collectors.toUnmodifiableList()` in streams to get immutable results.
- Use `Stream.of()`, `Arrays.stream()`, `Collection.stream()` appropriately.
- Prefer `reduce()`, `collect()`, `map()`, `filter()`, `flatMap()` over manual loops.
- Use `parallelStream()` only after profiling — it adds overhead for small collections.

## Exception Handling

- Use checked exceptions for recoverable conditions; unchecked for programming errors.
- Never swallow exceptions silently: `catch (Exception e) {}` — at minimum, log them.
- Don't catch `Exception` or `Throwable` broadly unless at a top-level handler.
- Catch the most specific exception type first.
- Use try-with-resources for `AutoCloseable` resources: `try (InputStream is = ...) { ... }`.
- Add meaningful messages to exceptions: `throw new IllegalArgumentException("userId must be positive, got: " + userId)`.
- Log the exception with its stack trace: `log.error("Failed to process order: {}", orderId, e)`.
- Create custom exception classes for domain-specific errors: `class OrderNotFoundException extends RuntimeException`.
- Don't use exceptions for flow control — they're expensive and confusing.
- Use `finally` blocks (or try-with-resources) to ensure cleanup.
- Wrap checked exceptions in unchecked when crossing API boundaries: `throw new RuntimeException("Unexpected failure", e)`.
- Re-throw preserving the cause — don't lose the original exception: `throw new ServiceException(e)`.

## Concurrency

- Use `java.util.concurrent` — never manage threads manually with `wait()`/`notify()`.
- Use `ExecutorService` for managing thread pools: `Executors.newFixedThreadPool(n)`.
- Prefer `CompletableFuture` for async, composable operations.
- Use `synchronized` sparingly — prefer `java.util.concurrent.locks.ReentrantLock` for more control.
- Use `volatile` for simple shared flags — it ensures visibility but not atomicity.
- Use `AtomicInteger`, `AtomicLong`, `AtomicReference` for lock-free atomic operations.
- Use `ConcurrentHashMap`, `CopyOnWriteArrayList`, `BlockingQueue` for thread-safe collections.
- Avoid `Collections.synchronizedList()` — prefer dedicated concurrent collections.
- Don't call long-running operations while holding a lock.
- Avoid deadlock: always acquire locks in the same order.
- Use `CountDownLatch`, `CyclicBarrier`, `Semaphore` for thread coordination.
- Use virtual threads (Java 21+) for I/O-bound tasks: `Thread.ofVirtual().start(task)`.
- Use `ThreadLocal` for per-thread data — but clean up with `remove()` in thread pools.

## Null Safety

- Never return `null` — return empty collections, `Optional<T>`, or throw an exception.
- Use `@NonNull` / `@Nullable` annotations (Lombok, JetBrains, or Jakarta) to document intent.
- Use `Objects.requireNonNull(param, "message")` to validate parameters.
- Use `Optional<T>` instead of `null` for optional return values.
- Use `Objects.isNull()` / `Objects.nonNull()` for null checks in lambdas.
- Prefer `"constant".equals(variable)` over `variable.equals("constant")` to avoid NPE.
- Use `String.valueOf(obj)` instead of `obj.toString()` to safely handle nulls.

## Dependency Injection & Frameworks

- Use constructor injection over field injection — makes dependencies explicit and testable.
- Avoid `@Autowired` on fields — it hides dependencies and makes testing harder.
- Prefer `final` injected fields for immutability.
- Use interfaces for service dependencies — enables mocking in tests.
- Keep `@Service`, `@Repository`, `@Component` classes focused on one responsibility.
- Use `@Transactional` at the service layer, not the repository layer.
- Use Spring's `@Value` sparingly — prefer `@ConfigurationProperties` for typed config.

## Testing

- Write tests with JUnit 5 (`@Test`, `@BeforeEach`, `@AfterEach`, `@ParameterizedTest`).
- Use `@ParameterizedTest` with `@MethodSource` or `@CsvSource` for data-driven tests.
- Use Mockito for mocking: `@Mock`, `@InjectMocks`, `Mockito.when()`, `verify()`.
- Use `@ExtendWith(MockitoExtension.class)` instead of `MockitoAnnotations.openMocks()`.
- Use AssertJ for fluent assertions: `assertThat(result).isEqualTo(expected)`.
- Follow AAA pattern: Arrange, Act, Assert.
- Name tests descriptively: `shouldReturnEmptyListWhenNoOrdersExist()`.
- Keep tests independent — no shared mutable state between tests.
- Use `@Nested` classes to group related tests.
- Use `@TempDir` for temporary file system tests.
- Aim for high unit test coverage of business logic; integration tests for infrastructure.
- Use `@SpringBootTest` for integration tests that need the full application context.
- Use `@DataJpaTest` for repository layer tests with an embedded database.
- Use Testcontainers for integration tests with real databases/services.

## Performance

- Use `StringBuilder` for string concatenation in loops — never `String +=` in a loop.
- Use `String.format()` or text blocks for complex string building.
- Use primitive types (`int`, `long`, `double`) over boxed types (`Integer`, `Long`, `Double`) in hot paths.
- Avoid autoboxing in loops — it creates unnecessary heap objects.
- Use `Arrays.asList()` for fixed lists, `List.of()` for immutable lists.
- Use `System.arraycopy()` for fast array copies.
- Use `BufferedReader`/`BufferedWriter` for file I/O.
- Use connection pooling (HikariCP) for database connections.
- Use JVM flags: `-XX:+UseG1GC` for low-pause GC, `-Xms`/`-Xmx` for heap sizing.
- Profile with JFR (Java Flight Recorder) or async-profiler before optimizing.
- Use `@Cacheable` (Spring) for expensive, frequently-called read operations.

## Security

- Validate all inputs — use Bean Validation (`@NotNull`, `@Size`, `@Pattern`).
- Use parameterized queries / JPA — never string-concatenated SQL.
- Hash passwords with BCrypt: `new BCryptPasswordEncoder().encode(password)`.
- Use `MessageDigest` with SHA-256+ for data integrity; never MD5 or SHA-1 for security.
- Use `SecureRandom` for cryptographic randomness — never `Random`.
- Use HTTPS for all external communication.
- Don't log sensitive data — passwords, tokens, PII.
- Use Java's built-in serialization carefully — prefer JSON/Protobuf for cross-system data.
- Apply the principle of least privilege to service accounts and API keys.
- Keep dependencies updated — use Dependabot or OWASP Dependency-Check.

## Code Review Checklist

- Are `equals()` and `hashCode()` both overridden when one is overridden?
- Are resources closed with try-with-resources?
- Are exceptions handled (not swallowed) with meaningful messages?
- Is `null` avoided as a return value?
- Is concurrency handled with `java.util.concurrent` types?
- Are collections initialized with appropriate types and capacity?
- Are SQL queries parameterized?
- Are constructor-injected dependencies used over field injection?
- Are tests following AAA and named descriptively?
- Are `final` fields used for immutable state?
- Is `Optional` used appropriately (not for collections, not with `.get()` unchecked)?
- Are streams and lambdas used for clean collection processing?
