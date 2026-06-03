# Angular Best Practices — Exhaustive Code Review Guide

## Architecture & Project Structure

- Use feature modules — group related components, services, pipes, and directives by domain.
- Use shared modules for reusable components, pipes, and directives used across features.
- Use core module for singleton services (auth, logging, global error handler) — import only in `AppModule`.
- Use lazy loading for feature modules: `loadChildren: () => import('./feature/feature.module')`.
- Follow Angular style guide naming: `user-list.component.ts`, `auth.service.ts`, `date-format.pipe.ts`.
- One class per file. One component per file.
- Keep components under 200 lines — extract child components for complex UIs.
- Use standalone components (Angular 14+) to reduce module boilerplate.
- Use `ng generate` for scaffolding — ensures consistent file structure and naming.
- Organize by feature folders, not by type folders (not `components/`, `services/`, `models/`).

## Components

- Use `ChangeDetectionStrategy.OnPush` on all components — drastically improves performance by reducing change detection cycles.
- Use `@Input()` for data flowing into components; `@Output()` with `EventEmitter` for data flowing out.
- Use `input()` and `output()` signal-based APIs (Angular 17+) for reactive inputs.
- Use signals (`signal()`, `computed()`, `effect()`) for reactive state in Angular 16+.
- Keep components focused — single responsibility. Container components manage state; presentational components render UI.
- Don't put business logic in components — delegate to services.
- Use `ngOnInit` for initialization, not the constructor. Constructor is for dependency injection only.
- Implement `OnDestroy` to clean up subscriptions, timers, and event listeners.
- Use `async` pipe in templates for Observables — auto-subscribes and unsubscribes.
- Avoid `subscribe()` in components — use `async` pipe or `takeUntilDestroyed()` (Angular 16+).
- Use `trackBy` with `*ngFor` for list performance: `*ngFor="let item of items; trackBy: trackById"`.
- Use `@defer` (Angular 17+) for lazy-loading component subtrees.
- Use `ng-container` for structural directives without adding extra DOM elements.
- Use `ng-content` for content projection (transclusion).
- Use `@ViewChild`/`@ContentChild` with `{ static: true }` when accessing in `ngOnInit`.
- Avoid direct DOM manipulation — use `Renderer2` if you must.

## Templates

- Keep templates clean — no complex logic. Move logic to component class or pipes.
- Use `*ngIf; else` syntax: `*ngIf="data; else loading"` with `<ng-template #loading>`.
- Use `@if`, `@for`, `@switch` control flow (Angular 17+) instead of structural directives.
- Use `@for` with `track` expression (Angular 17+): `@for (item of items; track item.id)`.
- Avoid function calls in templates — they run on every change detection. Use pipes or signals.
- Use pure pipes for data transformation — they only recompute when input changes.
- Don't use `ngStyle` or `ngClass` with complex expressions — precompute in the component.
- Use `[class.active]="isActive"` for single class bindings.
- Use `[attr.aria-label]="label"` for accessibility attributes.
- Don't use `$event.target.value` with casts — use template reference variables: `#input` then `input.value`.
- Use two-way binding `[(ngModel)]` only in forms — not for component communication.

## Services & Dependency Injection

- Services are singletons by default when `providedIn: 'root'`.
- Use `providedIn: 'root'` for app-wide singleton services — tree-shakeable.
- Use component-level providers for services that need per-component instances.
- Use `InjectionToken` for non-class dependencies (config objects, strings).
- Use constructor injection — never use `Injector` to manually resolve dependencies.
- Services should contain business logic, API calls, and state management.
- Use `inject()` function (Angular 14+) as an alternative to constructor injection.
- Don't inject services into other services unless there's a clear dependency.
- Use interfaces or abstract classes for service contracts — enables testing with mocks.

## RxJS & Reactive Programming

