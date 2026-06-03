# JavaScript Best Practices — Exhaustive Code Review Guide

## Variables & Scoping

- Prefer `const` by default; use `let` only when reassignment is needed; never use `var`.
- `var` is function-scoped and hoisted; `let`/`const` are block-scoped with a temporal dead zone — accessing them before declaration throws `ReferenceError`.
- Avoid relying on hoisting; declare variables at the top of their scope.
- Never shadow outer variables unintentionally — it causes confusion and bugs.
- Use destructuring to extract values: `const { name, age } = user;` instead of multiple assignments.
- Use array destructuring with skips: `const [, second] = arr;`.
- Use default values in destructuring: `const { port = 3000 } = config;`.
- Avoid creating global variables; every variable must be explicitly declared.
- In strict mode (`'use strict'`), assigning to an undeclared variable throws — always enable it.
- Use `Object.freeze()` for truly immutable objects; `const` only prevents reassignment, not mutation.
- Prefer computed property names for dynamic keys: `{ [key]: value }`.

## Type System & Coercion

- Always use `===` and `!==`; never use `==` or `!=` which trigger implicit type coercion.
- `typeof null === 'object'` is a known bug — check for null explicitly: `value === null`.
- `typeof` returns `'undefined'` for undeclared variables — useful for feature detection, but prefer optional chaining.
- Use `Number.isNaN()` instead of global `isNaN()` which coerces its argument.
- Use `Number.isFinite()` instead of global `isFinite()`.
- Use `Array.isArray()` instead of `instanceof Array` (fails across realms/iframes).
- Use nullish coalescing `??` for defaults instead of `||` — `||` treats `0`, `''`, `false` as falsy.
- Use optional chaining `?.` to safely access nested properties: `user?.address?.city`.
- Avoid `new Boolean()`, `new String()`, `new Number()` — they create wrapper objects, not primitives.
- `parseInt()` always needs a radix: `parseInt(str, 10)`.
- Prefer `Number(str)` over `+str` for clarity.
- Use `BigInt` for integers larger than `Number.MAX_SAFE_INTEGER`.
- `void 0` is a reliable way to get `undefined` in old environments, but prefer literal `undefined` in modern code.
- `Object.is()` handles edge cases: `Object.is(NaN, NaN)` is `true`, `Object.is(+0, -0)` is `false`.

## Functions

- Keep functions small — under 20 lines. If it's longer, extract sub-functions.
- Each function should do one thing (Single Responsibility Principle).
- Use arrow functions for callbacks and non-method functions; use regular functions for methods and constructors.
- Arrow functions do not have their own `this`, `arguments`, or `super` — do not use them as methods on objects.
- Avoid using `arguments` object; use rest parameters `(...args)` instead.
- Use default parameters instead of `||` fallbacks: `function greet(name = 'World')`.
- Avoid side effects in functions when possible; prefer pure functions.
- Return early from functions to reduce nesting — guard clauses over nested if/else.
- Never mutate function arguments — clone them first if mutation is needed.
- Use the spread operator for shallow copies: `const copy = { ...original }`.
- Limit function parameters to 3 or fewer; use an options object for more.
- Use named functions instead of anonymous ones for better stack traces.
- Closures capture variables by reference, not value — beware of loop closures with `var`.
- Immediately Invoked Function Expressions (IIFE) are rarely needed with ES modules; prefer block scope.
- Currying (`const add = a => b => a + b`) is useful for creating specialized functions.
- Higher-order functions (`map`, `filter`, `reduce`) are preferred over manual loops for data transformation.
- Avoid deeply nested callbacks — flatten with async/await or Promise chains.
- Use `Function.prototype.bind()` sparingly; arrow functions or class fields are often cleaner.

## Objects & Prototypes

