# Swift Best Practices — Exhaustive Code Review Guide

## Naming & Style

- Use `camelCase` for variables, constants, functions, and enum cases: `userName`, `calculateTotal()`, `.success`.
- Use `PascalCase` for types (classes, structs, enums, protocols): `UserProfile`, `OrderStatus`.
- Name booleans as assertions: `isLoading`, `hasError`, `canSubmit`, `isEmpty`.
- Name functions as verbs: `fetchUser()`, `saveOrder()`, `validateInput()`.
- Name types as nouns: `UserService`, `PaymentProcessor`.
- Protocol names describe capabilities: `Sendable`, `Equatable`, `CustomStringConvertible`.
- Omit needless words — `func removeElement(at index: Int)` not `func removeElementAtIndex(index: Int)`.
- Follow Swift API Design Guidelines strictly.
- Use `SwiftLint` for style enforcement — commit a `.swiftlint.yml` to the repo.
- Use `swiftformat` for automatic code formatting.
- Keep lines under 120 characters.

## Swift Fundamentals

- Use `let` over `var` — declare mutability only when necessary.
- Use value types (`struct`, `enum`) over reference types (`class`) for data models.
- Use `struct` for plain data; `class` only when identity, inheritance, or reference semantics are needed.
- Use `enum` with associated values for modeling states: `enum Result<T> { case success(T); case failure(Error) }`.
- Use `typealias` for complex types to improve readability: `typealias CompletionHandler = (Result<User, Error>) -> Void`.
- Use `lazy` for properties with expensive initialization that may not always be needed.
- Use `@discardableResult` on functions when ignoring the result is intentional.
- Avoid force unwrap (`!`) — it crashes at runtime. Use `guard let`, `if let`, or `??` instead.
- Avoid `try!` — use `do-catch` or `try?` appropriately.
- Use `guard` for early returns and precondition checking.

## Optionals

- Never force-unwrap (`!`) unless you are 100% certain the value is non-nil and can justify it.
- Use `if let` binding for optional values used within a limited scope.
- Use `guard let` when the unwrapped value is needed for the rest of the function.
- Use `??` for providing defaults: `let name = user.name ?? "Guest"`.
- Use optional chaining (`?.`) for safe access: `user?.address?.city`.
- Use `map`, `flatMap`, `compactMap` on optionals for transformations.
- Avoid pyramids of doom — chain `guard` statements or use `if let` with multiple bindings.
- Use `if let x = x` (Swift 5.7+) shorthand: `if let name { ... }` instead of `if let name = name { ... }`.

## Error Handling

- Use `throws` + `do-catch` for recoverable errors — not `Optional` or sentinel values.
- Define domain-specific error types conforming to `Error` (or `LocalizedError` for user messages).
- Use `try?` when you don't care about the error and `nil` is an acceptable outcome.
- Use `try!` only in tests or when the failure is a programmer error (not in production code).
- Use `Result<Success, Failure>` for async APIs or when you need to pass errors as values.
- Avoid generic `catch` without handling — at minimum, log the error.
- Use `defer` for cleanup that must happen regardless of how the function exits.
- Use Swift's `throws` in protocol requirements to enforce error handling contracts.

## Structs vs Classes

- Default to `struct` — it's value-typed, thread-safe by default, and copied on mutation.
- Use `class` when: you need reference semantics, identity, inheritance, or Objective-C interop.
- Use `final class` when a class doesn't need to be subclassed — enables compiler optimizations.
- Implement `Equatable` on structs for value equality.
- Implement `Hashable` on structs used as dictionary keys or in sets.
- Implement `Codable` for structs that need JSON serialization/deserialization.
- Use `mutating` on struct methods that change state — makes mutation explicit.

## Protocols & Generics

- Prefer protocols over inheritance for defining shared behavior.
- Use protocol extensions to provide default implementations.
- Use associated types for generic protocols: `protocol Repository { associatedtype Entity }`.
- Use `some Protocol` (opaque types) for return types when the concrete type doesn't matter to the caller.
- Use `any Protocol` (existential types, Swift 5.7+) only when necessary — they have overhead.
- Use generics for type-safe, reusable functions: `func max<T: Comparable>(_ a: T, _ b: T) -> T`.
- Conform to `Identifiable` for types used in SwiftUI lists.
- Use `Sendable` protocol for types safe to pass across concurrency boundaries.
- Use conditional conformances: `extension Array: Equatable where Element: Equatable {}`.
- Don't over-protocol — not every type needs a protocol abstraction.

## Concurrency (Swift Concurrency)

