# Benchmarks and Validation

This page summarizes the validation commands currently available in Orchestra and the latest local results from the contributor-confidence and reliability sprint.

The goal is not to claim universal performance yet. The goal is to make every public claim reproducible.

## Canonical Commands

```bash
npm run check
npm audit --audit-level=low
```

`npm run check` runs:

- `npm run lint`
- `npm run test`
- `npm run examples:check`
- `npm run build`

`npm run test` runs:

- core framework tests
- security and correctness regressions
- architecture regressions
- reliability gauntlet
- project-submission simulations

## Latest Local Result

Environment:

- Date: 2026-05-19
- OS: Windows
- Runtime: Node.js 25.8.2 locally; CI uses Node.js 22
- Mode: deterministic simulation for framework/project tests

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run test:security` | Passed |
| `npm run test:architecture` | Passed |
| `npm run test:reliability` | Passed |
| `npm run test:redis` | Configured for CI with Redis service container |
| `npm run test:projects` | Passed |
| `npm run test` | Passed |
| `npm run examples:check` | Passed |
| `npm run build` | Passed |
| `npm run check` | Passed |
| `npm audit --audit-level=low` | Passed, 0 vulnerabilities |

Some local Windows sandbox runs may need to be rerun outside the sandbox because `tsx`/esbuild can hit `spawn EPERM`. This is an environment permission issue, not a framework assertion failure. GitHub Actions runs on Ubuntu with Node.js 22.

## Security and Correctness Coverage

`npm run test:security` currently verifies:

- path traversal is blocked in tool file writes
- API auth middleware rejects unauthenticated calls unless the explicit dev bypass is enabled
- `StorageMesh` blocks traversal outside the storage root
- 500 concurrent atomic increments produce 500, not a lost-update value
- stress tests fail on state corruption
- tool modes enforce mock, disabled, live-localhost-blocking, and code-sandbox-disabled behavior
- project board stale writes are rejected

## Architecture Coverage

`npm run test:architecture` currently verifies:

- queue retry success after a transient failure
- dead-letter queue behavior after max attempts
- expired lease recovery
- scoped runtime plugin and tenant context
- memory persistence and tenant isolation
- audit hash-chain segment verification
- plugin registry idempotency and groundedness-stub governance
- Claude audit regressions including graph/map-reduce configuration errors

## Reliability Gauntlet

`npm run test:reliability` currently verifies:

- encrypted checkpoint round-trip and cleanup
- checkpoint tamper detection with storage self-healing
- event-store reload into a fresh store instance
- queue lease recovery after simulated worker crash
- graph workflow resume from checkpoint without rerunning completed agents

## Project-Submission Simulations

`npm run test:projects` submits six representative workflows:

| Case | Paradigm |
| --- | --- |
| Easy static page | Hierarchical |
| Small REST API | Map-reduce |
| Graph CRUD app | Graph |
| Multi-tenant SaaS architecture | Consensus |
| Regulated healthcare platform | Debate |
| Distributed hierarchical project | Hierarchical with distributed queue |

These tests use simulation mode to avoid API spend and to keep CI deterministic.

## Current Performance Signals

From the latest security stress run:

- Event store append: 2,000 events completed successfully
- State adapter concurrency: 500 atomic operations completed with 0 collisions
- Queue lease recovery: crashed lease recovered on the second attempt

Future benchmark work should add Redis-backed runs, cross-process restart tests, larger DAG tests, and provider-specific latency/cost measurements.
