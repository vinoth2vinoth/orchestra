import math
import logging
from typing import Dict, Any, Tuple

class DeescalationLogger:
    """Logs downgrades when tasks complete in first loop with zero flags."""
    def __init__(self):
        self.logger = logging.getLogger("DeescalationLogger")

    def log_downgrade(self, task_id: str, assigned_level: int, actual_level: int) -> None:
        if actual_level < assigned_level:
            self.logger.info(f"Task {task_id} de-escalated from Level {assigned_level} to Level {actual_level}.")

class EscalationEngine:
    """Calculates escalation level based on metrics vector."""
    
    def __init__(self):
        pass

    def _score_output_volume(self, expected_tokens: int) -> int:
        if expected_tokens < 500: return 1
        if expected_tokens <= 1000: return 2
        if expected_tokens <= 2500: return 3
        if expected_tokens <= 5000: return 4
        return 5

    def _score_determinism(self, determinism_level: str) -> int:
        levels = {
            "very_high": 1,
            "high": 2,
            "moderate": 3,
            "low": 4,
            "very_low": 5,
        }
        return levels.get(determinism_level.lower(), 3)

    def _score_tool_chain_depth(self, depth: int) -> int:
        if depth <= 1: return 1
        if depth == 2: return 2
        if depth == 3: return 3
        if depth <= 5: return 4
        return 5

    def compute_level(self, task_metrics: Dict[str, Any]) -> int:
        """
        Calculate overall escalation level based on:
        (volume_score + determinism_score + tool_depth_score) / 3 
        Then apply ceiling.
        """
        expected_tokens = task_metrics.get("expected_tokens", 0)
        determinism = task_metrics.get("determinism", "moderate")
        tool_depth = task_metrics.get("tool_chain_depth", 0)

        vol_score = self._score_output_volume(expected_tokens)
        det_score = self._score_determinism(determinism)
        tool_score = self._score_tool_chain_depth(tool_depth)

        avg = (vol_score + det_score + tool_score) / 3.0
        return math.ceil(avg)

class ReclassificationGate:
    """Validates escalation beyond Level 1."""
    
    def __init__(self):
        self.logger = logging.getLogger("ReclassificationGate")

    def should_escalate(self, current_level: int, task_metrics: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Before escalating Level 1 to Level 2+, verify output volume and determinism genuinely require it.
        """
        if current_level > 1:
            return True, "Already > Level 1"
        
        expected_tokens = task_metrics.get("expected_tokens", 0)
        determinism = task_metrics.get("determinism", "very_high")
        
        should_actually_escalate = False
        reasons = []

        if expected_tokens >= 500:
            should_actually_escalate = True
            reasons.append(f"Volume check failed (expected {expected_tokens} >= 500)")
        
        if determinism not in ("very_high", "high"):
            should_actually_escalate = True
            reasons.append(f"Determinism check failed (is {determinism})")

        if should_actually_escalate:
            reason_str = ", ".join(reasons)
            self.logger.warning(f"Reclassification forced escalation: {reason_str}")
            return True, reason_str
        
        return False, "Task remains Level 1. Reclassification denied escalation as vector scores were lacking."
