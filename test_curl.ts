import fetch from 'node-fetch';

async function run() {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{
        type: "function",
        function: {
          name: "write_to_local_blackboard",
          description: "Write temporary state",
          parameters: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: "string" }
            },
            required: ["key", "value"],
            additionalProperties: false
          }
        }
      }]
    })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
