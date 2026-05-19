# Python Orchestra Prototype

This directory is a standalone Python prototype. It is not wired into the TypeScript
Orchestra server, agent registry, event store, memory mesh, or HTTP API.

Use it only for isolated experiments around escalation, validation, and pipeline
routing. Production workflows should use the TypeScript framework entrypoints unless
an explicit bridge is added between this package and the TypeScript server.

For offline regression tests, set `MOCK_DEEPSEEK=1` so the prototype does not call
the DeepSeek API.
