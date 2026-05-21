import { BaseAgent } from '../../agents/BaseAgent.ts';
import { ParadigmStrategy, ParadigmContext } from './ParadigmStrategy.ts';
import { WorkflowConfig } from '../Orchestrator.ts';
import { ConfigurationError } from '../../core/ErrorHandler.ts';

/**
 * Debate Paradigm: Agents critique each other's outputs.
 */
export class DebateStrategy extends ParadigmStrategy {
    async run(task: any, agents: BaseAgent[], context: ParadigmContext, config: WorkflowConfig) {
        if (agents.length < 2) throw new Error("DEBATE requires at least two agents.");
        const debaters = agents.filter(a => a.card.role !== 'MANAGER' && a.card.role !== 'JUDGE');
        if (debaters.length < 2) throw new ConfigurationError("DEBATE requires at least 2 WORKER/CRITIC agents.");
        const debateRounds = config.maxIterations || 2;
        let transcript = `Topic for Debate: ${task}\n\n`;
        
        for (let i = 0; i < debateRounds; i++) {
            transcript += `--- Round ${i + 1} ---\n`;
            for (const agent of debaters) {
                const debatePrompt = `${transcript}\n\nAgent ${agent.card.name}, based on the discussion above, present your argument or critique previous statements. Format your response clearly.`;
                let response = await context.executeAgentTask(agent, debatePrompt, context.threadId, context.blackboard);
                if (typeof response === 'object' && response.text) response = response.text;
                
                transcript += `[${agent.card.name}]: ${response}\n\n`;
            }
        }
        
        const judge = agents.find(a => a.card.role === 'MANAGER' || a.card.role === 'JUDGE');
        if (judge) {
            const summaryTask = `The following debate occurred:\n${transcript}\n\nPlease analyze the arguments and provide a final concluded verdict.`;
            let finalVerdict = await context.executeAgentTask(judge, summaryTask, context.threadId, context.blackboard);
            return {
                debateTranscript: transcript,
                finalVerdict
            };
        }
        
        return {
            debateTranscript: transcript,
            finalVerdict: "No judge assigned to provide final verdict."
        };
    }
}
