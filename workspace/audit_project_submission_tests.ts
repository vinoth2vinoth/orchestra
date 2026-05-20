import { Orchestrator, WorkflowConfig } from '../src/framework/orchestration/Orchestrator.ts';
import { ManagerAgent } from '../src/framework/agents/ManagerAgent.ts';
import { WorkerAgent } from '../src/framework/agents/WorkerAgent.ts';
import { CriticAgent } from '../src/framework/agents/CriticAgent.ts';
import { PlannerAgent } from '../src/framework/agents/PlannerAgent.ts';
import { BaseAgent } from '../src/framework/agents/BaseAgent.ts';
import { MemoryMesh } from '../src/framework/memory/MemoryMesh.ts';
import { SimulationManager } from '../src/framework/core/SimulationManager.ts';
import { globalRegistry } from '../src/framework/agents/AgentRegistry.ts';
import { globalWorkerCluster } from '../src/framework/orchestration/WorkerCluster.ts';

type CaseDef = {
  name: string;
  paradigm: WorkflowConfig['paradigm'];
  task: string;
  agents: BaseAgent[];
  edges?: { from: string; to: string }[];
  useDistributedQueue?: boolean;
  maxIterations?: number;
  expectedKeywords?: string[];
};

const llmConfig = {
  apiKey: 'SIMULATION_ONLY',
  modelName: 'gemini-2.5-flash',
  disableSummarization: true,
};

function makeAgent(kind: 'manager' | 'planner' | 'worker' | 'critic', id: string, name: string, instruction: string, memory: MemoryMesh): BaseAgent {
  if (kind === 'manager') return new ManagerAgent(name, instruction, 'MANAGER', memory, llmConfig, [], undefined, 1, 1, id);
  if (kind === 'planner') return new PlannerAgent(name, instruction, 'PLANNER', memory, llmConfig, [], undefined, 1, 1, id);
  if (kind === 'critic') return new CriticAgent(name, instruction, 'CRITIC', memory, llmConfig, [], undefined, 1, 1, id);
  return new WorkerAgent(name, instruction, 'WORKER', memory, llmConfig, [], undefined, 1, 1, id);
}

async function runCase(testCase: CaseDef) {
  console.log(`[audit] starting ${testCase.name}`);
  globalRegistry.clear();
  for (const agent of testCase.agents) globalRegistry.register(agent);

  for (const manager of testCase.agents.filter((agent): agent is ManagerAgent => agent instanceof ManagerAgent)) {
    if (testCase.edges?.length) {
      const subordinateIds = testCase.edges.filter(edge => edge.from === manager.card.id).map(edge => edge.to);
      manager.setSubordinates(testCase.agents.filter(agent => subordinateIds.includes(agent.card.id)));
    } else {
      manager.setSubordinates(testCase.agents.filter(agent => agent !== manager));
    }
  }

  const orchestrator = new Orchestrator();
  const started = Date.now();
  try {
    const workflow = orchestrator.executeWorkflow(
      testCase.task,
      {
        paradigm: testCase.paradigm,
        agents: testCase.agents,
        edges: testCase.edges,
        maxRetries: 1,
        maxIterations: testCase.maxIterations ?? 3,
        blackboard: { submittedBy: 'audit_project_submission_tests', complexity: testCase.name },
        useDistributedQueue: testCase.useDistributedQueue,
      },
      `AUDIT_${testCase.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`
    );
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Test case timed out after 30000ms')), 30000).unref?.();
    });
    const result = await Promise.race([workflow, timeout]);
    const serializedResult = JSON.stringify(result);
    const missingKeywords = (testCase.expectedKeywords || []).filter(keyword =>
      !serializedResult.toLowerCase().includes(keyword.toLowerCase())
    );
    if (missingKeywords.length > 0) {
      throw new Error(`Result missing expected keywords: ${missingKeywords.join(', ')}. Preview: ${serializedResult.slice(0, 500)}`);
    }

    return {
      name: testCase.name,
      paradigm: testCase.paradigm,
      ok: true,
      ms: Date.now() - started,
      resultPreview: JSON.stringify(result).slice(0, 600),
    };
  } catch (error: any) {
    return {
      name: testCase.name,
      paradigm: testCase.paradigm,
      ok: false,
      ms: Date.now() - started,
      error: error.message,
    };
  }
}

