import { BaseAgent } from './BaseAgent.ts';
import { globalGenealogy } from '../governance/GenealogyTracker.ts';
import { globalRegistry } from './AgentRegistry.ts';
import { globalEventStore } from '../core/EventStore.js';
import { Sanitizer } from '../security/Sanitizer.ts';
import { TelemetrySystem } from '../telemetry/TelemetrySystem.ts';

export class WorkerAgent extends BaseAgent {
    public async execute(task: any, threadId: string): Promise<any> {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);

        // Vector-Backed RAG Retrieval
        const relevantMemories = await this.memory.searchSimilarMemories(taskStr, 3);
        const ragContext = relevantMemories.length > 0 
            ? '\n\nRelevant Context (RAG):\n' + relevantMemories.map(m => `- ${Sanitizer.escapePromptInjections(m.content)}`).join('\n')
            : '';

        const messages: any[] = [
            { role: 'user', content: taskStr }
        ];

        let finalAnswer = '';
        let attempts = 0;
        const maxHealingLoops = 3;

        while (attempts < maxHealingLoops) {
            try {
                // Determine current system instruction (Dynamic boosting if recovery)
                let currentInstruction = this.card.description + ragContext;
                if (attempts > 0) {
                    currentInstruction += `\n\n[RECOVERY_MODE]: This is attempt ${attempts + 1} for this task. Previous attempts failed. Prioritize extreme precision and address earlier critique/errors strictly.`;
                }

                const response = await this.generateResponse(
                    currentInstruction,
                    messages,
                    threadId
                );

                finalAnswer = response.text;

                // Check for tool errors in the response
                const toolErrors = response.toolResults?.filter(tr => tr.isError) || [];
                if (toolErrors.length > 0) {
                    const errorDetails = toolErrors.map(te => `Tool "${te.toolName}" failed with error: ${JSON.stringify(te.result)}`).join('\n');
                    throw new Error(`EXECUTION_FAILURE: ${errorDetails}`);
                }

                // Peer Review Consultation
                const critics = globalRegistry.findAgentsByRole('CRITIC');
                let critique: string;

                if (critics.length > 0) {
                    const critic = critics[0];
                    const critiqueTask = `CRITIC_REQUEST: Evaluate the target output against the initial task.
TASK: ${taskStr}
OUTPUT: ${finalAnswer}

Identify logic flaws, code errors, or hallucinated details. 
If perfect, reply exactly "PASS". 
Otherwise, provide a "ROOT_CAUSE_ANALYSIS" and a "RECOVERY_INSTRUCTION" for the next attempt.`;
                    critique = await critic.execute(critiqueTask, threadId);
                } else {
                    // Internal Reflection Fallback
                    const reflectionResponse = await this.generateResponse(
                        "You are an Auditor. Be critical of your own previous work. Analyze the task and your current answer for discrepancies.",
                        [
                            ...messages,
                            { role: 'assistant', content: finalAnswer },
                            { role: 'user', content: "CRITICAL_REVIEW: If your response is 100% correct and complete, reply 'PASS'. Otherwise, define exactly what went wrong and how to fix it." }
                        ],
                        threadId
                    );
                    critique = reflectionResponse.text;
                }

                if (critique.trim().toUpperCase().includes('PASS')) {
                    break; // Success
                } else {
                    // STRATEGIC RE-PLANNING: Before retrying, generate/validate a plan
                    TelemetrySystem.emit(this.card.id, threadId, {
                        action: 'REASONING_LOOP_RETRY',
                        category: 'AGENT_LOGIC',
                        metadata: { reason: 'STRATEGY_REFRAME', feedback: critique }
                    });

                    let feedbackInstruction = `CRITIQUE_RECEIVED: Your previous attempt was rejected.
FEEDBACK: ${critique}

Refined Strategy: Before giving the final answer, internalize the feedback. Ensure this next attempt is your definitive best work.`;

                    if (attempts === maxHealingLoops - 1) {
                        feedbackInstruction += `\n\n[DANGER]: This is your FINAL attempt. If you are still unsure how to resolve the issues described in the feedback, you MUST use the 'requestHumanAssistance' tool instead of guessing.`;
                    }

                    messages.push({ role: 'user', content: feedbackInstruction });
                    attempts++;
                }
            } catch (err: any) {
                attempts++;
                const errorMsg = err.message || String(err);
                
                TelemetrySystem.emit(this.card.id, threadId, {
                    action: 'REASONING_LOOP_RETRY',
                    category: 'AGENT_LOGIC',
                    metadata: { reason: 'EXCEPTION_THROWN', error: errorMsg }
                });

                if (attempts >= maxHealingLoops) throw err;

                // Explicit Recovery Planning Step
                const recoveryPlanningResponse = await this.generateResponse(
                    "You are a Strategic Planner tasked with recovering from a technical failure.",
                    [
                        ...messages,
                        { role: 'user', content: `SYSTEM_FAILURE: ${errorMsg}\n\nTask: ${taskStr}\n\nGenerate a robust RECOVERY_PLAN. Identify why it failed and describe the alternative approach you will take now. Be concise.` }
                    ],
                    threadId
                );

                messages.push({ role: 'user', content: `EXECUTING_RECOVERY_PLAN: ${recoveryPlanningResponse.text}. Please proceed with this new approach.` });
            }
        }

        // Record genealogical lineage
        globalGenealogy.recordLineage(this.card.id, taskStr, finalAnswer, []);

        return finalAnswer;
    }
}
