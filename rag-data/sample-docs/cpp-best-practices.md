# C++ Best Practices — Exhaustive Code Review Guide

## Naming & Style

- Follow a consistent naming convention: `camelCase` for variables/functions, `PascalCase` for classes/structs/enums, `UPPER_SNAKE_CASE` for constants and macros.
- Use descriptive names — `userCount` not `n`, `orderTotal` not `t` (except in tiny scopes like loop counters).
- Prefix member variables with `m_` or `_` (pick one and be consistent): `m_userId`, `m_name`.
- Prefix boolean variables/functions with `is`, `has`, `can`, `should`: `isReady`, `hasPermission`.
- Use `k` prefix for constants: `kMaxRetries`, `kBufferSize`.
- Avoid Hungarian notation except in legacy codebases.
- Use `auto` for type deduction when the type is obvious from context — but don't over-use it.
- Use `clang-format` for consistent code formatting — commit a `.clang-format` file to the repo.
- Use `clang-tidy` for static analysis.
- Avoid macros — prefer `constexpr`, `inline functions`, and templates.
- Keep lines under 100 characters.

## Modern C++ (C++11/14/17/20)

- Use C++17 or later for new projects — leverage structured bindings, `if constexpr`, `std::optional`, `std::variant`, `std::string_view`.
- Use `constexpr` for compile-time constants and functions: `constexpr int kMax = 100;`.
- Use `constexpr` functions over macros for compile-time computation.
- Use `[[nodiscard]]` on functions whose return value must not be ignored.
- Use `[[maybe_unused]]` to suppress unused variable warnings.
- Use `[[deprecated("reason")]]` to mark deprecated APIs.
- Use `noexcept` on functions that do not throw — enables compiler optimizations.
- Use `explicit` on single-argument constructors to prevent implicit conversions.
- Use `= delete` to prevent unwanted implicit operations: `MyClass(const MyClass&) = delete;`.
- Use `= default` for compiler-generated special member functions.
- Use `override` on virtual methods — catches mismatched signatures at compile time.
- Use `final` on classes/methods that must not be overridden.
- Use `enum class` over `enum` — scoped, strongly typed, no implicit conversion to int.

## Memory Management

- Prefer stack allocation over heap allocation — it's faster and automatically managed.
- Use smart pointers — never manage raw memory manually.
- Use `std::unique_ptr<T>` for exclusive ownership: `auto ptr = std::make_unique<Widget>(args)`.
- Use `std::shared_ptr<T>` for shared ownership — but prefer `unique_ptr` when possible.
- Use `std::weak_ptr<T>` to break `shared_ptr` cycles.
- Never use `new`/`delete` directly in modern C++.
- Never use `malloc`/`free` in C++ code.
- Use `std::make_unique` and `std::make_shared` — they're exception-safe and more efficient.
- Follow the Rule of Zero: if your class uses smart pointers/RAII members, define no destructor/copy/move.
- Follow the Rule of Five if you manage raw resources: define destructor, copy constructor, copy assignment, move constructor, move assignment.
- Use RAII (Resource Acquisition Is Initialization) for all resource management (files, sockets, locks).
- Avoid dangling references — never return references/pointers to local variables.
- Use `std::span<T>` (C++20) for non-owning views of contiguous data.
- Use `std::string_view` for non-owning string references — avoid copying strings.

## References & Pointers

- Prefer references over pointers when the value must always exist and won't be reassigned.
- Use `const T&` for read-only parameters of non-trivial types — avoids copying.
- Use `T&&` (rvalue reference) only in move constructors and move assignment operators.
- Use perfect forwarding with `std::forward<T>` in template code.
- Use `std::move` to transfer ownership — understand when it's appropriate.
- Avoid raw owning pointers — use smart pointers.
- Use raw non-owning pointers (`T*`) to indicate optionality or observers, not ownership.
- Prefer `std::optional<T>` over nullable pointers for optional values.
- Never dereference a null pointer — add null checks before dereferencing.

## Classes & OOP

- Follow Single Responsibility Principle — each class should do one thing.
- Prefer composition over inheritance.
- Make base class destructors `virtual` if the class is meant to be inherited.
- Use pure virtual functions (`= 0`) for abstract interfaces.
- Keep class interfaces minimal — expose only what is necessary.
- Use `public`, `protected`, `private` access specifiers explicitly.
- Declare member variables `private` — expose them through getters/setters only if needed.
- Use `const` member functions for methods that don't modify state.
- Use initializer lists in constructors: `MyClass::MyClass(int x) : m_x(x) {}`.
- Avoid doing heavy work in constructors — use factory functions for complex initialization.
- Use the Pimpl idiom for stable ABIs and reduced compile times.

## Templates & Generic Programming

- Use templates for type-safe, generic algorithms and data structures.
- Use `typename` or `class` for template type parameters (prefer `typename` for clarity).
- Use `static_assert` to enforce template constraints: `static_assert(std::is_integral_v<T>)`.
- Use concepts (C++20) to constrain templates: `template<std::integral T> T add(T a, T b)`.
- Use `if constexpr` for compile-time branching in templates.
- Avoid template metaprogramming (TMP) in favor of C++17/20 features.
- Provide explicit template specializations for edge cases.
- Use `std::enable_if` / `std::enable_if_t` for SFINAE in pre-C++20 code.
- Put template definitions in header files — the compiler needs them at instantiation time.

