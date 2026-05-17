# Orchestra Human-in-the-Loop (HITL)

Orchestra provides deep integration for human oversight, allowing agents to pause execution and wait for user guidance.

## 1. `request_human_help` Tool
Agents can explicitly call this tool if they encounter ambiguity or need high-stakes authorization.

**Usage (Agent Prompt)**:
"If you are unsure about the user's preferred cloud provider, call `request_human_help` with a justification."

**Schema**:
```json
{
  "name": "request_human_help",
  "arguments": {
    "justification": "Why do you need help?",
    "description": "Short summary of what you are waiting for."
  }
}
```

## 2. Global Guardrails
The `EscalationManager` can automatically trigger HITL if:
- An agent fails more than 3 times consecutively.
- A `MANDATORY` policy is flagged by the `PolicyEngine`.
- A high-cost operation is about to be performed.

## 3. The Rehydration Loop
When a workflow is suspended:
1. The `Orchestrator` captures a state snapshot (blackboard, task, thread metadata).
2. The state is serialized to `StateStore`.
3. The UI receives a `HUMAN_INTERVENTION_REQUIRED` event via SSE.
4. The user provides a resolution (Approve/Reject/Modify) and optional feedback.
5. The UI calls `/api/approval/:id`, which rehydrates the agents and resumes the `Orchestrator` with the injected feedback.

## 4. Feedback Injection
Feedback is injected as a special "System Message" at the start of the resumed task, ensuring the agent prioritizes the new human instructions over its previous plan.
