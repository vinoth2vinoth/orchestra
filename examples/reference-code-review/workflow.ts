import {
  BaseAgent,
  MemoryMesh,
  Orchestrator,
  globalEventStore,
  type LLMConfig,
  type WorkflowConfig
} from '../../src/framework/index.ts';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ReleaseGate = 'APPROVE' | 'NEEDS_HUMAN_APPROVAL' | 'BLOCK';

export interface PullRequestFile {
  path: string;
  language: string;
  patch: string;
}

export interface PullRequestReviewInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  author: string;
  changedFiles: PullRequestFile[];
  declaredTests: string[];
}

export interface ReviewFinding {
  reviewer: string;
  category: 'security' | 'architecture' | 'testing' | 'release';
  severity: RiskLevel;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface AgentReview {
  reviewer: string;
  risk: RiskLevel;
  summary: string;
  findings: ReviewFinding[];
}

export interface ReleaseDecision {
  reviewer: 'Release Judge';
  releaseGate: ReleaseGate;
  risk: RiskLevel;
  needsHumanApproval: boolean;
  summary: string;
  requiredActions: string[];
}

export interface CodeReviewReferenceResult {
  repository: string;
  pullRequestNumber: number;
  title: string;
  releaseGate: ReleaseGate;
  risk: RiskLevel;
  needsHumanApproval: boolean;
  findings: ReviewFinding[];
  requiredActions: string[];
  agentReviews: Record<string, AgentReview>;
  auditTrailSummary: {
    threadId: string;
    graphCompleted: boolean;
    participatingAgents: string[];
    eventCount: number;
  };
}

const llmConfig: LLMConfig = {
  apiKey: 'SIMULATION_ONLY',
  modelName: 'deterministic-reference-agent'
};

export const samplePullRequest: PullRequestReviewInput = {
  repository: 'acme/payments-api',
  pullRequestNumber: 417,
  title: 'Add deployment webhook endpoint',
  author: 'platform-dev',
  declaredTests: [],
  changedFiles: [
    {
      path: 'src/api/deploy.ts',
      language: 'typescript',
      patch: `
import { exec } from 'node:child_process';

export async function deployWebhook(req, res) {
  if (req.body.token === process.env.DEPLOY_TOKEN) {
    exec(req.body.command);
    res.json({ status: 'deployment_started' });
  }
}
`
    },
    {
      path: 'src/routes.ts',
      language: 'typescript',
      patch: `
router.post('/internal/deploy', deployWebhook);
`
    },
    {
      path: 'docs/deploy-webhook.md',
      language: 'markdown',
      patch: `
# Deployment Webhook

Send a command string to start a deployment.
`
    }
  ]
};

function includesAny(input: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(input));
}

function maxRisk(findings: ReviewFinding[]): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return findings.reduce<RiskLevel>((highest, finding) => (
    order.indexOf(finding.severity) > order.indexOf(highest) ? finding.severity : highest
  ), 'low');
}

function flattenPatches(input: PullRequestReviewInput): string {
  return input.changedFiles.map(file => `${file.path}\n${file.patch}`).join('\n');
}

abstract class DeterministicReferenceAgent extends BaseAgent {
  constructor(id: string, name: string, description: string, role: 'WORKER' | 'JUDGE' = 'WORKER') {
    const memory = new MemoryMesh({ tenantId: 'reference-code-review', namespace: id });
    super(name, description, role, memory, llmConfig, [], undefined, undefined, undefined, id);
  }
}

class SecurityReviewerAgent extends DeterministicReferenceAgent {
  constructor() {
    super('reference-security-reviewer', 'Security Reviewer', 'Detects exploitable code paths and unsafe tool or command execution.');
  }