- Use object literal syntax `{}` instead of `new Object()`.
- Use shorthand properties: `{ name, age }` instead of `{ name: name, age: age }`.
- Use shorthand methods: `{ greet() {} }` instead of `{ greet: function() {} }`.
- Use computed property names for dynamic keys: `{ [dynamicKey]: value }`.
- Use `Object.keys()`, `Object.values()`, `Object.entries()` for iteration — avoid `for...in` without `hasOwnProperty` check.
- Use `Object.hasOwn(obj, key)` (ES2022) instead of `obj.hasOwnProperty(key)`.
- Use `Object.assign()` or spread `{...a, ...b}` for shallow merging — neither does deep merge.
- For deep cloning, use `structuredClone()` (ES2022+) instead of `JSON.parse(JSON.stringify())` which drops functions, undefined, symbols, dates.
- Avoid modifying `Object.prototype` — it affects all objects.
- Use `Object.freeze()` for immutable configs; `Object.seal()` to prevent adding/deleting properties.
- Use getters and setters for computed/validated properties.
- Use `Map` for dictionaries with non-string keys or frequent additions/deletions — better performance than plain objects.
- Use `Set` for unique value collections — `O(1)` lookups instead of `Array.includes()` which is `O(n)`.
- Property access with `?.` chains: `obj?.nested?.deep?.value` prevents `TypeError` on null/undefined.
- Avoid prototype pollution: never allow user input to set `__proto__`, `constructor`, or `prototype` properties.

## Arrays

- Use array literals `[]` instead of `new Array()`.
- Use `Array.from()` to convert iterables and array-like objects.
- Use `Array.isArray()` for type checking.
- Use `.at(-1)` (ES2022) to get the last element instead of `arr[arr.length - 1]`.
- Use `.includes()` instead of `.indexOf() !== -1` for existence checks.
- Use `.find()` to get the first matching element; `.findIndex()` for its index.
- Use `.some()` and `.every()` for boolean array queries.
- Use `.flat()` and `.flatMap()` for nested array operations.
- Prefer `.map()`, `.filter()`, `.reduce()` over manual loops for transformations.
- Avoid mutating methods (`push`, `pop`, `splice`, `sort`, `reverse`) on shared state; use immutable patterns: `[...arr, newItem]`, `.toSorted()`, `.toReversed()`, `.toSpliced()` (ES2023).
- `.sort()` mutates in place and converts elements to strings by default — always pass a comparator: `arr.sort((a, b) => a - b)`.
- `.reduce()` is powerful but hurts readability — prefer chained `.filter().map()` when possible.
- Use `for...of` for iteration when you don't need the index; use `.forEach()` for side effects only.
- Use `Array.from({ length: n }, (_, i) => i)` to generate sequences.
- Avoid sparse arrays: `new Array(5)` creates holes; use `Array.from({ length: 5 })` to fill with `undefined`.
- Typed arrays (`Uint8Array`, `Float64Array`) are for binary data and numeric computation — not general use.

## Async Programming

- Use `async/await` over raw Promises for readability.
- Always `await` Promises or return them — never leave them floating (unhandled rejections crash Node.js).
- Wrap `await` in `try/catch` for error handling, or use `.catch()` on the caller.
- Use `Promise.all()` for concurrent independent operations — it fails fast on first rejection.
- Use `Promise.allSettled()` when you need all results regardless of individual failures.
- Use `Promise.race()` for timeouts: `Promise.race([fetch(url), timeout(5000)])`.
- Use `Promise.any()` to get the first fulfilled promise (ignores rejections until all fail).
- Never use `async` on a function that doesn't `await` anything.
- Avoid mixing callbacks and Promises — convert callbacks to Promises with `util.promisify()` or manual wrapping.
- Avoid `await` inside loops — use `Promise.all(items.map(async item => ...))` for parallel execution.
- Sequential `await` in loops is fine when order matters or you need to rate-limit.
- The event loop processes microtasks (Promises) before macrotasks (setTimeout, I/O) — understand this for debugging.
- `queueMicrotask()` runs a callback in the microtask queue — use sparingly.
- AbortController/AbortSignal allows cancelling fetch, timers, and custom async operations.
- Top-level `await` is available in ES modules — useful for async initialization.
- Never `await` a non-Promise value inside a loop — it adds unnecessary microtask overhead.

## Error Handling

