import fetch from 'node-fetch';

async function test() {
    try {
        console.log("Fetching API...");
        const res = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: "Hello", agentDefinitions: [], paradigm: "GRAPH", edges: [] })
        });
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Response:", text);
    } catch(e) {
        console.error(e);
    }
}
test();
