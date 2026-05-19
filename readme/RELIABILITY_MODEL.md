# Reliability Model

Orchestra's reliability goal is simple: workflows should remain explainable and recoverable when agents, tools, workers, queues, checkpoints, or configuration inputs fail.

This document describes the current guarantees, the gaps that still need production adapters, and the regression tests that protect each claim.

## Reliability Principles

1. **Make failure explicit.** Configuration errors should fail fast and should not burn retry budgets.
2. **Persist the recovery boundary.** Long-running workflows should checkpoint enough state to resume without rerunning completed steps.
3. **Prefer idempotent delivery.** Queue workers may see retries; handlers should tolerate duplicate delivery and acknowledge only completed work.
4. **Keep audit and event history append-only.** Runtime events should remain available for debugging, replay, and operator visibility.
5. **Separate development defaults from production guarantees.** In-memory adapters are useful locally, but distributed deployments need durable state, queue, event, and secret backends.

## Verified Recovery Behaviors

The first reliability gauntlet lives in `workspace/reliability_gauntlet_tests.ts` and runs through:

- encrypted checkpoint round-trip and cleanup
- checkpoint tamper detection with storage self-healing
- event-store reload into a fresh `EventStore` instance
- queue lease recovery after a simulated worker crash before ACK/NACK
- graph workflow resume from checkpoint without rerunning completed agents

Run it directly:

```bash
npm run test:reliability
```

Redis-backed durability checks live in `workspace/redis_durability_tests.ts` and verify state-adapter parity plus queue lease recovery using Redis-backed global state:

```bash
ORCHESTRA_STATE_ADAPTER=redis REDIS_URL=redis://localhost:6379 npm run test:redis
```

It is also included in:

```bash
npm run test
npm run check
```

## Runtime Boundaries

### Checkpoints

`StateCheckpointer` writes encrypted snapshots through `StorageMesh`. Current guarantees:

- AES-256-GCM encryption at rest
- production startup fails without `ORCHESTRA_ENCRYPTION_KEY`
- corrupted checkpoint files are detected by storage integrity checks and restored from the latest storage snapshot
- successful workflows clear their checkpoint

Remaining production work:

- external durable checkpoint backend
- checkpoint versioning and migration metadata
- explicit retention policy

### Queue Execution

`QueueBroker` supports lease/ACK/NACK behavior over the configured state adapter. Current guarantees:

- task retries after NACK/error
- dead-letter queue after max attempts
- expired lease recovery when a worker stops before completion
- task records are persisted through `StateAdapter`

Remaining production work:

- Redis-backed or broker-backed integration tests in CI
- idempotency keys at tool boundary
- operator commands for DLQ inspection and replay

### Event History

`EventStore` appends events to the shared state adapter and keeps a local in-memory tail for fast UI access. Current guarantees:

- local append happens before cross-node fanout
- fresh `EventStore` instances can reload persisted history
- payloads pass through secret scrubbing before append

Remaining production work:

- bounded retention per tenant
- durable event stream backend
- replay API for workflow debugging

### State Mutation

`StateAdapter` exposes atomic mutation primitives:

- `mutate`
- `increment`
- `compareAndSwap`

The security regression suite verifies 500 concurrent increments finish at 500 with zero lost updates.

Remaining production work:

- Redis adapter parity tests for all atomic operations
- lock TTL expiry tests
- cross-process state contention benchmarks

## Production Requirements

For production or multi-tenant deployments:

```env
ORCHESTRA_API_TOKEN=
ORCHESTRA_ENCRYPTION_KEY=
ORCHESTRA_STATE_ADAPTER=redis
REDIS_URL=
ORCHESTRA_TOOL_MODE=disabled
ORCHESTRA_ENABLE_CODE_SANDBOX=false
ORCHESTRA_ENABLE_EXPERIMENTAL_PLUGINS=false
```

In-memory state, queue, and event adapters should be treated as local development defaults, not distributed reliability guarantees.

## Adapter Status

| Capability | Memory Adapter | Redis Adapter |
| --- | --- | --- |
| Local development | Verified | Supported |
| Atomic `mutate` / `increment` / `compareAndSwap` | Verified by `test:security` | Verified by `test:redis` |
| Locks | Basic in-process lock | Redis lock with TTL |
| Lists / event history | Verified locally | Verified by Redis parity tests |
| Queue lease recovery | Verified by `test:architecture` and `test:reliability` | Verified by `test:redis` |
| Cross-process durability | Not intended | First CI-backed proof in place |

## Next Reliability Milestones

- Expand Redis-backed CI service tests.
- Add workflow interruption and resume tests that cross a real process boundary.
- Add event replay snapshots for failed workflows.
- Add DLQ replay tooling.
- Add deterministic fault injection for tool timeout, tool denial, model failure, and state adapter outage.