- Always handle errors — never silently swallow them with empty `catch` blocks.
- Use custom error classes extending `Error` for domain-specific errors: `class ValidationError extends Error {}`.
- Set `Error.captureStackTrace()` or `this.name = 'CustomError'` in custom error constructors.
- Include contextual information in error messages: what failed, with what input, and why.
- Use `try/catch` at the appropriate level — not around every single line, but at operation boundaries.
- Re-throw errors when you can't handle them: `catch (err) { logger.error(err); throw err; }`.
- Use `finally` for cleanup (closing connections, releasing resources).
- In async code, unhandled rejections terminate Node.js (v15+). Always attach `.catch()` or use `try/catch` with `await`.
- Use `error.cause` (ES2022) for error chaining: `throw new Error('Failed', { cause: originalError })`.
- Validate inputs at boundaries (API endpoints, user input) and throw descriptive errors.
- Use sentinel values (`null`, `undefined`) only for expected absent values, not for errors.
- Log errors with stack traces, request context, and timestamps.
- Don't use exceptions for control flow — they're expensive and reduce readability.
- Global error handlers (`process.on('uncaughtException')`, `window.onerror`) are last resorts, not replacements for proper handling.

## Classes & OOP

- Use `class` syntax over constructor functions for clarity.
- Use `#privateField` syntax (ES2022) for true private fields instead of `_convention`.
- Use `static` for methods/properties that don't need instance access.
- Use `extends` for inheritance — but prefer composition over inheritance.
- Always call `super()` first in derived class constructors.
- Use getter/setter for computed or validated properties.
- Don't add methods to prototypes at runtime — it deoptimizes V8's hidden classes.
- Use `instanceof` carefully — it fails across realms (iframes, vm contexts); prefer duck typing or Symbol.hasInstance.
- Avoid deep inheritance hierarchies — 2-3 levels max; use mixins or composition.
- Use `static` factory methods for complex construction logic.

## Modules

- Use ES modules (`import`/`export`) over CommonJS (`require`/`module.exports`) in new code.
- Use named exports for multiple values; default exports for the primary value.
- Avoid circular dependencies — they cause `undefined` imports and are hard to debug.
- Use dynamic `import()` for code splitting and lazy loading.
- Use barrel files (`index.js` re-exports) sparingly — they hurt tree shaking.
- Side-effect-only imports (`import './setup'`) should be clearly documented.
- Never mix CJS and ESM in the same package without proper `exports` field in `package.json`.
- Use `"type": "module"` in `package.json` for ESM by default.

## Memory Management

- Avoid memory leaks: remove event listeners, clear timers, nullify references.
- Use `WeakMap` and `WeakSet` for caching that shouldn't prevent garbage collection.
- Use `WeakRef` and `FinalizationRegistry` for advanced GC-aware patterns.
- Closures retain outer scope variables — large closures in long-lived callbacks leak memory.
- Detached DOM nodes (referenced in JS but removed from DOM) are a common browser memory leak.
- Use Chrome DevTools Memory tab or `--inspect` with `process.memoryUsage()` to profile.
- Avoid global caches without eviction — use LRU caches with size limits.
- Unbind event listeners in cleanup: `removeEventListener`, React `useEffect` return, etc.
- Large arrays and strings should be released when done — set to `null` if in long-lived scope.
- Use streaming for large data — don't load entire files into memory.

## Performance

- Don't optimize prematurely — profile first, then optimize hot paths.
- Avoid DOM thrashing — batch reads and writes; use `requestAnimationFrame` for visual updates.
- Debounce expensive handlers (scroll, resize, input): `lodash.debounce` or custom implementation.
- Throttle rate-limited events for consistent intervals.
- Use `requestIdleCallback` for non-urgent work.
- Web Workers offload CPU-intensive work from the main thread.
- Use `Map` and `Set` for frequent lookups instead of arrays — `O(1)` vs `O(n)`.
- Avoid `delete obj.key` — it deoptimizes V8 hidden classes; set to `undefined` instead or use `Map`.
- Template literals are slightly slower than concatenation for simple cases — negligible; use for readability.
- Avoid creating functions inside loops — hoist them or use `.bind()`.
- Use `for` loops over `.forEach()` for performance-critical paths (slight overhead from function calls).
- Lazy evaluation: compute values only when needed.
- Memoize expensive pure functions: `const memo = new Map(); if (memo.has(key)) return memo.get(key);`.
- Use `Object.keys(obj).length === 0` to check for empty objects instead of JSON.stringify comparison.
- Avoid deeply nested object access in tight loops — cache intermediate references.
- Use bitwise operators for integer math only when performance is critical and intent is clear.

## Security

