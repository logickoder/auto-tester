# Code reviews

## Scope and output

- Review ONLY code introduced or changed by the PR and regressions it causes.
  Read surrounding code to verify behaviour and architectural fit, but do not
  audit, fix, refactor, or request cleanup of the entire codebase.
- Write short, succinct, technical feedback ready to paste as a GitHub comment.
  Use a few prioritized bullets: code location, concrete issue, consequence,
  and suggested fix. Keep the internal checklist out of the published comment.
- Prioritize confirmed, actionable findings. Distinguish must-fix issues from
  optional suggestions; label nonblocking suggestions accordingly.
- Do not force trivial issues to be fixed or invent findings to fill a review.
  When no meaningful issue is found, say "No blocking issues found; suitable
  to merge from this code review, subject to required checks." Do not imply
  unverified tests passed or override failing required checks.
- Identify posted reviews as ZeduTester. Avoid duplicate comments on the same
  revision; update an existing ZeduTester comment when appropriate.
- State testing limits briefly. Do not claim browser verification for isolated
  logic reproductions, or passing CI checks that were not verified.

## Review mindset and feedback

- Catch bugs and edge cases, improve maintainability and architectural fit,
  enforce relevant app standards, and share knowledge respectfully.
- Focus on code, not the author. Explain why the issue matters and give a
  specific, actionable fix. Example: "This response can update the newly
  selected contact. Ignore stale responses when the channel changes."
- Do not show off knowledge, block progress unnecessarily, or rewrite code to
  personal preference. A different valid pattern is not a defect.
- Be balanced: acknowledge a specific good decision when useful, without
  padding the comment with generic praise.
- Leave formatting, import ordering, lint violations, and simple typos to
  automated tools. Do not spend review comments on cosmetic nitpicks.

## Review process

1. Read the PR description and linked issue; understand the business requirement,
   acceptance criteria, and relevant app guidelines and architectural decisions.
   Check CI status when accessible, and state when it cannot be verified.
2. Check size and scope. Above roughly 400 meaningful changed lines, consider
   asking for a logical split when it improves reviewability; size alone is
   not an automatic blocker. Follow the target app's size and override policy.
3. Review the changed design: fit to the problem, coupling, cohesion, file
   placement, realistic performance risks, and tests for changed behaviour.
4. Inspect changed lines for logic, edge cases, null handling, races, error
   handling, security, API contracts, naming, documentation, and maintainability.
5. Before recommending new helpers, search adjacent files and shared modules
   for existing utilities. Check for parameter sprawl, leaky abstractions,
   excessive nesting, stringly typed contracts, check/use races, and no-op updates
   where they create a concrete problem in this PR.
6. Verify findings against the actual callers, lifecycle, request helpers, and
   framework boundaries. Separate PR-introduced defects from pre-existing issues.
7. Give a brief decision when requested: Approve, Comment for minor suggestions,
   or Request Changes for issues that must be addressed. Summarize key concerns
   and acknowledge useful design choices without turning the comment into an audit.

For significant architecture or performance changes, consult relevant reference
guides if the repository provides them. Do not assume referenced guides exist.

## Consolidated (bundle) PRs

A bundle PR combines several tickets, usually listed in a table in the PR
description, with roughly one commit per ticket.

- Map each listed ticket to its commit(s) (`git log base..head`) and review each
  commit's diff against that ticket's "What changed" and "How to test" claims.
  Then review the combined diff for interactions between tickets.
- Check shared components changed by one ticket against all their callers;
  another ticket's page may depend on the old behaviour.
- Flag changes that map to no listed ticket, tickets with no matching change,
  and commit IDs that do not match their ticket, as nonblocking scope notes
  unless they cause a defect.
- In the comment, add a compact per-ticket checklist after the summary: one
  line per ticket with ✅ (verified in code), ⚠️ (finding, see above), or ❓
  (not verifiable from code, e.g. visual-only), plus a few words of evidence.
  Keep findings above the checklist, ordered by severity.

## React review guidance (English)

