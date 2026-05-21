import { BaseAgent } from '../agents/BaseAgent.ts';

export interface Vote {
    agentId: string;
    proposedAnswer: string;
}

export type ConsensusExecutor = (
    agent: BaseAgent,
    task: any,
    threadId: string,
    blackboard?: Record<string, any>
) => Promise<any>;

/**
 * Weighted Byzantine Fault Tolerance (WBFT) Consensus Mechanism
 * Dimension 08: Protects against adversarial persuasion or hallucinating agents
 * by using trust weights and quality weights.
 */
export class WBFTConsensus {
    private trustWeights: Map<string, number> = new Map();
    private alpha = 0.4; // Quality weight factor
    private beta = 0.6;  // Trust weight factor
    private readonly similarityThreshold = 0.5;
    private readonly stopWords = new Set([
        'a', 'action', 'an', 'and', 'answer', 'are', 'as', 'at', 'be', 'best', 'by', 'choice',
        'for', 'from', 'great', 'in', 'is', 'it', 'of', 'on', 'or', 'the',
        'this', 'to', 'top', 'with', 'work', 'works'
    ]);

    constructor(initialTrustWeights?: Map<string, number>) {
        if (initialTrustWeights) {
            this.trustWeights = initialTrustWeights;
        }
    }

    private getAgentWeight(agentId: string): number {
        const trust = this.trustWeights.get(agentId) || 1.0;
        // Simplified formulation for calculating active weight
        return this.beta * trust + this.alpha * 1.0;
    }

    private normalizeToken(token: string): string {
        if (token.endsWith('ical')) return token.slice(0, -4);
        if (token.endsWith('ics')) return token.slice(0, -3);
        if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
        if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
        if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
        return token;
    }

    private tokenize(answer: string): Set<string> {
        const tokens = answer
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(token => this.normalizeToken(token))
            .filter(token => !this.stopWords.has(token));

        return new Set(tokens);
    }

    private similarity(a: string, b: string): number {
        const left = this.tokenize(a);
        const right = this.tokenize(b);
        if (left.size === 0 && right.size === 0) return 1;

        let overlap = 0;
        for (const token of left) {
            if (right.has(token)) overlap++;
        }

        return (2 * overlap) / (left.size + right.size);
    }

    public async reachConsensus(
        task: any,
        agents: BaseAgent[],
        threadId: string,
        executeAgentTask?: ConsensusExecutor,
        blackboard?: Record<string, any>
    ): Promise<string> {
        // Collect independent predictions in parallel for high performance
        const votePromises = agents.map(async (agent) => {
            try {
                const answer = executeAgentTask
                    ? await executeAgentTask(agent, task, threadId, blackboard)
                    : await agent.execute(task, threadId);
                return {
                    agentId: agent.card.id,
                    proposedAnswer: typeof answer === 'string' ? answer : JSON.stringify(answer)
                };
            } catch (err) {
                console.warn(`[WBFT] Agent ${agent.card.name} failed to vote: ${err.message}`);
                return null;
            }
        });
        
        const rawVotes = await Promise.all(votePromises);
        const votes = rawVotes.filter((v): v is Vote => v !== null);

        if (votes.length === 0) {
            throw new Error("No agents were able to provide a vote for consensus.");
        }

        const clusters: Array<{ representative: string; weight: number; count: number; answers: string[] }> = [];

        for (const vote of votes) {
            const weight = this.getAgentWeight(vote.agentId);
            const cluster = clusters.find(c => this.similarity(c.representative, vote.proposedAnswer) >= this.similarityThreshold);
            if (cluster) {
                cluster.weight += weight;
                cluster.count += 1;
                cluster.answers.push(vote.proposedAnswer);
            } else {
                clusters.push({
                    representative: vote.proposedAnswer,
                    weight,
                    count: 1,
                    answers: [vote.proposedAnswer]
                });
            }
        }

        // Find the answer with highest total weight
        const bestCluster = clusters.sort((a, b) => b.weight - a.weight)[0];
        const bestAnswer = bestCluster.representative;
        const maxWeight = bestCluster.weight;

        // Determine if (2f+1)/n threshold of total vote weights is met
        const totalPossibleWeight = agents.reduce((sum, a) => sum + this.getAgentWeight(a.card.id), 0);
        const bestAnswerCount = bestCluster.count;
        
        // H3 Remediation: Require both numeric majority AND weight majority
        const weightThresholdMet = maxWeight >= totalPossibleWeight * 0.66;
        const numericMajorityMet = bestAnswerCount > votes.length / 2;

        if (weightThresholdMet && numericMajorityMet) {
            return bestAnswer;
        } else {
            const reason = !weightThresholdMet ? `Weight threshold not met (${maxWeight}/${totalPossibleWeight})` : `Numeric majority not met (${bestAnswerCount}/${votes.length})`;
            throw new Error(`Consensus could not be reached: ${reason}`);
        }
    }

    public updateTrust(agentId: string, delta: number) {
        const current = this.trustWeights.get(agentId) || 1.0;
        // Restrict bounds between 0.1 and 2.0
        this.trustWeights.set(agentId, Math.max(0.1, Math.min(2.0, current + delta)));
    }
}