## Error Handling

- Use exceptions for error handling in application code — catch at appropriate levels.
- Don't throw from destructors — it causes `std::terminate`.
- Use `noexcept` on functions that must not throw (destructors, move operations).
- Create custom exception classes derived from `std::exception`.
- Use `std::optional<T>` for functions that may not return a value.
- Use `std::expected<T, E>` (C++23) for error-returning functions without exceptions.
- Catch exceptions by `const` reference: `catch (const std::exception& e)`.
- Don't use `catch (...)` without re-throwing — it swallows all errors.
- For performance-critical code, prefer error codes or `std::optional` over exceptions.
- Use RAII to ensure cleanup even when exceptions are thrown.

## STL & Standard Library

- Use `std::vector` as the default container — cache-friendly and efficient.
- Use `std::unordered_map`/`std::unordered_set` for O(1) lookups; `std::map`/`std::set` for ordered data.
- Use `std::array<T, N>` for fixed-size arrays — safer and more expressive than C arrays.
- Use `std::string` for mutable strings, `std::string_view` for non-owning string references.
- Use range-based for loops: `for (const auto& item : container)`.
- Use STL algorithms (`std::sort`, `std::find`, `std::transform`) over manual loops.
- Use `std::ranges` algorithms (C++20) for composable, range-based operations.
- Use `std::move` when inserting into containers to avoid unnecessary copies.
- Reserve vector capacity when the size is known: `vec.reserve(expectedSize)`.
- Use `emplace_back` instead of `push_back` to construct in-place.
- Use `std::span` for passing array-like data without copying.
- Use `std::variant<Types...>` as a type-safe union.
- Use `std::any` for type-erased storage (sparingly — it loses type safety).

## Concurrency

- Use `std::thread`, `std::jthread` (C++20) for threads.
- Prefer `std::jthread` — it automatically joins and supports stop tokens.
- Use `std::mutex` / `std::shared_mutex` to protect shared state.
- Always use `std::lock_guard` or `std::unique_lock` — never call `mutex.lock()`/`unlock()` directly.
- Use `std::scoped_lock` (C++17) to lock multiple mutexes without deadlock.
- Use `std::atomic<T>` for simple shared variables — avoids mutex overhead.
- Use `std::condition_variable` for thread signaling.
- Avoid data races — always protect shared mutable state.
- Use `std::async` / `std::future` / `std::promise` for async task execution.
- Use thread-local storage (`thread_local`) for per-thread data.
- Use `std::call_once` with `std::once_flag` for thread-safe one-time initialization.
- Prefer message-passing or futures over shared mutable state.
- Use `-fsanitize=thread` (TSan) to detect data races during testing.

## Performance

- Profile before optimizing — use perf, gprof, or Valgrind.
- Prefer value types over heap-allocated objects for small data.
- Use move semantics to avoid copies: `std::move(largeObject)`.
- Use `reserve()` on vectors to avoid reallocations.
- Avoid virtual dispatch in hot paths — prefer templates or `std::variant` with `std::visit`.
- Use `inline` and `constexpr` to enable inlining and compile-time evaluation.
- Use `__builtin_expect` (GCC/Clang) to hint branch prediction for hot paths.
- Minimize cache misses — keep related data together (Structure of Arrays vs Array of Structures).
- Use `std::string_view` to avoid string copies in hot paths.
- Avoid unnecessary heap allocations in hot paths — use object pools or stack allocation.
- Use compile-time computation with `constexpr` and `consteval`.
- Enable compiler optimizations: `-O2` or `-O3` for release builds.
- Use Link-Time Optimization (LTO): `-flto`.

## Security

- Validate all external input — never trust user data.
- Use `std::string` and `std::vector` instead of C-style arrays — they prevent buffer overflows.
- Avoid `strcpy`, `sprintf`, `gets` — use `std::string`, `std::snprintf`, or `std::getline`.
- Use `std::array::at()` or bounds-checked access instead of `operator[]` when safety matters.
- Enable compiler hardening flags: `-fstack-protector-strong`, `-D_FORTIFY_SOURCE=2`, `-Wformat-security`.
- Use `-fsanitize=address` (ASan) during testing to detect memory errors.
- Use `-fsanitize=undefined` (UBSan) to catch undefined behavior.
- Never use uninitialized variables — enable `-Wuninitialized` warning.
- Avoid integer overflow — use `std::numeric_limits` and checked arithmetic.
- Use `const` wherever possible to prevent accidental mutation.
- Don't log sensitive data — passwords, keys, PII.

## Code Review Checklist

- Are smart pointers used instead of raw `new`/`delete`?
- Is the Rule of Zero or Rule of Five correctly applied?
- Are all virtual base class destructors declared `virtual`?
- Is `override` used on overriding virtual methods?
- Are `const` member functions used where the object is not modified?
- Is `noexcept` applied to move operations and destructors?
- Are STL algorithms used instead of manual loops?
- Are mutexes always locked via RAII (`lock_guard`/`unique_lock`)?
- Is input validated before use?
- Are exceptions caught by `const` reference?
- Is `std::optional` used instead of null pointers where applicable?
- Are warnings enabled and clean? (`-Wall -Wextra -Wpedantic`)
- Is UBSan/ASan used in the test build?
