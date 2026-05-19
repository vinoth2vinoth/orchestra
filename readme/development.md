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
npm run test:projects
npm run examples:check
npm run build
npm audit --audit-level=low
```

The security suite covers path safety, tool modes, and state-correctness regressions. The architecture suite covers queue behavior, runtime context, memory persistence, audit log integrity, plugin governance, and audit regressions. The project suite submits representative easy-to-complex workflow prompts through the framework simulation path.

## Examples

The files in `examples/` are typechecked by `npm run examples:check`. They are intended as current API references and should compile without requiring live LLM calls. If an example becomes aspirational or depends on an external service, mark that clearly in the file and keep the default check deterministic.

## Workspace Directory

`workspace/` is a local development area and regression-test fixture directory. It is not production application storage. Tests may create temporary files under `workspace/`; production deployments should use configured storage, state adapters, and secret management rather than treating this folder as durable user data.

## Environment Notes

- `ORCHESTRA_API_TOKEN` is required for API routes unless `ORCHESTRA_DEV_AUTH_BYPASS=true`.
- `ORCHESTRA_ENCRYPTION_KEY` is required in production. Development may warn when the fallback key is used.
- `ORCHESTRA_TOOL_MODE=mock` keeps external tools deterministic by default.
- `ORCHESTRA_ENABLE_CODE_SANDBOX=false` is the safe default unless execution is isolated outside Node's `vm`.
- `ORCHESTRA_ENABLE_EXPERIMENTAL_PLUGINS=false` keeps demo or stochastic plugins out of the default runtime.
- `ORCHESTRA_STATE_ADAPTER=redis` with `REDIS_URL` should be used when testing distributed state behavior beyond the in-memory adapter.

## Pull Request Expectations

Before opening a pull request, run:

```bash
npm run check
npm audit --audit-level=low
```

Update tests or documentation when changing runtime behavior, security boundaries, tool execution, queue semantics, memory/state behavior, or public examples.
