# Changelog

All notable changes to Orchestra are documented here. The project uses early `0.x` versions while the public API is still stabilizing.

## [0.1.0] - 2026-05-21

First public reliability baseline.

### Added

- CI-backed validation with `npm run check`, security tests, architecture tests, reliability tests, provider tests, examples checks, and production build verification.
- Reliability recovery demo showing AI Agent retry behavior and stale-result protection without paid API keys.
- Provider flexibility contracts for explicit provider selection, OpenAI-compatible native REST calls, Gemini native REST calls, and fallback behavior.
- Runtime durability scoping so custom state backends are used by EventStore and QueueBroker instead of silently falling back to global services.
- Complete AI Agent audit outcomes for start, success, failure, and cache-hit paths.
- Event reload, queue lease recovery, checkpoint resume, and audit hash-chain regression tests.
- Public SDK contract tests to keep examples on the supported entrypoint.

### Changed

- Public docs now emphasize reliability, safety, provider flexibility, and testable claims.
- Append-only audit storage avoids full log rewrites during normal append operations.
- Release process is now documented in `docs/RELEASE.md`.

### Security

- Workspace path traversal checks, API auth middleware behavior, tool execution modes, state mutation safety, and runtime artifact checks are covered by repeatable tests.

### Notes

- Orchestra remains early-stage. `0.1.0` means the framework has a tested reliability baseline, not a final stable API.