- Never use `eval()` — it executes arbitrary code and disables optimizations.
- Never use `new Function()` with user input — equivalent to `eval`.
- Sanitize all user input before rendering in HTML — prevent XSS.
- Use `textContent` instead of `innerHTML` when inserting user-provided text.
- Use Content Security Policy (CSP) headers to prevent inline script execution.
- Validate and sanitize all data at API boundaries — never trust client input.
- Use parameterized queries for databases — never concatenate user input into SQL/NoSQL queries.
- Avoid prototype pollution: validate that user input doesn't contain `__proto__`, `constructor`, or `prototype` keys.
- Use `Object.create(null)` for dictionaries from user input — no prototype chain.
- Use `crypto.getRandomValues()` or `crypto.randomUUID()` for secure randomness — never `Math.random()` for security.
- Use HTTPS everywhere; set `Secure`, `HttpOnly`, `SameSite` on cookies.
- Avoid exposing stack traces or internal errors to clients.
- Use `Subresource Integrity` (SRI) for third-party scripts.
- Regular expressions with catastrophic backtracking (ReDoS) can freeze the event loop — test regexes with large inputs.
- Use `new URL()` for URL parsing instead of manual string manipulation.

## Testing

- Write unit tests for pure functions; integration tests for I/O and APIs.
- Test edge cases: empty inputs, null, undefined, boundary values, large inputs.
- Test error paths — verify that errors are thrown and handled correctly.
- Use test doubles (mocks, stubs, spies) for external dependencies (APIs, databases).
- Avoid testing implementation details — test behavior and outputs.
- Use descriptive test names: `it('returns 404 when user is not found')`.
- Each test should be independent — no shared mutable state between tests.
- Use `beforeEach`/`afterEach` for setup/teardown, not shared variables.
- Aim for high coverage but don't chase 100% — focus on critical paths.
- Test async code with `async/await` in test functions.
- Use snapshot testing sparingly — snapshots become stale and are rubber-stamped.
- Test public APIs, not private internals.

## Clean Code

- Use descriptive, intention-revealing names: `getUserById` not `getUser`, `isValid` not `check`.
- Avoid abbreviations: `document` not `doc`, `configuration` not `cfg` (except universally known ones like `id`, `url`).
- Functions should be verbs; variables/classes should be nouns.
- Boolean variables/functions should be prefixed: `isActive`, `hasPermission`, `canDelete`.
- Avoid magic numbers — use named constants: `const MAX_RETRIES = 3`.
- Avoid magic strings — use enums or constant objects: `const Status = { ACTIVE: 'active', INACTIVE: 'inactive' }`.
- Don't Repeat Yourself (DRY) — but don't create premature abstractions for 2 similar lines.
- Keep It Simple (KISS) — prefer straightforward code over clever code.
- You Aren't Gonna Need It (YAGNI) — don't build features "just in case".
- Comments should explain WHY, not WHAT — code should be self-documenting.
- Delete dead code — don't comment it out; it's in version control.
- Limit line length to 100-120 characters.
- Use consistent formatting — enforce with Prettier/ESLint.
- One concept per file; one responsibility per function/class.
- Avoid deeply nested code (> 3 levels) — extract functions or use early returns.
- Group related code together; separate unrelated code.

## Common Anti-Patterns

- Callback hell: deeply nested callbacks — flatten with async/await.
- God functions: functions doing too many things — split by responsibility.
- Mutation in `.map()/.filter()`: these should return new values, not mutate state.
- Implicit globals: forgetting `let`/`const` creates globals in non-strict mode.
- Stringly-typed: using strings for enums/states — use constants or TypeScript enums.
- Boolean blindness: `doSomething(true, false, true)` — use options objects.
- Premature optimization: optimizing code that isn't a bottleneck.
- Copy-paste programming: duplicating code instead of extracting shared logic.
- Error swallowing: `catch(e) {}` — always log or re-throw.
- Overusing `any` (in TypeScript): defeats the purpose of type checking.
- Nested ternaries: `a ? b ? c : d : e` — use if/else or extract to function.
- Console-driven development: using `console.log` instead of debugger/tests.

## Modern JS Features (ES2020-2024)

