# Orchestra Multi-Paradigm Architecture

Orchestra supports multiple coordination paradigms to solve different types of problems efficiently. Each paradigm is implemented as a `ParadigmStrategy`.

## Available Paradigms

### 1. HIERARCHICAL
- **Role Requirement**: Exactly one `MANAGER` agent.
- **Behavior**: The Manager receives the task and is responsible for all sub-delegation. It acts as the "CEO" of the swarm.
- **Best for**: Tasks that require a top-down strategy and clear accountability.

### 2. CONSENSUS
- **Role Requirement**: `WORKER` or `CRITIC` agents.
- **Behavior**: Agents use the **Weighted Byzantine Fault Tolerance (WBFT)** protocol to reach agreement. If consensus fails, a `JUDGE` or `MANAGER` adjudicates.
- **Best for**: High-stakes decisions, fact-checking, or avoiding LLM hallucinations.

### 3. SWARM
- **Role Requirement**: Multiple `WORKER` agents.
- **Behavior**: Parallel execution. All workers tackle the problem simultaneously. A `MANAGER` synthesizes the fan-out results at the end.
- **Best for**: Creative brainstorming, wide data gathering, or redundant validation.

### 4. MAP_REDUCE
- **Role Requirement**: `PLANNER`, `WORKER`s, and `MANAGER`.
- **Behavior**: 
  1. **Plan**: Planner splits the task into a Directed Acyclic Graph (DAG) of subtasks.
  2. **Map**: Workers execute subtasks in parallel, respecting dependencies.
  3. **Reduce**: Manager synthesizes the final result from the task outputs.
- **Best for**: Complex engineering tasks, long-form content generation, or data processing pipelines.

### 5. MOA (Mixture of Agents)
- **Role Requirement**: Multiple specialized experts and one `MANAGER`.
- **Behavior**: Experts generate initial responses in parallel. The Manager then synthesizes these high-quality outputs into a single optimal response.
- **Best for**: Complex reasoning where multiple "expert opinions" improve the final quality.

### 6. GRAPH
- **Role Requirement**: Agents defined in `edges`.
- **Behavior**: Strictly follows a defined state machine/graph. Execution flows from one agent to the next based on pre-defined edges.
- **Best for**: Fixed workflows, legal compliance processes, or rigid pipelines.

### 7. EVENT_DRIVEN
- **Role Requirement**: Agents assigned to event listeners.
- **Behavior**: Agents react to events emitted during execution. Supports asynchronous-like coordination pattern.
- **Best for**: Real-time monitoring, reactive systems, or unpredictable workflows.

### 8. DECENTRALIZED_SWARM
- **Behavior**: Agents autonomously collaborate via the global blackboard. They evaluate the collective state and contribute until "SIGNAL_STABILIZATION" is reached.
- **Best for**: Emergent problem solving, research, or multi-faceted optimization.

### 9. DEBATE
- **Behavior**: Agents present arguments and critique each other's points over multiple rounds. A `JUDGE` provides the final verdict.
- **Best for**: Ethics analysis, strategic planning, or adversarial testing.

## Observability & Tracing

Orchestra uses OpenTelemetry (OTel) to provide hierarchical traces of every workflow. Spans are automatically nested:
- `workflow_execution`
  - `paradigm_execution` (e.g. `map_reduce`)
    - `agent_execution` (Agent ID)
      - `llm_call`

View traces in any OTel-compatible backend or via the `TelemetryStudio` in the app.
