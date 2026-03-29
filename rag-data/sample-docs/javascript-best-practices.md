# JavaScript Best Practices

- Prefer `const` and `let` over `var` to avoid hoisting surprises.
- Keep functions small and focused on a single responsibility.
- Avoid implicit type coercion in comparisons; use `===` and `!==`.
- Use descriptive names for functions and variables; avoid single-letter names.
- Validate external input at boundaries and fail fast on invalid data.
- Handle async errors with try/catch when using async/await.
- Favor pure functions where possible to simplify testing.
- Use structured logging instead of console statements in production systems.
