# React Best Practices — Exhaustive Code Review Guide

## Component Design

- Use functional components with hooks — class components are legacy.
- One component per file. Keep components small (under 150 lines).
- Extract sub-components when a component does too much.
- Use PascalCase for component names: `UserProfile`, not `userProfile`.
- Prefer composition over prop drilling — use compound components, render props, or context.
- Keep components pure — same props should produce same output, no side effects during render.
- Separate container (logic) components from presentational (UI) components.
- Use `React.memo()` for components that re-render often with the same props — but don't wrap everything.
- Co-locate related files: `UserProfile.jsx`, `UserProfile.css`, `UserProfile.test.jsx` in the same directory.
- Use `children` prop for wrapper/layout components.
- Use `forwardRef` when a component needs to expose its DOM node.

## Hooks

- Follow Rules of Hooks: only call hooks at the top level, only in function components or custom hooks.
- Use `useState` for local component state. Initialize with a function for expensive computations: `useState(() => computeInitial())`.
- Use `useReducer` for complex state logic with multiple sub-values or when next state depends on previous.
- Use `useEffect` for side effects (API calls, subscriptions, DOM mutations). Always return a cleanup function when needed.
- `useEffect` with empty dependency array `[]` runs once on mount — equivalent to `componentDidMount`.
- Always include all referenced values in the dependency array — the `react-hooks/exhaustive-deps` lint rule catches violations.
- Use `useCallback` to memoize functions passed as props to child components — prevents unnecessary re-renders.
- Use `useMemo` for expensive computations that depend on specific values — not for every calculation.
- Don't overuse `useMemo`/`useCallback` — memoization has overhead; only use when profiling shows re-render issues.
- Use `useRef` for values that persist across renders without triggering re-render (DOM refs, timers, previous values).
- Use `useId` for generating unique IDs for accessibility attributes.
- Use `useTransition` for non-urgent state updates that can be interrupted (React 18+).
- Use `useDeferredValue` to defer updating expensive UI until more urgent updates complete.
- Use `useSyncExternalStore` for subscribing to external stores (Redux, Zustand, browser APIs).
- Use `useLayoutEffect` only when you need to read layout and synchronously re-render before the browser paints.

## Custom Hooks

- Extract reusable logic into custom hooks: `useAuth()`, `useFetch()`, `useDebounce()`, `useLocalStorage()`.
- Name custom hooks with `use` prefix — required by React's rules of hooks.
- Custom hooks should return either a value, a tuple `[value, setter]`, or an object `{ data, loading, error }`.
- Keep custom hooks focused on one concern — don't combine auth + fetch + caching in one hook.
- Test custom hooks with `renderHook` from `@testing-library/react`.
- Document hook parameters and return values.

## State Management

- Start with local state (`useState`/`useReducer`) — lift state only when needed.
- Use Context API for global state (theme, auth, locale) — not for frequently changing data (causes full subtree re-renders).
- Split contexts by domain: `AuthContext`, `ThemeContext`, `SocketContext` — not one giant `AppContext`.
- Use state management libraries (Zustand, Jotai, Redux Toolkit) for complex global state.
- Keep state as close to where it's used as possible — don't lift prematurely.
- Derive state from existing state instead of syncing — don't `useEffect` to sync two state variables.
- Never store derived values in state: compute in render or `useMemo`.
- Use `useReducer` with actions for complex state transitions: `dispatch({ type: 'ADD_TODO', payload })`.
- Normalize complex nested state — use flat structures with IDs.
- Don't mirror props in state — use the prop directly or use `key` to reset state when props change.

## Effects & Data Fetching

- `useEffect` is for synchronization with external systems, not for transforming data.
- Don't use `useEffect` for computing derived state — do it during render.
- Don't use `useEffect` for handling events — use event handlers.
- Use cleanup functions to cancel subscriptions, abort fetches, clear timers.
- Use AbortController to cancel fetch requests on component unmount or dependency change.
- For data fetching, prefer libraries: React Query (TanStack Query), SWR, or RTK Query.
- These libraries handle caching, deduplication, background refetching, and error/loading states.
- Avoid race conditions in `useEffect` data fetching — use a cleanup flag or AbortController.
- `useEffect` runs after paint — use `useLayoutEffect` only for DOM measurements before paint.
- Effects fire twice in React 18 Strict Mode (development only) — this is intentional to catch cleanup bugs.

## Performance

- Use React DevTools Profiler to identify slow renders — don't optimize blindly.
- Use `React.memo()` for components receiving stable complex props.
- Use `useCallback` for functions passed to memoized children.
- Use `useMemo` for expensive computations (sorting, filtering large lists).
- Use `key` prop correctly — unique, stable identifiers; never use array index for lists that reorder.
- Avoid creating new objects/arrays in render: `style={{ color: 'red' }}` creates a new object every render — hoist it.
- Use `React.lazy()` and `Suspense` for code splitting.
- Virtualize long lists with `react-window` or `react-virtuoso` — rendering 10,000 items crashes browsers.
- Avoid unnecessary re-renders by splitting state: `const [name, setName] = useState('')` separate from unrelated state.
- Use `children` pattern to prevent re-renders: parent re-renders don't cause `children` to re-render if `children` is passed as prop.
- Debounce input handlers for search/filter: `useDebounce(value, 300)`.
- Use web workers for heavy computation (parsing, image processing).
- Lazy load images with `loading="lazy"` attribute.
- Move expensive components below state changes — component above the state update doesn't re-render.

## Forms