Apply only the checks relevant to this PR and the app's installed stack. Do not
require migrations, new state libraries, new test frameworks, Server Actions,
or React 19 APIs merely because they are newer.

### Hooks, effects, and state

- Call ordinary Hooks at the top level of components or custom Hooks, before
  conditional returns; not in conditions or loops. Respect documented API
  exceptions such as React's `use` when applicable.
- Check effect dependencies for stale closures and missing resource identity
  (user, channel, organisation). Clean up subscriptions and timers, and cancel
  or ignore obsolete requests where stale results can affect behaviour.
- Derive values during render rather than duplicating them in state/effects.
  Put side effects caused by user actions in the relevant event handler.
- Keep state in the smallest appropriate scope; use the app's existing shared
  state conventions. Check prop/local/store synchronization, immutable updates,
  optimistic rollback, concurrent actions, and state reset on identity changes.

### Performance and component design

- Use `useMemo`, `useCallback`, and `React.memo` only for a concrete expensive
  computation, useful reference stability, or demonstrated rendering concern.
  Inline objects/functions and ordinary rerenders are not automatically bugs.
- Check whether changing dependencies defeat intended memoization. Avoid defining
  rendered component types inside another component when that causes remounts.
- Prefer focused components, clear typed props, composition, and reusable custom
  Hooks where they reduce complexity. Treat component length as a design signal,
  not a rigid 200-line failure rule. Avoid unnecessary prop drilling.
- Check changed long-list behaviour for rendering cost, stable keys, pagination,
  and scroll preservation. Suggest virtualization only when scale justifies it.

### Errors, Suspense, and Server Components

- Verify async failures, loading/empty states, and recovery. Error Boundaries
  handle rendering failures; event-handler and async failures need appropriate
  handling too. Check existing boundary coverage before requesting new wrappers.
- Use meaningful Suspense fallbacks and boundaries that allow useful independent
  loading. Suspense requires a compatible data source; it does not replace
  arbitrary effect-based fetching automatically.
- Respect RSC/client boundaries: client state, effects, event handlers, and
  browser APIs must be in the client module graph. Keep client boundaries narrow
  where practical, but do not demand redundant `use client` directives.
- A client wrapper can receive server-rendered children; do not assume a client
  layout automatically turns every composed child into a Client Component.
- Where server fetching/streaming is already used, check request waterfalls,
  unnecessarily blocking awaits, and placement of loading/error boundaries.

### React 19 Actions and forms

- Where Actions are used, check `useActionState` result/error/pending handling.
  `useFormStatus` must run in a descendant of the form whose status it reads.
- Check that `useOptimistic` updates run in the appropriate Action/transition
  context and reconcile with canonical state; do not assume it supplies backend
  persistence or arbitrary failure recovery. Avoid misleading optimistic success
  for critical operations such as payments.
- Server Actions require the proper server boundary, input validation,
  authentication, and authorization. Client API calls and existing form patterns
  remain valid when they fit the app.

### TanStack Query (only if already used)

- Include all data-affecting parameters in query keys. Reuse typed query options
  where appropriate. Choose stale time, garbage collection, retries, and refetch
  behaviour for the actual data; default settings are not inherently defects.
- After mutations, update or invalidate relevant caches. Check optimistic
  concurrency, rollback, and reconciliation; pending mutation variables only
  provide optimistic UI in the consumers that render them.
- Respect `useSuspenseQuery` limitations, including no `enabled` or
  `placeholderData`. Use component composition for conditional Suspense queries
  and appropriate Error Boundaries for thrown errors; verify actual error and
  refetch semantics rather than assuming all errors behave identically.
- Distinguish `isPending` from `isFetching` and `isLoading` in v5. Consider
  parallel queries for independent resources and deliberate handling of dependencies.

### Tests

- Test changed user-visible behaviour and relevant edge cases, not implementation
  details. Use the app's existing test tooling; do not introduce a runner for review.
- Where React Testing Library is used, prefer `screen`, accessible-role queries,
  and `userEvent` for realistic interactions. In this app, follow existing Cypress
  and manual-test conventions instead of requiring a different framework.
