import { BaseAgent } from './BaseAgent.ts';
import { AgentSpawner } from '../orchestration/AgentSpawner.ts';
import { globalEscalationManager } from '../governance/EscalationManager.ts';

export class ManagerAgent extends BaseAgent {
    public subordinates: BaseAgent[] = [];
    private resourcePolicies: Map<string, string[]> = new Map([
        ['WORKER', ['web_search', 'knowledge_base', 'discovery']],
        ['CRITIC', ['knowledge_base', 'validation']],
        ['PLANNER', ['knowledge_base', 'strategic']]
    ]);

    public setSubordinates(agents: BaseAgent[]) {
        this.subordinates = agents;
    }

    public async reviewResourceRequest(subordinateId: string, resourceName: string, justification: string, threadId: string): Promise<{ authorized: boolean; feedback?: string }> {
        const subordinate = this.subordinates.find(s => s.card.id === subordinateId);
        const subName = subordinate ? subordinate.card.name : 'Unknown Subordinate';
        const subRole = subordinate ? subordinate.card.role : 'WORKER';

        // OPTIMIZATION: Instant Auto-Grant based on Policy (Zero Latency)
        const allowedResources = this.resourcePolicies.get(subRole) || [];
        if (allowedResources.includes(resourceName) || resourceName.startsWith('discovery')) {
            const { globalRegistry } = await import('./AgentRegistry.ts');
            globalRegistry.grantTool(subordinateId, resourceName);
            return { authorized: true, feedback: "Resource access AUTO-GRANTED based on standard operational policy." };
        }

        const reviewPrompt = `A subordinate agent (${subName}) is requesting access to a privileged resource.
RESOURCE: ${resourceName}
JUSTIFICATION: ${justification}

Analyze if this resource is truly necessary and safe for this agent to use for the current objective.
Respond with 'GRANT' if approved, or 'DENY' with reasons.`;

        const review = await this.generateResponse(
            "You are a Resource Security Administrator.",
            [{ role: 'user', content: reviewPrompt }],
            threadId
        );

        if (review.text.toUpperCase().includes('GRANT')) {
            // Grant the tool via the registry
            const { globalRegistry } = await import('./AgentRegistry.ts');
            globalRegistry.grantTool(subordinateId, resourceName);
            
            return { authorized: true, feedback: "Resource access granted by Manager." };
        } else {
            return { authorized: false, feedback: review.text };
        }
    }

    public async execute(task: any, threadId: string): Promise<any> {
        // Human-in-the-loop: ask orchestrator/system if this task is sensitive and needs approval
        // For demonstration, let's say tasks containing "delete" or "production" require checking.
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);
        if (taskStr.toLowerCase().includes('delete') || taskStr.toLowerCase().includes('production')) {
            const approval = await globalEscalationManager.requestApproval(
                threadId,
                this.card.id,
                'Manager is about to execute a potentially sensitive task.',
                task
            );
            if (approval.resolution === 'REJECTED') {
                return 'Task execution rejected by human supervisor.';
            } else if (approval.resolution === 'MODIFIED' && approval.feedback) {
                task = task + '\n(Human Feedback: ' + approval.feedback + ')';
            }
        }

        // Dynamic Topology Phase
        const evalMessages: any[] = [
            { role: 'user', content: `Task: ${taskStr}\nCurrent subordinates: ${this.subordinates.map(s => s.card.name).join(', ')}\nDo you need to spawn a new temporary specialist to handle this? Reply strictly with JSON: { "needsSpecialist": boolean, "expertise": "..." }` }
        ];