async function main() {
  SimulationManager.enable();
  let exitCode = 0;
  try {
    globalWorkerCluster.init(3);
    const cases: CaseDef[] = [];

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '01 easy static page',
        paradigm: 'HIERARCHICAL',
        task: 'Build a static hello-world page with a button and concise implementation notes.',
        agents: [
          makeAgent('manager', 'm1', 'Manager', 'Coordinate the implementation.', memory),
          makeAgent('worker', 'w1', 'Developer', 'Create the page and implementation notes.', memory),
        ],
        expectedKeywords: ['static html', 'button'],
      });
    }

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '02 small REST API',
        paradigm: 'MAP_REDUCE',
        task: 'Design a todo REST API with validation and persistence.',
        agents: [
          makeAgent('planner', 'p2', 'Planner', 'Split the API work into parallel subtasks.', memory),
          makeAgent('worker', 'w2a', 'API Designer', 'Design endpoints and validation.', memory),
          makeAgent('worker', 'w2b', 'Storage Designer', 'Design persistence.', memory),
        ],
        expectedKeywords: ['todo rest api', 'validation', 'persistence'],
      });
    }

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '03 graph CRUD app',
        paradigm: 'GRAPH',
        task: 'Create a CRUD inventory app with auth, schema, API, and UI screens.',
        agents: [
          makeAgent('manager', 'm3', 'Manager', 'Coordinate graph flow.', memory),
          makeAgent('worker', 'fe3', 'Frontend', 'Design UI screens.', memory),
          makeAgent('worker', 'be3', 'Backend', 'Design API and database.', memory),
          makeAgent('critic', 'r3', 'Reviewer', 'Review the final output.', memory),
        ],
        edges: [
          { from: 'm3', to: 'fe3' },
          { from: 'm3', to: 'be3' },
          { from: 'fe3', to: 'r3' },
          { from: 'be3', to: 'r3' },
        ],
        expectedKeywords: ['inventory', 'auth', 'database'],
      });
    }

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '04 consensus SaaS architecture',
        paradigm: 'CONSENSUS',
        task: 'Architect a multi-tenant SaaS analytics dashboard with RBAC, billing, and audit logs.',
        agents: [
          makeAgent('worker', 'a4', 'Architect A', 'Propose one architecture.', memory),
          makeAgent('worker', 'b4', 'Architect B', 'Propose one architecture.', memory),
          makeAgent('worker', 'c4', 'Architect C', 'Propose one architecture.', memory),
          makeAgent('critic', 'j4', 'Judge', 'Adjudicate the best final architecture.', memory),
        ],
        expectedKeywords: ['multi-tenant', 'rbac', 'audit'],
      });
    }

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '05 debate healthcare platform',
        paradigm: 'DEBATE',
        task: 'Plan a regulated healthcare AI platform with PHI isolation, human approval, audits, evaluation, and DR.',
        agents: [
          makeAgent('worker', 'sec5', 'Security', 'Argue from security and compliance.', memory),
          makeAgent('worker', 'arch5', 'Architecture', 'Argue from architecture.', memory),
          makeAgent('worker', 'ops5', 'Operations', 'Argue from operations.', memory),
          makeAgent('critic', 'judge5', 'Judge', 'Judge the debate.', memory),
        ],
        maxIterations: 2,
        expectedKeywords: ['healthcare', 'phi', 'audit'],
      });
    }

    {
      const memory = new MemoryMesh();
      cases.push({
        name: '06 distributed hierarchical project',
        paradigm: 'HIERARCHICAL',
        task: 'Create a deployment plan for a collaborative editor with operational runbooks.',
        agents: [
          makeAgent('manager', 'm6', 'Manager', 'Coordinate distributed execution.', memory),
          makeAgent('worker', 'w6a', 'Developer', 'Create implementation plan.', memory),
          makeAgent('critic', 'r6', 'Reviewer', 'Review the plan.', memory),
        ],
        useDistributedQueue: true,
        expectedKeywords: ['deployment', 'runbook'],
      });
    }

    const results = [];
    for (const testCase of cases) results.push(await runCase(testCase));
    console.log(JSON.stringify(results, null, 2));
    exitCode = results.some(result => !result.ok) ? 1 : 0;
  } finally {
    globalWorkerCluster.stop();
  }
  process.exit(exitCode);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