- Use `async` pipe to subscribe in templates — automatic cleanup, no memory leaks.
- Avoid nested `subscribe()` — use `switchMap`, `mergeMap`, `concatMap`, `exhaustMap` instead.
- Use `switchMap` when only the latest value matters (search, autocomplete).
- Use `concatMap` when order matters and you need sequential execution.
- Use `mergeMap` when order doesn't matter and parallel execution is fine.
- Use `exhaustMap` when you want to ignore new emissions until the current one completes (form submit).
- Use `takeUntil(destroy$)` or `takeUntilDestroyed()` to unsubscribe in components.
- Use `distinctUntilChanged()` to skip duplicate emissions.
- Use `debounceTime(300)` for user input (search, filter).
- Use `catchError()` for error handling in streams — always return a fallback Observable.
- Use `tap()` for side effects (logging, analytics) without modifying the stream.
- Use `shareReplay(1)` for caching the last emitted value across multiple subscribers.
- Use `combineLatest()` or `forkJoin()` for combining multiple Observables.
- `forkJoin` waits for all to complete; `combineLatest` emits on any change.
- Avoid creating hot Observables in services without proper cleanup.
- Use `BehaviorSubject` for state that always has a current value.
- Use `Subject` for event buses — but prefer EventEmitter for component communication.
- Don't expose `Subject` directly — expose `.asObservable()`.

## Forms

- Use Reactive Forms (`FormGroup`, `FormControl`) for complex forms — full control, testable.
- Use Template-driven forms only for simple forms (login, search).
- Use `FormBuilder` for concise form creation.
- Add validators at creation: `Validators.required`, `Validators.minLength(3)`, `Validators.email`.
- Create custom validators as functions returning `ValidationErrors | null`.
- Use async validators for server-side validation (email uniqueness).
- Show errors only when the field is touched and dirty: `*ngIf="field.touched && field.invalid"`.
- Use `FormArray` for dynamic lists of form controls.
- Typed forms (Angular 14+): use `FormControl<string>` for type-safe form values.
- Disable submit button while form is invalid or submitting.
- Use `updateOn: 'blur'` for expensive validations to avoid validating on every keystroke.

## Routing

- Use lazy loading for all feature modules.
- Use route guards: `canActivate`, `canDeactivate`, `canLoad`, `resolve`.
- Use functional guards (Angular 15+): `canActivate: [() => inject(AuthService).isLoggedIn()]`.
- Use route resolvers to preload data before component renders.
- Use `RouterLink` directive instead of programmatic navigation for static links.
- Use `ActivatedRoute` for accessing route params, query params, and data.
- Use `routerLinkActive` for highlighting active navigation links.
- Preload lazy modules with `PreloadAllModules` or custom preloading strategies.
- Use `pathMatch: 'full'` for empty-path routes to avoid unexpected matches.

## State Management

- For simple apps: use services with `BehaviorSubject`.
- For complex apps: use NgRx, NGXS, or Akita.
- NgRx: use `createFeature`, `createActionGroup` (NgRx 15+) for concise boilerplate.
- Use selectors for derived state — memoized by default.
- Use effects for side effects (API calls, navigation, logging).
- Keep state normalized — avoid deeply nested objects.
- Use component store (`@ngrx/component-store`) for local component state.
- Use signals store (`@ngrx/signals`) for signal-based state management (NgRx 17+).
- Don't put UI-only state (modal open, tab index) in global store — keep it local.

## HTTP & API

- Use `HttpClient` from `@angular/common/http` — never raw `fetch` or `XMLHttpRequest`.
- Use interceptors for cross-cutting concerns: auth headers, error handling, logging, retry.
- Use functional interceptors (Angular 15+) instead of class-based.
- Type all HTTP responses: `http.get<User[]>('/api/users')`.
- Handle HTTP errors in interceptors or with `catchError` in service methods.
- Use `retry(3)` for idempotent requests that may fail transiently.
- Use `HttpParams` for query parameters — never string concatenation.
- Cancel in-flight requests with `switchMap` (auto-cancels previous) or `AbortController`.
- Use `transferState` or `TransferHttpCacheModule` for SSR to avoid duplicate requests.

## Performance

- Use `OnPush` change detection everywhere — it's the single biggest performance win.
- Use `trackBy` in `*ngFor` / `track` in `@for` — prevents re-rendering unchanged items.
- Use `async` pipe — avoids manual subscription management and triggers change detection only when needed.
- Avoid function calls in templates — they execute on every CD cycle. Use pure pipes or computed signals.
- Use `@defer` for lazy-rendering heavy components.
- Use virtual scrolling (`cdk-virtual-scroll-viewport`) for long lists.
- Lazy load images with `NgOptimizedImage` directive (Angular 15+).
- Use `runOutsideAngular()` for third-party libraries that don't need change detection (charts, maps).
- Use server-side rendering (Angular Universal) or SSG for initial page load performance.
- Preload lazy modules for anticipated navigation.
- Use Web Workers for CPU-intensive operations.
- Use `ChangeDetectorRef.detach()` and `detectChanges()` for manual CD control in extreme cases.
- Bundle analysis: use `source-map-explorer` or `webpack-bundle-analyzer` to find bloat.