        try {
            const evalResponse = await this.generateResponse(
                `You are a dynamic topology orchestrator. Respond ONLY in valid JSON.`,
                evalMessages,
                threadId
            );
            
            // Extract JSON from response robustly
            const text = evalResponse.text;
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                const decision = JSON.parse(match[0]);
                if (decision.needsSpecialist && decision.expertise) {
                    const tempAgent = AgentSpawner.spawnSpecialist(
                        'Temp' + decision.expertise.replace(/\s/g, '').substring(0,8) + 'Specialist',
                        decision.expertise,
                        this.memory,
                        this.llmConfig,
                        this.card.id
                    );
                    this.subordinates.push(tempAgent);
                }
            }
        } catch (e) {
            console.warn('Dynamic topology parsing failed, proceeding with existing subordinates.', e);
        }

        // Check if this is a synthesis/summary task that doesn't need further decomposition
        const lowTask = taskStr.toLowerCase();
        const isSynthesis = lowTask.includes('synthesize') || lowTask.includes('summary results') || lowTask.includes('swarm agents produced');

        if (isSynthesis || this.subordinates.length === 0) {
            const directMessages: any[] = [
                ...evalMessages,
                { role: 'user', content: `Task: ${taskStr}\nPlease provide a direct response or synthesis.` }
            ];
            const directRes = await this.generateResponse("You are a Manager performing direct synthesis.", directMessages, threadId);
            return directRes.text;
        }

        // Simple hierarchical decomposition
        const messages: any[] = [
            { role: 'user', content: `Analyze this task and break it down into steps: ${JSON.stringify(task)}` }
        ];

        const planResponse = await this.generateResponse(
            `You are a Manager. Current subordinates: ${this.subordinates.map(a => a.card.name + '(' + a.card.role + ')').join(', ')}.\nPlan the breakdown without executing yet.`,
            messages,
            threadId
        );

        this.memory.addWorkingMemory(threadId, this.card.id, planResponse.text);

        let context = '';
        const maxSubordinateRetries = 1;

        for (const sub of this.subordinates) {
            let subAttempt = 0;
            let subResult = '';
            let subTask = taskStr + '\nContext: ' + context;

            while (subAttempt <= maxSubordinateRetries) {
                try {
                    subResult = await sub.execute(subTask, threadId);
                    
                    // MANAGER QUALITY CONTROL: Evaluate if sub-result is sufficient
                    const qcPrompt = `Identify if the following subordinate response is professionally complete and accurate for the given task.
TASK: ${subTask}
RESPONSE: ${subResult}

Reply with 'OK' if sufficient. Otherwise, describe specifically what is missing or wrong.`;
                    const qcCheck = await this.generateResponse("You are a Quality Controller.", [{ role: 'user', content: qcPrompt }], threadId);
                    
                    if (qcCheck.text.toUpperCase().includes('OK')) {
                        break; // Success
                    } else {
                        if (subAttempt === maxSubordinateRetries) {
                            // Last ditch effort: ask for human intervention
                            const humanHelp = await this.generateResponse(
                                "You are a Manager faced with a failing subordinate.",
                                [{ role: 'user', content: `Subordinate ${sub.card.name} failed Quality Control twice for task: ${subTask}.\nCritique: ${qcCheck.text}\n\nShould you continue with best-effort, or do you need to ask a HUMAN for help? If you need help, use the 'requestHumanAssistance' tool.` }],
                                threadId
                            );
                            // If the manager decides to use the tool, it will throw WorkflowSuspendedError
                            // If it doesn't, we just fall through to the break
                            if (humanHelp.text.toLowerCase().includes('requesthumanassistance')) {
                                // Explicitly call it if for some reason tool use wasn't automatic
                                await globalEscalationManager.requestApproval(threadId, this.card.id, `Subordinate failure on ${sub.card.name}`, { subTask, critique: qcCheck.text });
                            }
                        }
                        throw new Error(`QC_FAILED: ${qcCheck.text}`);
                    }
                } catch (e: any) {
                    subAttempt++;
                    if (subAttempt > maxSubordinateRetries) {
                        console.warn(`Subordinate ${sub.card.name} failed final attempt. Proceeding with best-effort context.`);
                        break;
                    }
                    // RE-ORIENTATION: Inject management guidance for the retry
                    subTask = `${subTask}\n\n[MANAGEMENT_REDIRECTION]: Your previous response was rejected for the following reasons: ${e.message}. Please adjust your strategy and provide a definitive fix.`;
                }
            }

            context += `\nResult from ${sub.card.name}: ${subResult}`;
            
            // Terminate temporary agents to free resources
            if (sub.card.name.startsWith('Temp')) {
                AgentSpawner.terminate(sub.card.id);
            }
        }

        // Clean up subordinates list
        this.subordinates = this.subordinates.filter(s => !s.card.name.startsWith('Temp'));

        const synthesisMessages: any[] = [
            { role: 'user', content: `Task: ${JSON.stringify(task)}\nSubordinate Results:\n${context}` }
        ];

        const synthesis = await this.generateResponse(`You are a Manager. Synthesize the subordinate results into a final answer.`, synthesisMessages, threadId);
        
        return synthesis.text;
    }
}
