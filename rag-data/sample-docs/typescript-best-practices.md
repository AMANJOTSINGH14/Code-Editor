# TypeScript Best Practices — Exhaustive Code Review Guide

## Type System Fundamentals

- Enable `strict: true` in `tsconfig.json` — it enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and more.
- Never use `any` — use `unknown` for values of uncertain type, then narrow with type guards.
- Use `unknown` instead of `any` for function parameters from external sources; it forces type checking before use.
- Prefer type inference — don't annotate when TypeScript can infer correctly: `const x = 5;` not `const x: number = 5;`.
- Annotate function return types explicitly for public APIs — prevents accidental return type changes.
- Annotate function parameters always — TypeScript cannot infer parameter types (except in callbacks).
- Use `readonly` for properties that should not be mutated after construction.
- Use `ReadonlyArray<T>` or `readonly T[]` for arrays that should not be mutated.
- Use `as const` for literal types: `const directions = ['up', 'down'] as const` gives `readonly ['up', 'down']`.
- Avoid type assertions (`as`) — they bypass the type checker. Use type guards instead.
- Use `satisfies` operator (TS 5.0+) to validate types without widening: `const config = {...} satisfies Config`.
- Use `never` for exhaustive switch checks: `default: const _exhaustive: never = value;`.

## Interfaces vs Types

- Use `interface` for object shapes that may be extended — they support declaration merging.
- Use `type` for unions, intersections, mapped types, and utility types.
- Prefer `interface` for public API contracts and `type` for internal/complex types.
- Don't prefix interfaces with `I` — TypeScript convention is `User`, not `IUser`.
- Use `extends` for interface inheritance; use `&` for type intersections.
- Interfaces are open (can be augmented); types are closed — choose based on intent.

## Generics

- Use generics for reusable, type-safe functions and data structures.
- Use descriptive generic names for complex generics: `TResult`, `TInput`, not just `T`.
- Constrain generics with `extends`: `function get<T extends object>(obj: T, key: keyof T)`.
- Use default generic parameters: `function create<T = string>(value: T)`.
- Avoid overusing generics — if a function works with a specific type, use that type.
- Use `infer` in conditional types for extracting nested types.
- Use generic constraints to narrow: `T extends { id: string }` ensures `T` has an `id` property.

## Union & Intersection Types

- Use discriminated unions for state machines: `type State = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error }`.
- Always narrow unions before use — use `if`, `switch`, `in`, `typeof`, `instanceof`, or custom type guards.
- Use `in` operator for narrowing: `if ('error' in result)`.
- Custom type guards: `function isUser(value: unknown): value is User { return ... }`.
- Avoid large unions (50+ members) — they slow down the compiler and are hard to maintain.
- Intersection types (`A & B`) combine properties — beware of `never` results from incompatible intersections.
- Use `Extract<T, U>` and `Exclude<T, U>` to manipulate union types.

## Utility Types

- `Partial<T>` — all properties optional. Use for update/patch operations.
- `Required<T>` — all properties required.
- `Readonly<T>` — all properties readonly.
- `Pick<T, K>` — select specific properties. Use for DTOs.
- `Omit<T, K>` — exclude specific properties.
- `Record<K, V>` — create an object type with keys of type K and values of type V.
- `ReturnType<T>` — extract return type of a function.
- `Parameters<T>` — extract parameter types of a function as a tuple.
- `Awaited<T>` — unwrap Promise types: `Awaited<Promise<string>>` is `string`.
- `NonNullable<T>` — remove `null` and `undefined` from a type.
- `ConstructorParameters<T>` — extract constructor parameter types.
- Use `keyof` for property name unions: `keyof User` gives `'name' | 'email' | 'age'`.
- Use `typeof` for getting the type of a value: `typeof config` gives the inferred type.

## Enums

- Prefer `const enum` for inlined values — no runtime object.
- Prefer string enums over numeric enums — more readable in logs and debugging.
- Consider union types instead of enums: `type Direction = 'up' | 'down' | 'left' | 'right'` — simpler, no runtime overhead, better tree-shaking.
- Avoid `const enum` in library code — it requires `isolatedModules` consumers to also use it.
- Never use computed or heterogeneous enum members — keep enums simple.

## Null Safety

- Enable `strictNullChecks` — it's included in `strict: true`.
- Use `| null` or `| undefined` explicitly in types — don't let nullability be implicit.
- Use optional properties (`prop?: Type`) for truly optional fields.
- Use `??` (nullish coalescing) for defaults: `value ?? defaultValue`.
- Use `?.` (optional chaining) for safe access: `user?.address?.city`.
- Avoid non-null assertion `!` — it's a lie to the compiler. Use proper null checks.
- Use `Map.get()` return type (`T | undefined`) correctly — always check before use.

