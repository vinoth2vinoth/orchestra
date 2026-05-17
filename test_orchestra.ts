
async function runTest() {
    const requirement = `Design a simple task queue architecture. Just output the core components and their responsibilities.`;
    
    const agents = [
        {
            id: '1',
            name: 'Architect',
            role: 'System Designer (Planner)',
            systemInstruction: 'You are an expert software architect. Provide high-level technical designs, structure, and choose the right patterns.',
            llmProvider: 'deepseek',
            apiKeyValue: process.env.DEEPSEEK_API_KEY
        },
        {
            id: '4',
            name: 'Planner',
            role: 'Planner',
            systemInstruction: 'You are an execution planner. You break complex user tasks down into independent parallelizable subtasks. Write clear instructions for each subtask.',
            llmProvider: 'deepseek',
            apiKeyValue: process.env.DEEPSEEK_API_KEY
        },
        {
            id: '2',
            name: 'Developer',
            role: 'Code Implementer',
            systemInstruction: 'You are a senior full-stack developer. You write clean, performant, and robust code based on the technical design. Provide actual code blocks.',
            llmProvider: 'deepseek',
            apiKeyValue: process.env.DEEPSEEK_API_KEY
        },
        {
            id: '3',
            name: 'Reviewer',
            role: 'Code Reviewer',
            systemInstruction: 'You are a strict code reviewer. Review the code provided by the Developer. Point out edge cases, security issues, and suggest improvements.',
            llmProvider: 'deepseek',
            apiKeyValue: process.env.DEEPSEEK_API_KEY
        }
    ];

    console.log("Submitting project requirement to Orchestra...");

    try {
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: requirement,
                agentDefinitions: agents,
                paradigm: 'MAP_REDUCE' // Use MAP_REDUCE for complex breakdown
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("Error response:", err);
            return;
        }

        const result = await response.json();
        console.log("\n--- ORCHESTRA EXECUTION RESULT ---\n");
        console.log(result.text);
        console.log("\n--- END OF RESULT ---");

    } catch (err) {
        console.error("Fetch failed:", err);
    }
}

runTest();
