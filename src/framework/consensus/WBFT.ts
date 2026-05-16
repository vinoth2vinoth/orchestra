import { BaseAgent } from '../agents/BaseAgent.ts';

export interface Vote {
    agentId: string;
    proposedAnswer: string;
}

/**
 * Weighted Byzantine Fault Tolerance (WBFT) Consensus Mechanism
 * Dimension 08: Protects against adversarial persuasion or hallucinating agents
 * by using trust weights and quality weights.
 */
export class WBFTConsensus {
    private trustWeights: Map<string, number> = new Map();
    private alpha = 0.4; // Quality weight factor
    private beta = 0.6;  // Trust weight factor

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

    public async reachConsensus(task: any, agents: BaseAgent[], threadId: string): Promise<string> {
        // Collect independent predictions in parallel for high performance
        const votePromises = agents.map(async (agent) => {
            try {
                const answer = await agent.execute(task, threadId);
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

        // Group identical answers (simplified clustering for exact match)
        // Production system would use Embedding-based semantic clustering 
        const answerWeights = new Map<string, number>();

        for (const vote of votes) {
            const weight = this.getAgentWeight(vote.agentId);
            const currentWeight = answerWeights.get(vote.proposedAnswer) || 0;
            answerWeights.set(vote.proposedAnswer, currentWeight + weight);
        }

        // Find the answer with highest total weight
        let bestAnswer = '';
        let maxWeight = -1;

        answerWeights.forEach((weight, answer) => {
            if (weight > maxWeight) {
                maxWeight = weight;
                bestAnswer = answer;
            }
        });

        // Determine if (2f+1)/n threshold of total vote weights is met
        const totalPossibleWeight = agents.reduce((sum, a) => sum + this.getAgentWeight(a.card.id), 0);
        
        // Approximate 66% supermajority rule weighted
        if (maxWeight >= totalPossibleWeight * 0.66) {
            return bestAnswer;
        } else {
            throw new Error(`Consensus could not be reached. Contested vote. Max weight: ${maxWeight}/${totalPossibleWeight}`);
        }
    }

    public updateTrust(agentId: string, delta: number) {
        const current = this.trustWeights.get(agentId) || 1.0;
        // Restrict bounds between 0.1 and 2.0
        this.trustWeights.set(agentId, Math.max(0.1, Math.min(2.0, current + delta)));
    }
}