## Functions & Overloads

- Use function overloads for multiple call signatures — but prefer union return types when simpler.
- Use `void` return type for functions that don't return a value.
- Use `never` return type for functions that always throw or never return.
- Use rest parameters with tuple types: `function foo(...args: [string, number])`.
- Prefer `(param: Type) => ReturnType` over `Function` type — `Function` is effectively `any`.
- Use `Parameters<typeof fn>` to get parameter types from an existing function.
- Use callback types instead of `Function`: `type Callback = (error: Error | null, result: T) => void`.

## Classes

- Use `private` for encapsulation; `protected` for inheritance; `public` is default.
- Use `readonly` for properties set only in the constructor.
- Use `#privateField` (ECMAScript private) for runtime privacy — `private` is compile-time only.
- Use `abstract` classes for base classes that should not be instantiated directly.
- Use `implements` to enforce interface conformance on classes.
- Use parameter properties for concise constructors: `constructor(private name: string)`.
- Prefer composition over inheritance — use interfaces and dependency injection.

## Modules & Imports

- Use `import type { T }` for type-only imports — they're erased at compile time and help with circular deps.
- Use `export type { T }` for type-only exports.
- Enable `isolatedModules` for compatibility with transpilers (esbuild, SWC, Babel).
- Enable `esModuleInterop` for cleaner default imports from CJS modules.
- Use path aliases in `tsconfig.json` for cleaner imports: `@/services/user` instead of `../../../services/user`.
- Enable `moduleResolution: "bundler"` or `"node16"` — avoid legacy `"node"` resolution.
- Enable `resolveJsonModule` to import JSON files with types.

## Error Handling

- Type error results with discriminated unions: `type Result<T> = { ok: true; value: T } | { ok: false; error: Error }`.
- `catch` clause variable is `unknown` in TS 4.4+ with `useUnknownInCatchVariables` — always narrow before use.
- Use `instanceof Error` to narrow caught errors.
- Create typed custom errors: `class NotFoundError extends Error { statusCode = 404 as const; }`.
- Use branded types for validated data: `type Email = string & { __brand: 'Email' }`.

## Configuration

- Enable these `tsconfig.json` options: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`.
- `noUncheckedIndexedAccess` makes index signatures return `T | undefined` — catches missing key bugs.
- Use `target` and `lib` appropriate to your runtime — `ES2022` for modern Node.js.
- Use `skipLibCheck: true` to speed up compilation — only check your own types.
- Use `declaration: true` and `declarationMap: true` for library packages.

## Advanced Patterns

- Use template literal types for string pattern types: `` type Route = `/${string}` ``.
- Use mapped types for transformations: `type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] }`.
- Use conditional types for type-level logic: `type IsString<T> = T extends string ? true : false`.
- Use `infer` in conditional types: `type ElementType<T> = T extends Array<infer E> ? E : never`.
- Use recursive types for tree structures: `type Tree<T> = { value: T; children: Tree<T>[] }`.
- Use branded types for nominal typing: `type USD = number & { __brand: 'USD' }`.
- Use `const` type parameters (TS 5.0+): `function foo<const T extends string[]>(args: T)`.
- Use `satisfies` for config objects that need both inference and validation.
- Use declaration merging for extending third-party types.
- Use module augmentation: `declare module 'express' { interface Request { user: User } }`.

## Testing TypeScript

- Use `ts-jest`, `vitest`, or `tsx` for running TypeScript tests directly.
- Test types with `tsd`, `expect-type`, or `@ts-expect-error` comments.
- Use `@ts-expect-error` over `@ts-ignore` — it errors when the suppressed error is fixed.
- Mock typed dependencies with `jest.Mocked<typeof module>` or `vi.mocked()`.
- Use `Partial<T>` for creating test fixtures when you don't need all properties.
- Use factory functions for test data: `function createUser(overrides?: Partial<User>): User`.

## Optimization Tips

- Use `const enum` to inline values at compile time — no runtime lookup.
- Use `interface` over `type` for object shapes — interfaces are faster for the compiler.
- Use `skipLibCheck: true` to speed up compilation.
- Use `incremental: true` for faster rebuilds.
- Use project references for monorepos — enables parallel compilation.
- Use `tsc --noEmit` for type checking only; use esbuild/SWC for fast transpilation.
- Avoid excessive type-level computation — complex conditional types slow compilation.
- Use `@ts-expect-error` to document intentional type violations with explanation.
- Avoid `Object.keys()` for type-safe iteration — use type-narrowed alternatives or cast.
- Use `Map<K, V>` and `Set<T>` with proper type parameters for type-safe collections.
