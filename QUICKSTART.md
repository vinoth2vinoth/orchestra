# Quickstart

This page is for people who want to understand Orchestra quickly.

You do not need paid AI keys for this first demo.

## What Orchestra Does

Orchestra lets several AI-style workers handle one job together.

For example, one worker can check security, another can check design, another can check tests, and a final worker can decide whether the work is safe to approve.

The demo below uses a fake code-change review so you can see the idea without connecting to a paid AI service.

## 1. Install

```bash
git clone https://github.com/vinoth2vinoth/orchestra-multi-agent-ai-framework.git
cd orchestra-multi-agent-ai-framework
npm install
```

## 2. Run The No-Cost Demo

```bash
npm run demo
```

This runs a sample code-review workflow.

You should see a result like this:

```json
{
  "releaseGate": "BLOCK",
  "risk": "critical",
  "needsHumanApproval": true
}
```

Plain English meaning:

- Orchestra found a risky code change.
- It blocked the release.
- It said a human should review the problem before continuing.

## 3. Run The Main Health Check

```bash
npm run check
```

This checks that the project still works after changes.

It runs the tests, checks the example files, and builds the app.

## 4. Start The Local App

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

If another app is already using port `3000`, the terminal will show the correct local address.

## What To Read Next

- [README](README.md) for the full project overview.
- [SDK Guide](docs/SDK.md) if you want to build with Orchestra.
- [Reliability Contract](docs/RELIABILITY.md) if you want to see what failure cases are tested.
- [Benchmarks and Validation](BENCHMARKS.md) if you want the current test list.

## Important Notes

- The first demo does not need AI provider keys.
- Real AI calls need provider keys in `.env`.
- The project is still early-stage, so production use needs extra setup and review.
