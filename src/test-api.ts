import { createServer } from 'http';
import fetch from 'node-fetch';

async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
           prompt: "Write a python script to show a countdown from 1 to 100",
           agentDefinitions: [
             {
                name: "Planner",
                role: "PLANNER",
                systemInstruction: "You are a planner."
             },
             {
                name: "Coder",
                role: "WORKER",
                systemInstruction: "You write python code."
             }
           ]
        })
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
}

test();