- Use controlled components (`value` + `onChange`) for most forms.
- Use uncontrolled components with `useRef` only for simple, non-validated forms.
- Use form libraries (React Hook Form, Formik) for complex forms with validation.
- React Hook Form is preferred — less re-rendering than Formik.
- Validate on blur, not on every keystroke — reduces noise.
- Show validation errors near the input, not at the top of the form.
- Disable submit button while submitting to prevent double submission.
- Use `htmlFor` attribute on `<label>` for accessibility.
- Use native HTML validation attributes (`required`, `minLength`, `pattern`) as a first layer.
- Use `autoComplete` attributes for browser autofill.

## Event Handling

- Use `onClick`, `onChange`, `onSubmit` — not `addEventListener` (React handles delegation).
- Prevent default form submission: `onSubmit={(e) => { e.preventDefault(); ... }}`.
- Use `e.stopPropagation()` sparingly — prefer restructuring to avoid bubbling issues.
- Don't call `setState` conditionally inside event handlers based on stale closures — use functional updates: `setCount(prev => prev + 1)`.
- Clean up event listeners added via `addEventListener` in `useEffect` cleanup.

## Styling

- Use CSS Modules, Tailwind CSS, or styled-components — avoid global CSS that leaks.
- Use `className` instead of `class` in JSX.
- Prefer `className` strings over inline `style` objects — inline styles can't use media queries, pseudo-selectors, or animations.
- Use CSS custom properties (variables) for theming.
- Use `clsx` or `classnames` for conditional class names: `clsx('btn', { 'btn-active': isActive })`.

## Error Handling

- Use Error Boundaries to catch render errors: wrap sections of the app, not the entire app.
- Error Boundaries only catch errors in render, lifecycle, and constructors — not in event handlers or async code.
- Show fallback UI in Error Boundaries: "Something went wrong. Try again."
- Use `try/catch` in event handlers and async code.
- Display user-friendly error messages — not stack traces.
- Implement retry mechanisms for failed API calls.
- Log errors to monitoring services (Sentry, LogRocket, Datadog).

## Accessibility (a11y)

- Use semantic HTML: `<button>` not `<div onClick>`, `<nav>`, `<main>`, `<article>`, `<aside>`.
- Add `alt` text to all images: `<img alt="Description" />`. Decorative images: `alt=""`.
- Use ARIA attributes when semantic HTML is insufficient.
- Ensure keyboard navigation: all interactive elements must be focusable and operable with keyboard.
- Use `aria-live` for dynamic content updates (notifications, loading states).
- Test with screen readers (NVDA, VoiceOver) and keyboard-only navigation.
- Use `eslint-plugin-jsx-a11y` for automated checks.
- Color contrast ratio must be at least 4.5:1 (WCAG AA).
- Don't remove focus outlines without providing alternatives.

## Routing (React Router)

- Use `<Link>` instead of `<a>` for internal navigation — prevents full page reloads.
- Use route parameters for resource identifiers: `/users/:id`.
- Use `useParams()`, `useSearchParams()`, `useNavigate()` hooks.
- Use lazy loading for route components: `React.lazy(() => import('./Dashboard'))`.
- Use `<Navigate>` for redirects, not `useEffect` with `navigate()`.
- Protect routes with auth guards: redirect to login if not authenticated.
- Use `<Outlet>` for nested routes.
- Use `loader` and `action` (React Router v6.4+) for data loading and mutations.

## Testing

- Use React Testing Library (RTL) — test behavior, not implementation.
- Test what the user sees: `screen.getByText()`, `screen.getByRole()`, `screen.getByLabelText()`.
- Avoid testing implementation details: don't test state values or internal method calls.
- Use `userEvent` over `fireEvent` — it simulates real user interactions more accurately.
- Use `waitFor` for async assertions.
- Use `renderHook` for testing custom hooks.
- Mock API calls with MSW (Mock Service Worker) — intercepts at the network level.
- Test error states, loading states, and empty states.
- Test accessibility with `jest-axe`.
- Use snapshot testing sparingly — prefer explicit assertions.
- Test component interactions: "when user clicks X, Y should appear."

## Security

- Sanitize HTML before using `dangerouslySetInnerHTML` — use DOMPurify.
- Never put user input directly into `dangerouslySetInnerHTML`.
- React auto-escapes JSX expressions — `{userInput}` is safe from XSS by default.
- Validate and sanitize form inputs before submission.
- Use HTTPS for all API calls.
- Don't store sensitive data (tokens, secrets) in React state — use HttpOnly cookies.
- Don't expose API keys in client-side code — use environment variables with `VITE_` or `REACT_APP_` prefix.

## Optimization Tips

- Use `React.lazy()` with `Suspense` to split code by route — reduces initial bundle.
- Use `React.memo()` with custom comparator for complex props: `React.memo(Component, (prev, next) => prev.id === next.id)`.
- Move constant objects/arrays outside the component to prevent re-creation: `const COLORS = ['red', 'blue']` at module level.
- Use `useRef` for values that change frequently but shouldn't trigger re-render (scroll position, mouse coordinates).
- Use `startTransition` to mark non-urgent updates (searching, filtering) — keeps UI responsive.
- Use `<Suspense>` with streaming SSR (Next.js, Remix) for progressive page loading.
- Use `React.StrictMode` in development to catch common bugs.
- Profile renders with React DevTools — identify components that re-render unnecessarily.
- Use `useSyncExternalStore` with snapshot comparison for external store subscriptions — prevents tearing.
