import { BaseAgent } from './BaseAgent.ts';

export class CriticAgent extends BaseAgent {
    public async execute(task: any, threadId: string): Promise<any> {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);

        const messages: any[] = [
            { role: 'user', content: `Please review the following output for logic flaws and potential runtime errors. 
If the output contains executable code (e.g., Javascript), you MUST use the executeCodeSandbox tool to run it and verify it works without throwing errors. 
If the code fails the sandbox runtime check, or there are other logic flaws, describe the errors explicitly (including exact runtime errors) so the writer can fix them. 
If everything is logically sound and the code passes runtime check, respond with exactly "PASS".

Output to review:
${taskStr}` }
        ];

        const response = await this.generateResponse(
            this.card.description,
            messages,
            threadId
        );

        return response.text;
    }
}
