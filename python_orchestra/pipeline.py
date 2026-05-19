import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any
from escalation import ReclassificationGate

logger = logging.getLogger("Pipeline")

class Level1Pipeline:
    """
    Enforces 500 token hard cap, zero loops, direct output.
    Calls ReclassificationGate before any escalation.
    """
    def __init__(self, agent, tools, reclassification_gate: ReclassificationGate):
        self.agent = agent
        self.tools = tools
        self.gate = reclassification_gate

    def run(self, task: str, task_metrics: Dict[str, Any]) -> str:
        logger.info("Executing Level 1 Pipeline.")
        
        # Guard escalation Check
        escalates, reason = self.gate.should_escalate(1, task_metrics)
        if escalates:
            logger.info(f"Task reclassified dynamically: {reason}.")
            raise Exception("RECLASSIFIED") # Caught by orchestrator to re-route
            
        result = self.agent.execute(task, max_tokens=500, tools=self.tools)
        return result

class Level3Pipeline:
    """
    Worker -> Reviewer -> Return flow, single loop
    """
    def __init__(self, worker_agent, reviewer_agent):
        self.worker = worker_agent
        self.reviewer = reviewer_agent

    def run(self, task: str) -> str:
        logger.info("Executing Level 3 Pipeline.")
        
        output = self.worker.execute(task, max_tokens=2500)
        passed, issues = self.reviewer.validate_output(task, output)
        if not passed:
            logger.warning(f"Level 3 Review flagged issues: {issues}. Attempting one rework loop.")
            output = self.worker.execute(f"Fix these issues: {issues}. Original Task: {task}. Previous output: {output}")
        
        return output

class Level45Pipeline:
    """
    Decomposes task into atomic_units.
    Uses ThreadPoolExecutor to run worker threads in parallel.
    """
    def __init__(self, worker_agent, critic_agent):
        self.worker = worker_agent
        self.critic = critic_agent

    def _decompose(self, task: str) -> List[str]:
        # Pseudo-decomposition logic (in real-world, an agent might do this)
        logger.info("Decomposing bulk task into atomic units.")
        return [f"{task} - Unit {i}" for i in range(3)] 

    def run(self, task: str) -> str:
        logger.info("Executing Level 4/5 Pipeline.")
        atomic_units = self._decompose(task)
        
        results = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_unit = {executor.submit(self.worker.execute, unit, max_tokens=2000): unit for unit in atomic_units}
            for future in as_completed(future_to_unit):
                try:
                    res = future.result()
                    results.append(res)
                except Exception as e:
                    logger.error(f"Atomic unit failed: {e}")
                    results.append(f"Error: {e}")

        combined_output = "\n\n".join(results)
        
        passed, issues = self.critic.validate_output(task, combined_output)
        if not passed:
            logger.warning(f"Critic Agent triggered rework flags: {issues}")
            rework_prompt = f"Fix issues in combined output: {issues}.\n{combined_output}"
            combined_output = self.worker.execute(rework_prompt)

        return combined_output

class PipelineRouter:
    """Selects correct pipeline based on escalation level"""
    def __init__(self, worker, reviewer, critic, tools, reclassification_gate):
        self.pipelines = {
            1: Level1Pipeline(worker, tools, reclassification_gate),
            2: Level3Pipeline(worker, reviewer), # L2 uses single pass without heavy review ideally, but we map to similar structure
            3: Level3Pipeline(worker, reviewer),
            4: Level45Pipeline(worker, critic),
            5: Level45Pipeline(worker, critic)
        }

    def route(self, level: int):
        return self.pipelines.get(level, self.pipelines[5])
