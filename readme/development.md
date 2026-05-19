# Development Guide

This guide is for contributors who want to clone Orchestra, verify it locally, and make changes with confidence.

## Local Setup

```bash
npm ci
cp .env.example .env
```

Set at least one provider key when you want real model calls. The regression suite uses deterministic simulation paths and should not require paid API usage.

For local dashboard development, either configure `ORCHESTRA_API_TOKEN` and send it as a bearer token, or explicitly set:

```env
ORCHESTRA_DEV_AUTH_BYPASS=true
```

Do not enable the auth bypass in production or shared environments.

## Validation Commands

`npm run check` is the canonical confidence command. It runs the typecheck, all regression suites, example typechecks, and the production build.

Useful narrower commands:

```bash
npm run lint
npm run test
npm run test:security
npm run test:architecture
npm run test:reliability
npm run test:state-backend
npm run test:reference
npm run test:projects
npm run example:code-review
npm run examples:check
npm run build
npm audit --audit-level=low
```

The security suite covers path safety, API auth, tool modes, and state-correctness regressions. The architecture suite covers queue behavior, runtime context, memory persistence, audit log integrity, plugin governance, and audit regressions. The reliability suite covers checkpoint recovery, event reload, queue crash recovery, and graph resume behavior. The reference suite validates the deterministic code-review and release-governance example. The project suite submits representative easy-to-complex workflow prompts through the framework simulation path.

`npm run test:state-backend` requires a running Valkey or Redis-compatible key-value backend:

```bash
ORCHESTRA_STATE_ADAPTER=keyvalue ORCHESTRA_STATE_URL=redis://localhost:6379 npm run test:state-backend
```

GitHub Actions runs this command against a Valkey service container. The URL uses the common `redis://` protocol scheme because that is what compatible clients and services use.

## Examples

The files in `examples/` are typechecked by `npm run examples:check`. They are intended as current API references and should compile without requiring live LLM calls. Examples should import from `src/framework/index.ts`, the public SDK entrypoint, instead of deep internal modules. If an example becomes aspirational or depends on an external service, mark that clearly in the file and keep the default check deterministic.

The reference code-review workflow can be run without provider API spend:

```bash
npm run example:code-review
npm run test:reference
```

Workflows that should avoid background model calls must keep `enableLearning` and `enableReflection` disabled unless the test explicitly verifies those features.

## Workspace Directory

`workspace/` is a local development area and regression-test fixture directory. It is not production application storage. Tests may create temporary files under `workspace/`; production deployments should use configured storage, state adapters, and secret management rather than treating this folder as durable user data.

## Environment Notes

- `ORCHESTRA_API_TOKEN` is required for API routes unless `ORCHESTRA_DEV_AUTH_BYPASS=true`.
- `ORCHESTRA_ENCRYPTION_KEY` is required in production. Development may warn when the fallback key is used.
- `ORCHESTRA_TOOL_MODE=mock` keeps external tools deterministic by default.
- `ORCHESTRA_ENABLE_CODE_SANDBOX=false` is the safe default unless execution is isolated outside Node's `vm`.
- `ORCHESTRA_ENABLE_EXPERIMENTAL_PLUGINS=false` keeps demo or stochastic plugins out of the default runtime.
- `ORCHESTRA_STATE_ADAPTER=keyvalue` with `ORCHESTRA_STATE_URL` should be used when testing distributed state behavior beyond the in-memory adapter.

## Pull Request Expectations

Before opening a pull request, run:

```bash
npm run check
npm audit --audit-level=low
```

Update tests or documentation when changing runtime behavior, security boundaries, tool execution, queue semantics, memory/state behavior, or public examples.