  public async execute(task: PullRequestReviewInput): Promise<AgentReview> {
    const patch = flattenPatches(task);
    const findings: ReviewFinding[] = [];

    if (includesAny(patch, [/exec\s*\(/, /spawn\s*\(/, /eval\s*\(/])) {
      findings.push({
        reviewer: this.card.name,
        category: 'security',
        severity: 'critical',
        title: 'User-controlled command execution path',
        evidence: 'The deployment endpoint passes request-controlled input into command execution.',
        recommendation: 'Replace shell execution with an allowlisted deployment action and validate all inputs server-side.'
      });
    }

    if (includesAny(patch, [/req\.body\.token\s*===\s*process\.env/, /DEPLOY_TOKEN/])) {
      findings.push({
        reviewer: this.card.name,
        category: 'security',
        severity: 'high',
        title: 'Shared secret used as authorization boundary',
        evidence: 'The endpoint compares a request body token with an environment secret.',
        recommendation: 'Use authenticated service identity, scoped authorization, replay protection, and audit logging.'
      });
    }

    return {
      reviewer: this.card.name,
      risk: maxRisk(findings),
      summary: findings.length > 0 ? 'Security review found release-blocking deployment risks.' : 'No release-blocking security risks found.',
      findings
    };
  }
}

class ArchitectureReviewerAgent extends DeterministicReferenceAgent {
  constructor() {
    super('reference-architecture-reviewer', 'Architecture Reviewer', 'Reviews operational design, failure modes, and governance boundaries.');
  }

  public async execute(task: PullRequestReviewInput): Promise<AgentReview> {
    const patch = flattenPatches(task);
    const findings: ReviewFinding[] = [];

    if (patch.includes('/internal/deploy') && !includesAny(patch, [/audit/i, /idempot/i, /rate.?limit/i])) {
      findings.push({
        reviewer: this.card.name,
        category: 'architecture',
        severity: 'high',
        title: 'Deployment workflow lacks operational controls',
        evidence: 'The route introduces deployment behavior without idempotency, rate limiting, or audit events.',
        recommendation: 'Add a release workflow record, idempotency key, rate limits, and append-only audit events before enabling the route.'
      });
    }

    return {
      reviewer: this.card.name,
      risk: maxRisk(findings),
      summary: findings.length > 0 ? 'Architecture review found missing production controls.' : 'Architecture review found no major design blockers.',
      findings
    };
  }
}

class TestReviewerAgent extends DeterministicReferenceAgent {
  constructor() {
    super('reference-test-reviewer', 'Test Reviewer', 'Checks whether risky behavior is backed by regression coverage.');
  }

  public async execute(task: PullRequestReviewInput): Promise<AgentReview> {
    const touchesRuntimeCode = task.changedFiles.some(file => file.path.startsWith('src/'));
    const hasDeclaredTests = task.declaredTests.length > 0 || task.changedFiles.some(file => /test|spec/i.test(file.path));
    const findings: ReviewFinding[] = [];

    if (touchesRuntimeCode && !hasDeclaredTests) {
      findings.push({
        reviewer: this.card.name,
        category: 'testing',
        severity: 'high',
        title: 'Runtime change has no regression coverage',
        evidence: 'The pull request changes runtime deployment code but declares no tests and includes no test files.',
        recommendation: 'Add unit tests for authorization denial, command validation, replay protection, and audit event emission.'
      });
    }

    return {
      reviewer: this.card.name,
      risk: maxRisk(findings),
      summary: findings.length > 0 ? 'Test review found missing coverage for risky behavior.' : 'Test review found coverage adequate for the change.',
      findings
    };
  }
}

class ReleaseJudgeAgent extends DeterministicReferenceAgent {
  constructor() {
    super('reference-release-judge', 'Release Judge', 'Aggregates specialist reviews and decides release readiness.', 'JUDGE');
  }

  public async execute(task: string): Promise<ReleaseDecision> {
    const hasCritical = task.includes('"severity":"critical"');
    const hasHigh = task.includes('"severity":"high"');

    if (hasCritical) {
      return {
        reviewer: 'Release Judge',
        releaseGate: 'BLOCK',
        risk: 'critical',
        needsHumanApproval: true,
        summary: 'Release blocked because the review found critical command-execution risk.',
        requiredActions: [
          'Remove request-controlled command execution.',
          'Replace shared-token authorization with scoped service identity.',
          'Add audit logging, replay protection, and regression tests.',
          'Request human security approval after remediation.'
        ]
      };
    }

    if (hasHigh) {
      return {
        reviewer: 'Release Judge',
        releaseGate: 'NEEDS_HUMAN_APPROVAL',
        risk: 'high',
        needsHumanApproval: true,
        summary: 'Release requires human approval because high-risk findings remain.',
        requiredActions: ['Resolve or formally accept all high-risk findings.']
      };
    }

    return {
      reviewer: 'Release Judge',
      releaseGate: 'APPROVE',
      risk: 'low',
      needsHumanApproval: false,
      summary: 'Release approved by deterministic reference policy.',
      requiredActions: []
    };
  }
}

export function createReferenceReviewAgents() {
  return {
    security: new SecurityReviewerAgent(),
    architecture: new ArchitectureReviewerAgent(),
    tests: new TestReviewerAgent(),
    judge: new ReleaseJudgeAgent()
  };
}

export async function runCodeReviewReference(
  input: PullRequestReviewInput = samplePullRequest,
  threadId = `REFERENCE_CODE_REVIEW_${Date.now()}`
): Promise<CodeReviewReferenceResult> {
  const agents = createReferenceReviewAgents();
  const agentList = [agents.security, agents.architecture, agents.tests, agents.judge];

  const config: WorkflowConfig = {
    paradigm: 'GRAPH',
    agents: agentList,
    edges: [
      { from: agents.security.card.id, to: agents.judge.card.id },
      { from: agents.architecture.card.id, to: agents.judge.card.id },
      { from: agents.tests.card.id, to: agents.judge.card.id }
    ],
    maxRetries: 0,
    enableLearning: false,
    enableReflection: false,
    blackboard: {
      referenceApp: 'code-review-release-governance',
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber
    }
  };

  const workflowResult = await new Orchestrator().executeWorkflow(input, config, threadId);
  const results = workflowResult.results as Record<string, AgentReview | ReleaseDecision>;
  const specialistReviews = {
    security: results[agents.security.card.id] as AgentReview,
    architecture: results[agents.architecture.card.id] as AgentReview,
    tests: results[agents.tests.card.id] as AgentReview
  };
  const decision = results[agents.judge.card.id] as ReleaseDecision;
  const findings = Object.values(specialistReviews).flatMap(review => review.findings);

  return {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    title: input.title,
    releaseGate: decision.releaseGate,
    risk: decision.risk,
    needsHumanApproval: decision.needsHumanApproval,
    findings,
    requiredActions: decision.requiredActions,
    agentReviews: specialistReviews,
    auditTrailSummary: {
      threadId,
      graphCompleted: workflowResult.graphCompleted === true,
      participatingAgents: agentList.map(agent => agent.card.name),
      eventCount: globalEventStore.getEventsByThread(threadId).length
    }
  };
}
