# Release Process

This checklist keeps Orchestra releases factual, repeatable, and easy to verify.

## Versioning

Orchestra uses `0.x` versions while the public API is still stabilizing.

- Patch releases (`0.1.1`) are for focused fixes, test hardening, and documentation corrections.
- Minor releases (`0.2.0`) are for new proven capabilities, new examples, or public API additions.
- Avoid `1.0.0` until the SDK surface, provider contracts, state backend contracts, and reliability guarantees are stable enough for external users.

## Pre-Release Checklist

Run these checks before tagging a release:

```bash
npm ci
npm audit --audit-level=low
npm run check
```

For changes touching durable state, queueing, or restart behavior, also run:

```bash
npm run test:state-backend
npm run test:durability
npm run test:reliability
```

Confirm:

- `CHANGELOG.md` includes a factual entry for the release.
- README claims still match tested behavior.
- No runtime artifacts are tracked by git.
- Examples still run or type-check without paid API keys unless clearly documented.
- Any breaking change is called out in the changelog and release notes.

## Tagging

Use annotated tags:

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

## Release Notes

Keep release notes calm and specific:

- Say what changed.
- Say what is now tested.
- Mention known limits honestly.
- Do not include private goals, sales language, or exaggerated claims.

Good release-note shape:

```markdown
## Highlights

- Added provider flexibility contract tests.
- Added restart-safe runtime scoping for EventStore and QueueBroker.
- Added complete AI Agent audit outcome records.

## Validation

- npm run check
- npm audit --audit-level=low

## Known Limits

- The framework is still early-stage.
- Production deployments should use a durable StateAdapter and a strong ORCHESTRA_ENCRYPTION_KEY.
```
