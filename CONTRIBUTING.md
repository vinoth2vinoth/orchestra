# Contributing to Orchestra

First off, thank you for considering contributing to Orchestra. The project is focused on reliable, observable multi-AI-Agent workflows.

## Table of Contents

1. [Where to Ask Questions](#where-to-ask-questions)
2. [How to Report Bugs](#how-to-report-bugs)
3. [How to Suggest Enhancements](#how-to-suggest-enhancements)
4. [Setting up Your Local Environment](#setting-up-your-local-environment)
5. [Development Workflow](#development-workflow)
6. [Pull Request Guidelines](#pull-request-guidelines)

---

## Where to Ask Questions

If you have a question about how to use Orchestra, please check the existing issues or start a GitHub Discussion. Please do not use the issue tracker for general support questions.

## How to Report Bugs

We use GitHub issues to track public bugs. Report a bug by opening a new issue using the **Bug Report** template. Ensure you include:
- A clear, descriptive title.
- Exact, step-by-step instructions to reproduce the issue.
- Expected behavior versus actual behavior.
- Contextual information (OS, Node.js version, and framework version).
- Relevant `.log` traces or `EventStore` output.

## How to Suggest Enhancements

Enhancements are highly welcomed and tracked as GitHub issues. Use the **Feature Request** or **Architecture Proposal** templates.
- Provide a compelling reason why the feature should be included.
- Consider what alternatives exist.
- Keep the scope as focused as possible.

## Setting up Your Local Environment

1. **Fork and Clone** the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Orchestra.git
   cd Orchestra
   ```
2. **Install Dependencies**:
   We strongly recommend using Node.js v20.x or higher to fully support our internal threading bounds.
   ```bash
   npm install
   ```
3. **Environment Variables**:
   Copy `.env.example` to `.env` and configure your local LLM API keys and telemetry endpoints required for end-to-end testing.

## Development Workflow

1. **Create a descriptive branch name**:
   Use standard prefixes: `feat/`, `fix/`, `docs/`, `chore/`.
   ```bash
   git checkout -b feat/mcp-integration-layer
   ```
2. **Make your changes**: Write clean, modular **TypeScript** code. Avoid `any` types wherever possible.
3. **Test thoroughly**: Run the internal test suites to verify system boundaries aren't broken.
   ```bash
   npm run test
   ```
4. **Lint and validate**: Ensure your code meets the current type and regression checks.
   ```bash
   npm run lint
   npm run check
   ```

## Pull Request Guidelines

- Use a clear PR title and fill out the provided **Pull Request Template** completely.
- If your PR resolves an open issue, link to it in the description (e.g., `Fixes #123`).
- Keep PRs scoped and focused. If you are adding multiple unrelated features, open multiple dedicated PRs.
- Your PR requires passing CI checks and at least one approval from a core maintainer before it can be merged.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).
