# React Patterns

- Keep component state minimal; derive values when possible.
- Use context for cross-cutting concerns like auth and sockets.
- Memoize expensive renders with `useMemo` and `useCallback` when needed.
- Split large views into smaller components for readability.
- Prefer controlled inputs for form state.
- Handle loading and error states explicitly in UI.
- Avoid excessive prop drilling by creating focused providers.
