import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  compareAndWriteProjectBoard,
  readProjectBoard
} from '../src/framework/tools/ProjectBoardStore.ts';

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

async function testProjectBoardMissingFileReturnsEmptyBoard() {
  const projectPath = path.join(process.cwd(), 'workspace', 'projects.json');
  const hadOriginal = fs.existsSync(projectPath);
  const original = hadOriginal ? fs.readFileSync(projectPath, 'utf8') : '';

  try {
    if (fs.existsSync(projectPath)) fs.unlinkSync(projectPath);
    const board = await readProjectBoard();
    assert.deepEqual(board.projects, []);
    assert.equal(typeof board.version, 'string');
    assert(board.version.length > 0);
  } finally {
    if (hadOriginal) {
      fs.writeFileSync(projectPath, original, 'utf8');
    }
  }
}

const tests = [
  ['project board missing file returns empty board', testProjectBoardMissingFileReturnsEmptyBoard],
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