- Use `async`/`await` for asynchronous code — avoid completion handlers in new code.
- Use `Task` to create asynchronous work: `Task { await fetchData() }`.
- Use `async let` for concurrent independent operations: `async let a = fetchA(); async let b = fetchB()`.
- Use `withTaskGroup` for dynamic concurrency — fan-out patterns.
- Use `Actor` for protecting shared mutable state: `actor DataStore { var items = [Item]() }`.
- Use `@MainActor` for UI-related code that must run on the main thread.
- Use `Sendable` to mark types safe to pass across concurrency boundaries.
- Avoid `DispatchQueue` in new code — use structured concurrency instead.
- Use `Task.sleep(for:)` instead of `Thread.sleep(forTimeInterval:)`.
- Use `withCheckedContinuation` to bridge callback-based APIs to `async/await`.
- Avoid unstructured concurrency (`Task.detached`) unless necessary.
- Mark `@nonisolated` on methods that don't need actor isolation.
- Use `AsyncStream` for bridging delegation or callback patterns to async sequences.

## Memory Management (ARC)

- Use `weak` references to break retain cycles — especially in closures and delegates.
- Use `unowned` when you're certain the referenced object will always outlive the reference.
- Use `[weak self]` in escaping closures to avoid retain cycles: `{ [weak self] in self?.doWork() }`.
- Use `guard let self = self else { return }` after capturing `weak self`.
- Use `[unowned self]` only when the closure's lifetime is strictly shorter than `self`.
- Use Instruments (Leaks, Allocations) to detect memory leaks.
- Avoid circular strong references between class instances.
- Prefer value types — they don't participate in ARC and eliminate retain cycle risk.

## SwiftUI

- Keep `View` bodies simple — extract subviews into separate structs.
- Use `@State` for local, private view state.
- Use `@Binding` to share state with child views.
- Use `@ObservedObject` / `@StateObject` for ViewModel objects.
- Use `@EnvironmentObject` for app-wide shared state.
- Use `@Environment` for system values (colorScheme, locale, dismiss).
- Prefer `@StateObject` over `@ObservedObject` for objects owned by the view.
- Use `ObservableObject` + `@Published` for ViewModels (or `@Observable` macro in Swift 5.9+).
- Use `@Observable` macro (Swift 5.9+) — simpler than `ObservableObject`.
- Extract business logic into ViewModels — keep Views dumb.
- Use `task(id:)` for async operations tied to a view's lifecycle.
- Use `PreviewProvider` (or `#Preview` macro in Xcode 15+) for view previews.
- Avoid putting too much logic in `View` — move it to ViewModels or services.

## Testing

- Use XCTest for unit and integration tests.
- Use `@testable import ModuleName` to test internal types.
- Use `XCTAssert`, `XCTAssertEqual`, `XCTAssertNil`, `XCTAssertThrowsError`.
- Name tests descriptively: `test_fetchUser_returnsUserWhenFound()`.
- Use `setUp()` and `tearDown()` for test lifecycle management.
- Use `async` test functions with `await` for testing async code.
- Use `XCTestExpectation` for callback-based async tests (legacy APIs).
- Prefer dependency injection over singletons to make code testable.
- Use protocol mocks for isolating units under test.
- Use Swift Testing framework (`@Test`, `@Suite`) for modern test authoring (Xcode 16+).
- Test ViewModels independently of SwiftUI views.

## Performance

- Profile with Instruments before optimizing.
- Use value types (structs) — they're stack-allocated and copy-on-write.
- Use `lazy` for expensive properties not always accessed.
- Use `ContiguousArray` over `Array` for elements that are classes — avoids bridging overhead.
- Use `capacity` parameter when constructing arrays/dictionaries of known size.
- Avoid unnecessary copies — understand copy-on-write behavior.
- Use `@inlinable` for performance-critical generic functions in libraries.
- Avoid dynamic dispatch — use `final`, `private`, and `struct` to enable static dispatch.
- Use `Codable` with `JSONDecoder` efficiently — reuse decoders and encoders.
- Use `withUnsafeBytes` / `withUnsafeMutableBytes` for zero-copy buffer operations.
- Avoid `Any` and type erasure in hot paths — they add overhead.

## Security

- Validate all inputs — never trust external data.
- Store sensitive data in the Keychain — never in `UserDefaults` or plain files.
- Use `CryptoKit` for cryptographic operations (hashing, encryption, signing).
- Never use `MD5` or `SHA1` for security — use `SHA256` or higher via `CryptoKit`.
- Use App Transport Security (ATS) — require HTTPS for all connections.
- Use certificate pinning for high-security applications.
- Don't log sensitive data — tokens, passwords, PII.
- Use `SecureEnclave` for storing private keys on supported devices.
- Sanitize data before displaying user input to prevent injection attacks.
- Review entitlements — request only necessary capabilities.

## Code Review Checklist

- Is `let` used over `var` where possible?
- Are force unwraps (`!`) and `try!` avoided?
- Are optionals safely unwrapped with `guard let` / `if let` / `??`?
- Are `weak` references used in delegates and closures to prevent retain cycles?
- Is `struct` preferred over `class` for data models?
- Is `async`/`await` used instead of completion handlers?
- Are actors used to protect shared mutable state?
- Is `@MainActor` used for UI updates?
- Are ViewModels keeping Views free of business logic?
- Are custom error types defined and handled properly?
- Is sensitive data stored in the Keychain?
- Are tests written using XCTest or Swift Testing?
