import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  buildCodeContext,
  groupBlocksByDocument,
  validateMarkdownReferences
} from '../doc-architect/src/DocArchitect.ts';
import {
  compareAndWriteProjectBoard,
  readProjectBoard
} from '../src/framework/tools/ProjectBoardStore.ts';

async function testDuplicateDocMappingsAreGrouped() {
  const targets = groupBlocksByDocument({
    core: [{ relPath: 'StateAdapter.ts', content: 'core' }],
    orchestration: [{ relPath: 'Orchestrator.ts', content: 'orch' }]
  }, {
    core: 'core-orchestration.md',
    orchestration: 'core-orchestration.md'
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].docFile, 'core-orchestration.md');
  assert.deepEqual(targets[0].blocks, ['core', 'orchestration']);
  assert.deepEqual(targets[0].files.map(file => file.relPath), ['core/StateAdapter.ts', 'orchestration/Orchestrator.ts']);
}

async function testContextBudgetMarksTruncation() {
  const context = buildCodeContext([
    { relPath: 'a.ts', content: 'a'.repeat(100) },
    { relPath: 'b.ts', content: 'b'.repeat(100) }
  ], 80);

  assert(context.includes('--- File: a.ts ---'));
  assert(context.includes('[Truncated:'));
  assert(context.includes('--- File: b.ts ---'));
  assert(context.includes('context budget exhausted'));
}

async function testMarkdownReferenceValidation() {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'workspace', 'doc-validate-'));
  const docsRoot = path.join(tempRoot, 'docs');
  const sourceRoot = path.join(tempRoot, 'src');
  try {
    fs.mkdirSync(docsRoot, { recursive: true });
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(docsRoot, 'existing.md'), '# Existing\n');

    const warnings = await validateMarkdownReferences(
      '[ok](existing.md)\n[web](https://example.com)\n[bad](missing.md)',
      docsRoot,
      sourceRoot
    );

    assert.deepEqual(warnings, ['Broken local markdown link: missing.md']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testProjectBoardVersionConflictBlocksStaleWrite() {
  const projectPath = path.join(process.cwd(), 'workspace', 'projects.json');
  const hadOriginal = fs.existsSync(projectPath);
  const original = hadOriginal ? fs.readFileSync(projectPath, 'utf8') : '';

  try {
    const initial = await compareAndWriteProjectBoard({
      projects: [{ id: 'p1', name: 'One', description: '', createdAt: Date.now(), tasks: [] }]
    });
    await compareAndWriteProjectBoard({
      projects: [{ id: 'p1', name: 'Two', description: '', createdAt: Date.now(), tasks: [] }]
    }, initial.version);

    let rejected = false;
    try {
      await compareAndWriteProjectBoard({
        projects: [{ id: 'p1', name: 'Stale', description: '', createdAt: Date.now(), tasks: [] }]
      }, initial.version);
    } catch (err: any) {
      rejected = err.code === 'VERSION_CONFLICT';
    }

    assert(rejected, 'Expected stale project board write to be rejected.');
    const latest = await readProjectBoard();
    assert.equal(latest.projects[0].name, 'Two');
  } finally {
    if (hadOriginal) {
      fs.writeFileSync(projectPath, original, 'utf8');
    } else if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
    }
  }
}

const tests = [
  ['duplicate doc mappings are grouped', testDuplicateDocMappingsAreGrouped],
  ['context budget marks truncation', testContextBudgetMarksTruncation],
  ['markdown reference validation', testMarkdownReferenceValidation],
  ['project board stale writes are rejected', testProjectBoardVersionConflictBlocksStaleWrite]
] as const;

const results = [];
for (const [name, run] of tests) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - start });
  } catch (err: any) {
    results.push({ name, ok: false, error: err.message, ms: Date.now() - start });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some(result => !result.ok)) process.exit(1);