## Testing

- Use `TestBed` for component and service tests.
- Use `ComponentFixture` for DOM interactions.
- Use `fakeAsync`/`tick` for testing async operations.
- Use `HttpClientTestingModule` and `HttpTestingController` for HTTP tests.
- Use `RouterTestingModule` for routing tests.
- Mock services with `jasmine.createSpyObj` or `jest.fn()`.
- Test component inputs/outputs: set `component.input = value`, then `expect(component.output.emit)`.
- Test template rendering: `fixture.nativeElement.querySelector('.class')`.
- Test user interactions: `click()`, `input events`, `form submissions`.
- Use `spectator` library for less boilerplate in component tests.
- Test pipes independently — they're pure functions.
- Test guards and interceptors independently.
- Use Cypress or Playwright for E2E tests.

## Security

- Use Angular's built-in XSS protection — it sanitizes values in templates by default.
- Never bypass sanitization with `bypassSecurityTrustHtml()` unless absolutely necessary (and sanitize first).
- Use `HttpOnly`, `Secure`, `SameSite` cookies for authentication tokens.
- Validate all user input on the server — client-side validation is for UX, not security.
- Use CSRF tokens for cookie-based authentication.
- Use Content Security Policy (CSP) headers.
- Don't expose sensitive data in route parameters or query strings.
- Use environment files for API URLs — but never for secrets (they're in the bundle).

## Clean Code

- Follow Angular style guide for naming, file structure, and conventions.
- Use `readonly` for injected services: `constructor(private readonly userService: UserService)`.
- Use `const` for values that don't change.
- Use barrel files (`index.ts`) for feature module exports — but be aware of tree-shaking implications.
- Use TypeScript strict mode in `tsconfig.json`.
- Use ESLint with `@angular-eslint` — TSLint is deprecated.
- Use Prettier for formatting.
- Document complex components and services with JSDoc.
- Remove unused imports, variables, and code.
- Use meaningful commit messages following Conventional Commits.

## Signals (Angular 16+)

- Use `signal()` for reactive state: `count = signal(0)`.
- Use `computed()` for derived values: `double = computed(() => this.count() * 2)`.
- Use `effect()` for side effects when signals change.
- Signals are synchronous and glitch-free — always consistent.
- Use `input()` and `output()` signal-based component APIs (Angular 17+).
- Use `toSignal()` to convert Observables to signals.
- Use `toObservable()` to convert signals to Observables.
- Signals are the future of Angular reactivity — prefer over RxJS for simple state.

## Optimization Tips

- Enable `OnPush` change detection on every component — reduces CD cycles dramatically.
- Use `@defer (on viewport)` for below-the-fold content — loads only when visible.
- Use `@defer (on idle)` for non-critical content — loads when browser is idle.
- Use `provideHttpClient(withFetch())` in Angular 17+ for faster HTTP with native fetch.
- Use `RouterLink` instead of `routerLink` attribute for type safety.
- Use `inject()` function instead of constructor injection for tree-shakeable dependencies.
- Pre-connect to API domains: `<link rel="preconnect" href="https://api.example.com">`.
- Use `image` directive for optimized image loading: `<img ngSrc="photo.jpg" width="300" height="200">`.

## Code Review Checklist

- Is `OnPush` change detection used on all components?
- Are subscriptions cleaned up (async pipe, takeUntilDestroyed, OnDestroy)?
- Are services injected with `providedIn: 'root'` or appropriate scope?
- Is business logic in services, not components?
- Are forms validated (required fields, min/max, custom validators)?
- Is HTTP error handling consistent (interceptors + service-level)?
- Are routes lazy-loaded?
- Is the template free of function calls and complex expressions?
- Are trackBy/track used in lists?
- Is the app accessible (ARIA, keyboard navigation, semantic HTML)?
- Are unit tests written for components, services, and pipes?
- Is TypeScript strict mode enabled?