- `??` nullish coalescing: `value ?? defaultValue` (only null/undefined trigger default).
- `?.` optional chaining: `obj?.prop?.method?.()`.
- `??=` logical nullish assignment: `x ??= defaultValue`.
- `||=` logical OR assignment: `x ||= fallback`.
- `&&=` logical AND assignment: `x &&= newValue`.
- `structuredClone(obj)` for deep cloning (ES2022).
- `Array.at(index)` supports negative indices (ES2022).
- `Object.hasOwn(obj, key)` replaces `hasOwnProperty` (ES2022).
- `Error.cause` for error chaining (ES2022).
- Top-level `await` in ES modules (ES2022).
- `.findLast()` and `.findLastIndex()` (ES2023).
- `.toSorted()`, `.toReversed()`, `.toSpliced()`, `.with()` — immutable array methods (ES2023).
- `Object.groupBy()` and `Map.groupBy()` (ES2024).
- `Promise.withResolvers()` (ES2024).
- `Set` methods: `.union()`, `.intersection()`, `.difference()`, `.symmetricDifference()` (ES2025).
- Use new features with appropriate polyfills/transpilation for your target environments.

## Regex

- Use named capture groups: `/(?<year>\d{4})-(?<month>\d{2})/`.
- Use `\d`, `\w`, `\s` shorthand classes.
- Use `u` flag for Unicode support: `/\p{Emoji}/u`.
- Use `s` (dotAll) flag to make `.` match newlines.
- Avoid catastrophic backtracking: don't nest quantifiers like `(a+)+`.
- Use `String.prototype.matchAll()` for global matches with capture groups.
- Use `RegExp.prototype.test()` for boolean checks — cheaper than `.match()`.
- Prefer template strings for building dynamic regexes: `new RegExp(\`^${prefix}\`)`.
- Escape special characters in user input before using in regex: `str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.

## Iterators & Generators

- Use `for...of` to consume iterables (arrays, maps, sets, strings, generators).
- Implement `Symbol.iterator` for custom iterables.
- Generators (`function*`) produce values lazily — useful for large/infinite sequences.
- `yield*` delegates to another generator or iterable.
- Async generators (`async function*`) combine async/await with lazy iteration.
- Use `for await...of` to consume async iterables (e.g., streaming data).

## Proxy & Reflect

- Use `Proxy` for meta-programming: validation, logging, access control.
- Use `Reflect` methods inside Proxy handlers for correct default behavior.
- Proxies have performance overhead — don't use in hot paths.
- Common use cases: auto-vivification, observable objects, API builders.
- Avoid using Proxy for simple validation — prefer explicit checks.

## Code Review Checklist

- Are all variables declared with `const` or `let`?
- Are strict equality operators (`===`, `!==`) used throughout?
- Are errors properly caught and handled (no empty catch blocks)?
- Are async operations properly awaited or returned?
- Are there any potential memory leaks (event listeners, timers, closures)?
- Is user input validated and sanitized?
- Are magic numbers and strings replaced with named constants?
- Are functions small and focused on a single task?
- Is the code DRY without premature abstraction?
- Are edge cases handled (null, undefined, empty arrays, boundary values)?
- Is the code readable without excessive comments?
- Are modern JS features used appropriately?
- Is error handling consistent with the project's conventions?
- Are there any security concerns (XSS, injection, prototype pollution)?
- Is performance acceptable for the use case?

## Optimization Tips

- Use `Map` over `Object` for frequent key lookups with dynamic keys — `Map` has `O(1)` access and preserves insertion order.
- Use `Set` for uniqueness checks — `set.has(x)` is `O(1)` vs `array.includes(x)` at `O(n)`.
- Cache regex instances outside loops — compiling regex is expensive.
- Use `for` loops or `for...of` instead of `.forEach()` in hot paths.
- Avoid creating unnecessary intermediate arrays — chain `.filter().map()` creates two arrays; consider `.reduce()` or a single loop.
- Use `TextEncoder`/`TextDecoder` for efficient string/binary conversion.
- Use `AbortController` to cancel unneeded fetch requests and prevent wasted bandwidth.
- Batch DOM updates — read all measurements first, then apply all mutations.
- Use `will-change` CSS and `transform` for GPU-accelerated animations.
- Lazy-load images with `loading="lazy"` and components with dynamic `import()`.
- Use connection pooling for database connections — never open/close per request.
- Profile with Chrome DevTools Performance tab before optimizing.
