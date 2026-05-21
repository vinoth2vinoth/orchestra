# Reliability Recovery Demo

This deterministic demo shows Orchestra keeping a multi-AI-Agent workflow organized when execution is not clean.

It proves three things without paid provider keys:

- The orchestrator can run several AI Agents through the queue path.
- A failed AI Agent task is retried and still reaches a final decision.
- A stale late result from an expired lease cannot overwrite the accepted result.

## Run

```bash
npm run demo:reliability
```

## Validate

```bash
npm run test:reliability-demo
```

This example uses local deterministic AI Agents so contributors can verify the recovery behavior before wiring in live model providers.
