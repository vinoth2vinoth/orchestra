# Orchestra Governance & Compliance

Orchestra ensures that agents operate within safe, ethical, and financial boundaries.

## 1. Policy Engine (Dimension 05)
Before any task is sent to an LLM, the `PolicyEngine` evaluates the request against a set of rules.
- **BLOCKING**: The task is immediately terminated.
- **MANDATORY**: The task proceeds but is flagged (YELLOW status).
- **ADVISORY**: Logged for audit review.

**Common Policies**:
- Recursive Loop Prevention.
- PII/Secret Leakage Detection.
- Forbidden Topic Blocking.

## 2. Immutable Audit Log
All framework decisions are recorded in a cryptographically linked JSONL log. Each entry contains a hash of the previous entry, ensuring tamper-evidence.
- **Location**: `.orchestra/audit/log_YYYY-MM-DD.jsonl`
- **Integrity**: SHA-256 Chained Hashing.

## 3. Escalation Tiers
When agents fail or policies are flagged, the `EscalationManager` determines the response:
- **TIER 1 (RETRY)**: Automatic retry with jitter.
- **TIER 2 (ADJUDICATION)**: A Critic or Manager reviews the failure.
- **TIER 3 (HUMAN)**: Execution suspends for human approval.
- **TIER 4 (EMERGENCY STOP)**: The entire thread is killed to prevent data damage or cost spikes.

## 4. Execution Guardrails
Standardizing instruction wrapping and sterile containers at the framework level to prevent prompt injection and unauthorized directive shifts.
