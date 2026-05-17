import { BaseAgent } from './BaseAgent.ts';

export class CriticAgent extends BaseAgent {
    public async execute(task: any, threadId: string): Promise<any> {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);

        const messages: any[] = [
            { role: 'user', content: `Please review the following output for logic flaws and potential runtime errors. 
If the output contains executable code, you SHOULD use any available sandbox or verification tools to confirm it works.
If there are logic flaws, security vulnerabilities, or performance bottlenecks, describe them explicitly.
If everything is logically sound, respond with exactly "PASS".

Output to review:
<UNTRUSTED_CONTENT>
${taskStr}
</UNTRUSTED_CONTENT>` }
        ];

        // Use the internal reasoning loop for more robust critique
        const response = await this.executeWithReasoning(
            this.card.description + "\nYour primary role is to find faults that others missed. Be adversarial but constructive.",
            messages,
            threadId
        );

        return response.text;
    }
}
