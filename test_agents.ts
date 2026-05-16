import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        console.log("Fetching API with agents...");
        const res = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: "Design a system",
                paradigm: "HIERARCHICAL",
                agentDefinitions: [{
                    id: "manager1", 
                    name: "Manager",
                    role: "MANAGER",
                    systemInstruction: "You are the manager.",
                    modelName: "deepseek-chat",
                }, {
                    id: "worker1",
                    name: "Worker",
                    role: "WORKER",
                    systemInstruction: "You are a worker.",
                    modelName: "deepseek-chat",
                }],
                edges: [{ from: "manager1", to: "worker1" }]
            })
        });
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Response:", text);
    } catch(e) {
        console.error(e);
    }
}
test();
