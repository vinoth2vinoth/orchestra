import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { WBFTConsensus } from '../../consensus/WBFT.ts';

/**
 * Consensus Paradigm: Agents reach agreement via WBFT.
 */
export class ConsensusStrategy extends ParadigmStrategy {
    private wbft = new WBFTConsensus();

    private isValidAnswer(answer: any): boolean {
        if (answer === null || answer === undefined) return false;
        if (typeof answer === 'string') return answer.trim().length > 0 && answer.trim() !== 'null';
        return true;
    }

    async run(task: any, agents: BaseAgent[], context: ParadigmContext) {
        const validVoters = agents.filter(a => a.card.role === 'CRITIC' || a.card.role === 'WORKER');
        if (validVoters.length === 0) throw new Error("Consensus paradigm requires at least one WORKER or CRITIC agent.");

        let consensusResult: string | null = null;
        try {
            consensusResult = await this.wbft.reachConsensus(task, validVoters, context.threadId);
        } catch (err: any) {
            console.warn(`[ConsensusStrategy] WBFT Consensus failed: ${err.message}`);
        }
        
        if (!consensusResult) {
            const judge = agents.find(a => a.card.role === 'MANAGER' || a.card.role === 'JUDGE');
            if (judge) {
                const adjudicationPrompt = `The agent swarm failed to reach consensus on the following task: "${task}".\n\nIndividual agent outputs were inconsistent. Please review the findings and provide a definitive strategic resolution.`;
                const finalAnswer = await context.executeAgentTask(judge, adjudicationPrompt, context.threadId, context.blackboard);
                if (!this.isValidAnswer(finalAnswer)) {
                    throw new Error("Consensus adjudication produced an empty final answer.");
                }
                return { 
                    consensusReached: false, 
                    wasAdjudicated: true,
                    finalAnswer 
                };
            }
            throw new Error("Consensus could not be reached and no MANAGER or JUDGE agent is available for adjudication.");
        }

        if (!this.isValidAnswer(consensusResult)) {
            throw new Error("Consensus reported success but produced an empty final answer.");
        }
        
        return { 
            consensusReached: true, 
            finalAnswer: consensusResult 
        };
    }
}
