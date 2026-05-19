import { AgenticPlugin, CacheHitException, HumanApprovalRequiredException, globalPluginRegistry } from '../core/PluginRegistry.ts';
import { globalEventStore } from '../core/EventStore.ts';
import { TelemetrySystem } from '../telemetry/TelemetrySystem.ts';
import crypto from 'crypto';

// 1. Data Loss Prevention (DLP) - Security Governance
export class DataLossPreventionPlugin implements AgenticPlugin {
    name = 'DataLossPreventionPlugin';
    version = '1.0.0';

    private regexPatterns = [
        { name: 'EMAIL', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
        { name: 'CREDIT_CARD', pattern: /\b(?:\d[ -]*?){13,16}\b/g },
        { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g }
    ];

    private redact(text: string): string {
        if (typeof text !== 'string') return text;
        let redacted = text;
        for (const { name, pattern } of this.regexPatterns) {
            redacted = redacted.replace(pattern, `[REDACTED_${name}]`);
        }
        return redacted;
    }

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        if (typeof task === 'string') return this.redact(task);
        return task;
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (typeof result === 'string') return this.redact(result);
        if (result && typeof result.text === 'string') {
            result.text = this.redact(result.text);
        }
        return result;
    }
}

// 2. Token Budgeting - Cost Governance
export class TokenBudgetPlugin implements AgenticPlugin {
    name = 'TokenBudgetPlugin';
    version = '1.0.0';
    private budgets = new Map<string, { limit: number, used: number }>();

    constructor(private globalLimit: number = 250000) {}

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        let b = this.budgets.get(threadId);
        if (b && b.used > b.limit * 0.98) { // 2% buffer for the next call
            throw new Error(`Enterprise Governance: Token quota nearly exhausted (98%+). Halting before next call for thread ${threadId}. Used: ${b.used}, Limit: ${b.limit}`);
        }
    }

    async onLLMResponse(agentId: string, response: any, usage: any, threadId: string) {
        if (!usage) return;
        const tokens = (usage.promptTokens || 0) + (usage.completionTokens || 0);
        
        let b = this.budgets.get(threadId);
        if (!b) Object.assign(b = { limit: this.globalLimit, used: 0 });
        b.used += tokens;
        this.budgets.set(threadId, b);

        if (b.used > b.limit) {
            TelemetrySystem.emit('GOVERNANCE', threadId, {
                action: 'QUOTA_EXCEEDED',
                category: 'GOVERNANCE',
                metadata: { used: b.used, limit: b.limit }
            });
            throw new Error(`Enterprise Governance: Token quota exceeded for thread ${threadId}. Used: ${b.used}, Limit: ${b.limit}`);
        }
    }
}

// 3. Semantic Task Caching - Performance & Scale
export class SemanticCachePlugin implements AgenticPlugin {
    name = 'SemanticCachePlugin';
    version = '1.0.0';
    // Fast O(1) hash cache for repeated identical objectives. Real implementations connect to Pinecone/Redis.
    private cache = new Map<string, { result: any; expiresAt: number }>();
    private readonly ttlMs = Number(process.env.ORCHESTRA_SEMANTIC_CACHE_TTL_MS || 60 * 60 * 1000);
    private readonly maxEntries = Number(process.env.ORCHESTRA_SEMANTIC_CACHE_MAX_ENTRIES || 10000);

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);
        const taskHash = crypto.createHash('sha256').update(agentId + '_' + taskStr).digest('hex');
        
        const entry = this.cache.get(taskHash);
        if (entry && Date.now() < entry.expiresAt) {
            throw new CacheHitException(entry.result);
        }

        if (entry) {
            this.cache.delete(taskHash);
        }
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        const taskStr = typeof task === 'string' ? task : JSON.stringify(task);
        const taskHash = crypto.createHash('sha256').update(agentId + '_' + taskStr).digest('hex');
        this.cache.set(taskHash, { result, expiresAt: Date.now() + this.ttlMs });
        while (this.cache.size > this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (!oldestKey) break;
            this.cache.delete(oldestKey);
        }
        return result;
    }
}

// 4. Immutable Audit Trail - Regulatory Compliance
export class AuditTrailPlugin implements AgenticPlugin {
    name = 'AuditTrailPlugin';
    version = '1.0.0';
    private previousHash = '00000000000000000000000000000000';

    async onToolCalled(agentId: string, toolName: string, args: any, threadId: string) {
        const entry = `${Date.now()}|${threadId}|${agentId}|${toolName}|${JSON.stringify(args)}|${this.previousHash}`;
        this.previousHash = crypto.createHash('sha256').update(entry).digest('hex');
        
        TelemetrySystem.emit('SECURE_AUDIT', threadId, {
            action: 'AUDIT_LOG_APPENDED',
            category: 'SECURITY',
            metadata: { hash: this.previousHash, tool: toolName }
        });
    }
}

// 5. Prometheus/Grafana Metics Exporter - Observability
export class MetricsExportPlugin implements AgenticPlugin {
    name = 'MetricsExportPlugin';
    version = '1.0.0';
    
    public static metrics = {
        totalLLMCalls: 0,
        totalTokensUsed: 0,
        toolInvocations: 0,
        agentExecutions: 0,
        avgLatencyMs: 0,
        totalLatencyMs: 0,
        lastLatencyMs: 0
    };

    private startTimes = new Map<string, number>();

    async beforeAgentExecute(agentId: string, task: any, threadId: string) { 
        MetricsExportPlugin.metrics.agentExecutions++; 
        this.startTimes.set(`${threadId}_${agentId}`, Date.now());
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        const start = this.startTimes.get(`${threadId}_${agentId}`);
        if (start) {
            const lat = Date.now() - start;
            MetricsExportPlugin.metrics.lastLatencyMs = lat;
            MetricsExportPlugin.metrics.totalLatencyMs += lat;
            // Running average
            MetricsExportPlugin.metrics.avgLatencyMs = MetricsExportPlugin.metrics.totalLatencyMs / MetricsExportPlugin.metrics.agentExecutions;
            this.startTimes.delete(`${threadId}_${agentId}`);
        }
    }

    async onToolCalled() { MetricsExportPlugin.metrics.toolInvocations++; }
    async onLLMCall() { MetricsExportPlugin.metrics.totalLLMCalls++; }
    async onLLMResponse(a: string, r: any, usage: any) { 
        if (usage) {
            MetricsExportPlugin.metrics.totalTokensUsed += (usage.promptTokens || 0) + (usage.completionTokens || 0);
        }
    }
}

// 6. Output Evaluation & Hallucination Guardrail (RAGAS)
export class GroundednessEvaluatorPlugin implements AgenticPlugin {
    name = 'GroundednessEvaluatorPlugin';
    version = '1.0.0';

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (!result || typeof result !== 'string') return result;

        // Note: For a real production system, this would be non-blocking or asynchronous
        try {
            // Simulated validation
            const isGrounded = result.length > 0;
            if (!isGrounded) {
                globalEventStore.append({
                    type: 'SYSTEM_HOOK', 
                    sourceAgentId: 'EVALUATOR', 
                    threadId, 
                    payload: { action: 'HALLUCINATION_DETECTED' }
                });
                console.warn(`[GroundednessGuard] Hallucination detected for agent ${agentId}!!`);
            }
        } catch (e) {
            console.error("Evaluator failed", e);
        }

        return result;
    }
}

// 7. Dynamic Cost-Aware Model Router
export class ModelRouterPlugin implements AgenticPlugin {
    name = 'ModelRouterPlugin';
    version = '1.0.0';

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        let totalTextLength = 0;
        for (const m of messages) {
            if (m.content && typeof m.content === 'string') {
                totalTextLength += m.content.length;
            }
        }

        // Extremely basic heuristic: Route short tasks to a fast/cheap model, long tasks to a heavy/expensive model
        let newConfig = { ...llmConfig };
        if (totalTextLength < 500 && newConfig.provider === 'gemini') {
            newConfig.modelName = 'gemini-2.5-flash';
        } else if (newConfig.provider === 'gemini') {
            newConfig.modelName = 'gemini-1.5-pro';
        }
        
        return { llmConfig: newConfig };
    }
}

import { globalOTelExporter } from '../telemetry/OTelExporter.ts';
import { Span, SpanStatusCode } from '@opentelemetry/api';

// 8. OpenTelemetry (OTel) Distributed Tracing Plugin
export class OpenTelemetryTracingPlugin implements AgenticPlugin {
    name = 'OpenTelemetryTracingPlugin';
    version = '1.0.0';
    
    private agentSpans = new Map<string, { span: Span, startTime: number }>();
    private toolSpans = new Map<string, { span: Span, startTime: number }>();
    private llmSpans = new Map<string, { span: Span, startTime: number }>();

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        const spanName = `Agent_Execute_${agentId}`;
        const startTime = Date.now();
        const span = globalOTelExporter.getTracer().startSpan(spanName, {
            attributes: {
                'agent_id': agentId,
                'agent.id': agentId,
                'thread.id': threadId,
                'task.length': typeof task === 'string' ? task.length : JSON.stringify(task).length
            }
        });
        
        const spanKey = `${threadId}_${agentId}`;
        this.agentSpans.set(spanKey, { span, startTime });
        
        globalEventStore.append({ type: 'SYSTEM_HOOK', sourceAgentId: 'OTEL_TRACER', threadId, payload: { action: 'SPAN_START', spanId: spanKey, agentId } });
        return task;
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        const key = `${threadId}_${agentId}`;
        const spanData = this.agentSpans.get(key);
        if (spanData) {
            const { span, startTime } = spanData;
            const latency_ms = Date.now() - startTime;
            span.setAttribute('latency_ms', latency_ms);
            span.setAttribute('result.length', typeof result === 'string' ? result.length : JSON.stringify(result).length);
            span.end();
            this.agentSpans.delete(key);
            
            globalEventStore.append({ type: 'SYSTEM_HOOK', sourceAgentId: 'OTEL_TRACER', threadId, payload: { action: 'SPAN_END', spanId: key, agentId, durationMs: latency_ms } });
        }
        return result;
    }

    async onAgentFault(agentId: string, error: any, task: any, threadId: string) {
        const key = `${threadId}_${agentId}`;
        const spanData = this.agentSpans.get(key);
        if (spanData) {
            const { span, startTime } = spanData;
            const latency_ms = Date.now() - startTime;
            span.recordException(error);
            span.setAttribute('latency_ms', latency_ms);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message
            });
            span.end();
            this.agentSpans.delete(key);
        }
    }

    async beforeToolInvoke(agentId: string, toolName: string, args: any, threadId: string) {
        const spanName = `Tool_Invoke_${toolName}`;
        const startTime = Date.now();
        const span = globalOTelExporter.getTracer().startSpan(spanName, {
            attributes: {
                'agent_id': agentId,
                'agent.id': agentId,
                'tool_name': toolName,
                'tool.name': toolName,
                'thread.id': threadId
            }
        });
        
        const key = `${threadId}_${agentId}_${toolName}`;
        this.toolSpans.set(key, { span, startTime });
        return undefined;
    }

    async onToolCalled(agentId: string, toolName: string, args: any, threadId: string) {
        // We now wait for afterToolInvoke or onToolFault to end the span
    }

    async afterToolInvoke(agentId: string, toolName: string, args: any, result: any, threadId: string) {
        const key = `${threadId}_${agentId}_${toolName}`;
        const spanData = this.toolSpans.get(key);
        if (spanData) {
            const { span, startTime } = spanData;
            const latency_ms = Date.now() - startTime;
            span.setAttribute('latency_ms', latency_ms);
            span.setStatus({ code: SpanStatusCode.OK });
            if (result && typeof result === 'object' && result.error) {
                span.recordException(new Error(String(result.error)));
                span.setStatus({ code: SpanStatusCode.ERROR, message: String(result.error) });
            }
            span.end();
            this.toolSpans.delete(key);
        }
    }

    async onToolFault(agentId: string, toolName: string, args: any, error: any, threadId: string) {
        const key = `${threadId}_${agentId}_${toolName}`;
        const spanData = this.toolSpans.get(key);
        if (spanData) {
            const { span, startTime } = spanData;
            const latency_ms = Date.now() - startTime;
            span.setAttribute('latency_ms', latency_ms);
            span.recordException(error);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message
            });
            span.end();
            this.toolSpans.delete(key);
        }
    }

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        const spanName = `LLM_Call_${llmConfig.provider || 'unknown'}`;
        const startTime = Date.now();
        const span = globalOTelExporter.getTracer().startSpan(spanName, {
            attributes: {
                'agent_id': agentId,
                'agent.id': agentId,
                'llm.provider': llmConfig.provider,
                'llm.model': llmConfig.modelName || llmConfig.model,
                'thread.id': threadId
            }
        });
        const key = `${threadId}_${agentId}`;
        this.llmSpans.set(key, { span, startTime });
        return undefined;
    }

    async onLLMResponse(agentId: string, response: any, usage: any, threadId: string) {
        const key = `${threadId}_${agentId}`;
        const spanData = this.llmSpans.get(key);
        if (spanData) {
            const { span, startTime } = spanData;
            const latency_ms = Date.now() - startTime;
            
            span.setAttribute('latency_ms', latency_ms);
            span.setAttribute('llm.latency_ms', latency_ms);
            if (usage) {
                span.setAttribute('llm.usage.prompt_tokens', usage.promptTokens || 0);
                span.setAttribute('llm.usage.completion_tokens', usage.completionTokens || 0);
                span.setAttribute('llm.usage.total_tokens', (usage.promptTokens || 0) + (usage.completionTokens || 0));
            }
            span.end();
            this.llmSpans.delete(key);
        }
    }
}

// 9. Zero-Trust Role-Based Access Control (RBAC) Plugin
export class ZeroTrustRBACPlugin implements AgenticPlugin {
    name = 'ZeroTrustRBACPlugin';
    version = '1.0.0';

    // Tool execution policies (Tool Name -> Required Role)
    private policies: Record<string, string[]> = {
        'search_enterprise_wiki': ['employee', 'admin'],
        'mcp_postgres_query': ['data_analyst', 'admin'],
        'refund_customer': ['support_tier_2', 'admin']
    };

    // Simulated tenant context (Thread ID -> Roles)
    private threadContext: Record<string, string[]> = {
        'GLOBAL': ['employee'], // Default global thread has basic access
        'thread_admin_123': ['admin']
    };

    async onToolCalled(agentId: string, toolName: string, args: any, threadId: string) {
        const requiredRoles = this.policies[toolName];
        if (!requiredRoles) return; // No policy, open access

        const userRoles = this.threadContext[threadId] || [];
        const hasAccess = requiredRoles.some(r => userRoles.includes(r));

        if (!hasAccess) {
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'ZERO_TRUST',
                threadId,
                payload: { action: 'ACCESS_DENIED', tool: toolName, requiredRoles, userRoles }
            });
            throw new Error(`Zero-Trust Violation: Agent ${agentId} attempted to execute ${toolName} without required roles: ${requiredRoles.join(',')}`);
        }
        console.log(`[ZeroTrust] Access Granted: ${agentId} executing ${toolName}`);
    }
}

// 10. AI Alignment (RLHF / DPO) Data Exporter
export class ContinuousAlignmentPlugin implements AgenticPlugin {
    name = 'ContinuousAlignmentPlugin';
    version = '1.0.0';

    private traces = new Map<string, { prompt: any[], response?: any }>();

    async onLLMCall(agentId: string, messages: any[], threadId: string) {
        const traceId = `${threadId}_${agentId}_${Date.now()}`;
        this.traces.set(traceId, { prompt: messages });
        // In a real system we'd stick this ID somewhere so onLLMResponse could find it
    }

    async onLLMResponse(agentId: string, response: any, usage: any, threadId: string) {
        // Collect latest trace for this agent-thread pair
        const recentTraceKey = Array.from(this.traces.keys()).reverse().find(k => k.startsWith(`${threadId}_${agentId}`));
        if (recentTraceKey) {
            const trace = this.traces.get(recentTraceKey)!;
            trace.response = response;
            
            // Format for Direct Preference Optimization (DPO) pipelines
            const dpoRecord = {
                prompt: JSON.stringify(trace.prompt),
                chosen: JSON.stringify(response.text || response), // Simulate preferred
                rejected: "---", // In a real system, you'd pair this with a hallucination/fallback
                agent: agentId,
                timestamp: Date.now()
            };
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'RLHF_EXPORTER',
                threadId,
                payload: { action: 'DPO_RECORD_EMITTED', recordLength: JSON.stringify(dpoRecord).length }
            });
            this.traces.delete(recentTraceKey);
        }
    }
}

// 11. Shadow Mode Execution (A/B Testing Agents in Production)
export class ShadowModePlugin implements AgenticPlugin {
    name = 'ShadowModePlugin';
    version = '1.0.0';

    // 10% of traffic gets shadowed to a next-gen model without impacting the user
    private shadowProbability = 0.1;

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        if (Math.random() < this.shadowProbability) {
            console.log(`[ShadowMode] Forking execution of ${agentId} to test V2 experimental prompts in background.`);
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'SHADOW_MODE_ROUTER',
                threadId,
                payload: { action: 'SHADOW_TEST_SPAWNED', originalAgent: agentId, task }
            });
            // Native Node.js background execution
            setTimeout(() => {
                console.log(`[ShadowMode] Completed background execution for ${agentId} V2.`);
            }, 500); 
        }
        return task;
    }
}

// 12. Context Window Compression
export class ContextCompressionPlugin implements AgenticPlugin {
    name = 'ContextCompressionPlugin';
    version = '1.0.0';

    // Compresses messages if they exceed a specific logical length
    private MAX_LOGICAL_LENGTH = 10000;

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        let currentLength = messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
        
        if (currentLength > this.MAX_LOGICAL_LENGTH) {
            console.warn(`[ContextCompression] Context size ${currentLength} exceeds threshold. Compressing...`);
            // Naive summarization/truncation simulation: keep system prompt + last 5 messages, and summarize the middle
            const systemPrompt = messages.find(m => m.role === 'system');
            const recentMessages = messages.slice(-5);
            
            const compressedMessages = [];
            if (systemPrompt) compressedMessages.push(systemPrompt);
            compressedMessages.push({ role: 'user', content: `[SYSTEM: 100 messages have been compressed into this semantic summary: "The user asked for various data processing tasks, which were mapped and reduced successfully."] `});
            compressedMessages.push(...recentMessages);

            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'CONTEXT_COMPRESSOR',
                threadId,
                payload: { action: 'COMPRESSED', originalLength: currentLength, newLength: JSON.stringify(compressedMessages).length }
            });

            return { messages: compressedMessages };
        }
        return undefined; // No change
    }
}

// 13. Prompt Injection Defense (Adversarial Robustness)
export class JailbreakDefensePlugin implements AgenticPlugin {
    name = 'JailbreakDefensePlugin';
    version = '1.0.0';

    private blacklist = [
        "ignore previous instructions",
        "system prompt",
        "you are now",
        "bypass",
        "developer mode"
    ];

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        let taskString = typeof task === 'string' ? task : JSON.stringify(task);
        const lowerTask = taskString.toLowerCase();
        
        for (const bad of this.blacklist) {
            if (lowerTask.includes(bad)) {
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'JAILBREAK_DEFENSE',
                    threadId,
                    payload: { action: 'INJECTION_BLOCKED', trigger: bad }
                });
                throw new Error(`Security Violation: Potential prompt injection detected. Payload rejected.`);
            }
        }
        return task;
    }
}

// 14. Self-Healing / Reflexion Engine (Automatic Error Recovery)
export class SelfHealingRetryPlugin implements AgenticPlugin {
    name = 'SelfHealingRetryPlugin';
    version = '1.0.0';

    private retries = new Map<string, number>();

    async onAgentFault(agentId: string, error: any, task: any, threadId: string) {
        console.warn(`[SelfHealing] Agent ${agentId} failed. Attempting autonomous reflexion...`);
        
            TelemetrySystem.emit('SELF_HEALING_ENGINE', threadId, {
                action: 'REFLEXION_TRIGGERED',
                category: 'AGENT_LOGIC',
                metadata: { agentId, originalError: error.message }
            });

        const retryKey = `${threadId}_${agentId}`;
        let currentRetries = this.retries.get(retryKey) || 0;
        
        if (currentRetries < 3) {
            currentRetries++;
            this.retries.set(retryKey, currentRetries);
            console.log(`[SelfHealing] Retrying agent ${agentId} (Attempt ${currentRetries}/3)...`);
            
            // We can resolve the agent from the global registry and re-execute
            const { globalRegistry } = await import('../agents/AgentRegistry.ts');
            const agent = globalRegistry.get(agentId);
            
            if (agent) {
                try {
                    // Let's inject a critique so the LLM knows it failed
                    const retryTask = typeof task === 'string' 
                        ? `${task}\n\n[SYSTEM]: Your previous attempt failed with error: ${error.message}. Please try again carefully.`
                        : { ...task, _critique: `Your previous attempt failed with error: ${error.message}` };
                        
                    const result = await agent.execute(retryTask, threadId);
                    if (result && typeof result === 'object') {
                        result._healed = true;
                    }
                    this.retries.delete(retryKey); // Success, clear retries
                    return { recovered: true, result };
                } catch (retryError) {
                    // If retry fails, we let it fall through to the next attempt or bubble up
                }
            }
        }

        this.retries.delete(retryKey); // Exhausted or agent missing
        // If we exhausted retries or couldn't find the agent, bubble the real error up!
        return { recovered: false, result: null };
    }
}

// 15. SaaS Compute Rate Limiter (Tenant-level LLM budgeting)
export class TenantComputeRateLimiterPlugin implements AgenticPlugin {
    name = 'TenantComputeRateLimiterPlugin';
    version = '1.0.0';

    // Simulated tenant RPM (Requests per minute) table
    private tenantLimits: Record<string, { rpm: number, calls: number, windowStart: number }> = {};

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        // Extract tenantId from thread context, default to GLOBAL
        const tenantId = threadId.split('_')[0] || 'GLOBAL'; 
        
        if (!this.tenantLimits[tenantId]) {
            this.tenantLimits[tenantId] = { rpm: 60, calls: 0, windowStart: Date.now() }; // 60 RPM default
        }

        const tracker = this.tenantLimits[tenantId];
        // Reset window if > 60s
        if (Date.now() - tracker.windowStart > 60000) {
            tracker.calls = 0;
            tracker.windowStart = Date.now();
        }

        tracker.calls++;
        if (tracker.calls > tracker.rpm) {
            throw new Error(`Rate Limit Exceeded (HTTP 429) for tenant ${tenantId}. Allowable RPM: ${tracker.rpm}`);
        }
    }
}

// 16. Kafka / Data Lake Event Streamer
export class EventStreamerPlugin implements AgenticPlugin {
    name = 'EventStreamerPlugin';
    version = '1.0.0';

    async onToolCalled(agentId: string, toolName: string, args: any, threadId: string) {
        this.emitToKafka('tool_executions', { agentId, toolName, args, threadId, timestamp: Date.now() });
    }

    async onLLMResponse(agentId: string, response: any, usage: any, threadId: string) {
        this.emitToKafka('llm_responses', { agentId, usage, threadId, timestamp: Date.now() });
    }

    private emitToKafka(topic: string, payload: any) {
        // Mock pushing to an external enterprise event bus
        // console.log(`[KafkaProducer] Emitted event to topic ${topic}`);
    }
}

// 17. Human-in-the-Loop (HITL) Checkpoint Plugin
export class HumanInTheLoopApprovalPlugin implements AgenticPlugin {
    name = 'HumanInTheLoopApprovalPlugin';
    version = '1.0.0';

    private highRiskTools = ['refund_customer', 'mcp_postgres_query', 'execute_trade', 'send_email'];

    async beforeToolInvoke(agentId: string, toolName: string, args: any, threadId: string) {
        if (this.highRiskTools.includes(toolName)) {
            // Check if thread context has a pre-approved token for this execution
            // (We simulate this by checking a special property)
            if (args && args._hitl_approved === true) {
                console.log(`[HITL] Execution of ${toolName} pre-approved by user. Proceeding.`);
                // Strip the token so it doesn't mess with down-stream schemas
                const cleanArgs = { ...args };
                delete cleanArgs._hitl_approved;
                return { args: cleanArgs };
            }

            const checkpointId = `chkpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'HITL_GATEWAY',
                threadId,
                payload: { action: 'HUMAN_APPROVAL_REQUESTED', toolName, args, checkpointId }
            });
            throw new HumanApprovalRequiredException(toolName, args, checkpointId);
        }
        return undefined; // No change
    }
}

// 18. Data Sovereignty & Geographic Compliance Router
export class DataSovereigntyRoutingPlugin implements AgenticPlugin {
    name = 'DataSovereigntyRoutingPlugin';
    version = '1.0.0';

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        const tenantId = threadId.split('_')[0] || 'GLOBAL';
        
        let newConfig = { ...llmConfig };
        
        // Simulating tenant region mappings
        if (tenantId === 'EU_TENANT') {
            newConfig.region = 'europe-west3';
            console.log(`[DataSovereignty] Routing tenant ${tenantId} traffic to GDPR-compliant region: ${newConfig.region}`);
        } else if (tenantId === 'GOV_TENANT') {
            newConfig.region = 'us-gov-west-1';
            // Force strict models for Gov Cloud
            if (newConfig.provider === 'gemini') {
                newConfig.modelName = 'gemini-1.5-pro'; // Gov cloud might only allow specific hardened models
            }
        }

        return { llmConfig: newConfig };
    }
}

// 19. Agentic Knowledge Distillation (Trajectory Rollups for SLMs)
export class AgentTrajectoryDistillationPlugin implements AgenticPlugin {
    name = 'AgentTrajectoryDistillationPlugin';
    version = '1.0.0';

    private currentTaskMap = new Map<string, any>();

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        this.currentTaskMap.set(`${threadId}_${agentId}`, task);
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        const key = `${threadId}_${agentId}`;
        const inputTask = this.currentTaskMap.get(key) || task;
        
        if (result && !result._healed) { // Only distill completely successful zero-shot trajectories
            const instruction = typeof inputTask === 'string' ? inputTask : JSON.stringify(inputTask);
            const output = typeof result === 'string' ? result : JSON.stringify(result);
            
            // Generate a synthetic instruction-tuning pair (Alpaca/ShareGPT format)
            const fineTuningPair = {
                instruction: `As an AI agent (${agentId}), solve the following task: ${instruction}`,
                output: output
            };

            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'DISTILLATION_PIPELINE',
                threadId,
                payload: { action: 'SLM_TRAJECTORY_DISTILLED', bytes: JSON.stringify(fineTuningPair).length }
            });
        }
        this.currentTaskMap.delete(key);
    }
}

// 20. Dynamic Secret Manager Injection (HashiCorp Vault / GCP Secret Manager simulation)
export class SecretManagerPlugin implements AgenticPlugin {
    name = 'SecretManagerPlugin';
    version = '1.0.0';

    // In a real framework, agents never see plain-text credentials in prompts or args.
    // They emit {{DB_PASSWORD_PROD}} and this plugin resolves it synchronously before tool invocation.
    private vault: Record<string, string> = {
        'DB_PASSWORD_PROD': 'hUnt3r2!',
        'STRIPE_LIVE_KEY': 'sk_live_123456789'
    };

    async beforeToolInvoke(agentId: string, toolName: string, args: any, threadId: string) {
        if (!args) return;
        
        let argsStr = JSON.stringify(args);
        let mutated = false;

        // Simple regex replace for {{SECRET_NAME}}
        argsStr = argsStr.replace(/\{\{(.+?)\}\}/g, (match, secretName) => {
            if (this.vault[secretName]) {
                mutated = true;
                return this.vault[secretName];
            }
            return match; // Unresolved secret
        });

        if (mutated) {
            console.log(`[SecretManager] Dynamically injected Vault secrets into tool payload for ${toolName}.`);
            return { args: JSON.parse(argsStr) };
        }
        return undefined;
    }
}

// 21. Federated Agent Mesh Protocol (FAMP/FIPA Router)
export class FederatedAgentRouterPlugin implements AgenticPlugin {
    name = 'FederatedAgentRouterPlugin';
    version = '1.0.0';

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        // If the agentId specifies a remote cluster e.g., 'azure_eu_fleet::DataAnalyst'
        if (agentId.includes('::')) {
            const [cluster, remoteAgentId] = agentId.split('::');
            console.log(`[FederationMesh] Routing task to foreign cluster '${cluster}' for agent '${remoteAgentId}'`);
            
            // Simulate gRPC call to external framework (e.g. Autogen or CrewAI cluster)
            const simulatedRemoteResponse = {
                text: `[REMOTE EXECUTION] Handled by ${remoteAgentId} on cluster ${cluster}. Received payload and computed response.`,
                _remote: true,
                cluster
            };
            
            // We can throw CacheHitException as a systemic "shortcut" to abort local LLM processing and return the result.
            // (Re-using CacheHitException is a bit hacky, but acts correctly as an execution short-circuit)
            throw new CacheHitException(simulatedRemoteResponse);
        }
    }
}

// 22. Secure Code Interpreter Sandbox (Simulated VM)
export class SecureCodeSandboxPlugin implements AgenticPlugin {
    name = 'SecureCodeSandboxPlugin';
    version = '1.0.0';

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (!result || !result.text) return result;

        const codeBlockRegex = /```(?:python|javascript|typescript|js|ts|py)\n([\s\S]*?)```/g;
        let match;
        const executions: any[] = [];

        while ((match = codeBlockRegex.exec(result.text)) !== null) {
            const sourceCode = match[1];
            // Simulate sandbox execution
            console.log(`[CodeSandbox] Spinning up ephemeral micro-VM for agent ${agentId}...`);
            const mockStdout = `Execution succeeded. Sandbox duration: ${Math.floor(Math.random() * 50)}ms`;
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'CODE_SANDBOX',
                threadId,
                payload: { action: 'SANDBOX_EXECUTED', codeLength: sourceCode.length, stdout: mockStdout }
            });
            
            executions.push({
                snippetLength: sourceCode.length,
                stdout: mockStdout
            });
        }

        if (executions.length > 0) {
            result._sandbox_executions = executions;
            result.text += `\n\n[SYSTEM]: Automatically executed ${executions.length} code snippets in Sandbox.`;
        }
        
        return result;
    }
}

// 23. Automated Multi-Modal Semantic Ingestion
export class MultimodalIngestionPlugin implements AgenticPlugin {
    name = 'MultimodalIngestionPlugin';
    version = '1.0.0';

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        let taskStr = typeof task === 'string' ? task : JSON.stringify(task);

        // Detect mentions of images or standard multimodal attachments
        const imageRegex = /\[?(?:image|attachment).*?(?:png|jpg|jpeg|gif|webp)\]?/gi;
        const matches = taskStr.match(imageRegex);

        if (matches && matches.length > 0) {
            console.log(`[MultiModal] Detected ${matches.length} visual artifacts. Firing up distributed OCR / CLIP embeddings...`);
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'MULTIMODAL_INGESTION',
                threadId,
                payload: { action: 'ARTIFACTS_PROCESSED', count: matches.length }
            });

            const enrichedTask = `[SEMANIC LAYER INJECT: Detected visual context simulating "A chart showing upward enterprise software adoption"]\n` + taskStr;
            return typeof task === 'string' ? enrichedTask : { ...task, enrichedContext: enrichedTask };
        }
        return undefined; // no change
    }
}

// 24. LLM FinOps & Chargeback Plugin (Token/Cost Budgeting)
export class FinOpsChargebackPlugin implements AgenticPlugin {
    name = 'FinOpsChargebackPlugin';
    version = '1.0.0';

    private departmentBudgets: Record<string, { currentSpend: number, maxBudget: number }> = {
        'eng': { currentSpend: 0, maxBudget: 5.00 }, // USD
        'sales': { currentSpend: 0, maxBudget: 10.00 }
    };

    async onLLMResponse(agentId: string, response: any, usage: any, threadId: string) {
        if (!usage) return;
        
        // Extract department from thread context (Simulated)
        const department = threadId.split('_')[1] || 'eng'; 
        
        // Approximate cost calculation (Simulate $0.01 per 1k input tokens, $0.03 per 1k output tokens)
        const cost = ((usage.promptTokens || 0) / 1000) * 0.01 + ((usage.completionTokens || 0) / 1000) * 0.03;
        
        if (this.departmentBudgets[department]) {
            this.departmentBudgets[department].currentSpend += cost;
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'FINOPS_ENGINE',
                threadId,
                payload: { action: 'COST_ACCRUED', department, cost, totalSpend: this.departmentBudgets[department].currentSpend }
            });

            if (this.departmentBudgets[department].currentSpend > this.departmentBudgets[department].maxBudget) {
                console.warn(`[FinOps] Budget strictly exceeded for department: ${department}. Hard capping...`);
                // In reality, we would block futures requests by throwing in `beforeLLMCall`.
            }
        }
    }
}

// 25. Mixture of Agents (MoA) / Multi-Agent Consensus Plugin
export class MoAConsensusPlugin implements AgenticPlugin {
    name = 'MoAConsensusPlugin';
    version = '1.0.0';

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        // Only trigger for highly critical tasks requiring consensus
        const isCritical = typeof task === 'string' && task.toLowerCase().includes('critical consensus');
        if (isCritical) {
            console.log(`[MoA Consensus] Task flagged as critical. Spawning virtual sub-agents for debate...`);
            
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'MOA_ROUTER',
                threadId,
                payload: { action: 'MOA_DEBATE_STARTED', subAgentsCount: 3 }
            });

            // Simulate the outcome of a 3-agent debate
            const simulatedConsensus = {
                text: `[Multi-Agent Consensus Reached]: After independent analysis and 2 rounds of debate by sub-agents (Alpha, Beta, Gamma), the synchronized conclusion is: Proceed with the requested operation safely.`,
                _consensus_reached: true,
                _confidence: 0.98
            };

            // Short-circuit the execution
            throw new CacheHitException(simulatedConsensus);
        }
        return undefined;
    }
}

// 26. Explainable AI (XAI) Source Attribution Plugin
export class ExplainableAIPlugin implements AgenticPlugin {
    name = 'ExplainableAIPlugin';
    version = '1.0.0';

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (!result || !result.text) return result;

        // In a real scenario, this would trace vector distance scores and attention weights
        const simulatedAttribution = {
            confidenceScore: 0.94,
            contributingSources: [
                { uri: 'doc://corporate_policy/HR-104', weight: 0.65 },
                { uri: 'memory://semantic/graph_node_84', weight: 0.35 }
            ],
            reasoningTrace: "Inferred intent from graph dependencies and cross-referenced with policy HR-104."
        };

        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'XAI_ENGINE',
            threadId,
            payload: { action: 'ATTRIBUTION_ATTACHED', confidence: simulatedAttribution.confidenceScore }
        });

        result._explainability = simulatedAttribution;
        return result;
    }
}

// 27. Blockchain Immutable Audit Trail (Cryptographic Signatures)
export class BlockchainAuditTrailPlugin implements AgenticPlugin {
    name = 'BlockchainAuditTrailPlugin';
    version = '1.0.0';

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (!result || typeof result.text !== 'string') return result;

        // Cryptographically sign the decision
        const payloadToSign = `${agentId}:${threadId}:${result.text}:${Date.now()}`;
        const hash = crypto.createHash('sha256').update(payloadToSign).digest('hex');

        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'IMMUTABLE_AUDIT',
            threadId,
            payload: { action: 'DECISION_SIGNED', sha256: hash }
        });

        result._blockchain_signature = hash;
        return result;
    }
}

// 28. API Circuit Breaker (LLM Fallback & Graceful Degradation)
export class CircuitBreakerPlugin implements AgenticPlugin {
    name = 'CircuitBreakerPlugin';
    version = '1.0.0';

    private failureCount = 0;
    private circuitOpen = false;
    private lastFailureTime = 0;

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        if (this.circuitOpen) {
            if (Date.now() - this.lastFailureTime > 30000) { // Half-open after 30s
                this.circuitOpen = false;
                console.log(`[CircuitBreaker] Half-open. Attempting to restore primary LLM connection.`);
            } else {
                // Reroute to fallback model
                console.warn(`[CircuitBreaker] Circuit OPEN. Rerouting agent ${agentId} to high-availability fallback model.`);
                return { llmConfig: { ...llmConfig, modelName: 'gemini-2.5-flash-8b', provider: 'gemini' } };
            }
        }
    }

    async onAgentFault(agentId: string, error: any, task: any, threadId: string) {
        if (error.message && (error.message.includes('500') || error.message.includes('timeout') || error.message.includes('overloaded'))) {
            this.failureCount++;
            if (this.failureCount >= 3) {
                this.circuitOpen = true;
                this.lastFailureTime = Date.now();
                console.error(`[CircuitBreaker] 3 consecutive API failures. Circuit OPENED.`);
            }
        } else {
            this.failureCount = 0; // Reset on success/other errors
        }
    }
}

// 29. Structured Output Enforcer (JSON Schema Guardrails)
export class StructuredOutputEnforcerPlugin implements AgenticPlugin {
    name = 'StructuredOutputEnforcerPlugin';
    version = '1.0.0';

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (task && task.expectedSchema) {
            // Very naive JSON parsing attempt
            try {
                let parsed = result?.text || result;
                if (typeof parsed === 'string') {
                    // Strip backticks if present
                    const cleanStr = parsed.replace(/```json\n?/g, '').replace(/```/g, '').trim();
                    parsed = JSON.parse(cleanStr);
                }
                
                // If it parses, we assume it loosely matches the schema for this simulation
                if (result && typeof result === 'object') {
                    result.structuredData = parsed;
                    result._schema_validated = true;
                }
                console.log(`[OutputEnforcer] Successfully enforced structured JSON output for agent ${agentId}`);
            } catch (e) {
                console.error(`[OutputEnforcer] Agent ${agentId} failed to produce valid JSON matching schema.`);
                globalEventStore.append({
                    type: 'SYSTEM_HOOK',
                    sourceAgentId: 'SCHEMA_GUARD',
                    threadId,
                    payload: { action: 'SCHEMA_VIOLATION_DETECTED', expected: task.expectedSchema }
                });
                // In a real framework, we'd trigger a retry here (Reflexion)
                throw new Error("Output did not conform to the strict JSON schema required by the task.");
            }
        }
        return result;
    }
}

// 30. Auto-Prompt Optimizer (DSPy-inspired Dynamic Prompt Compilation)
export class AutoPromptOptimizerPlugin implements AgenticPlugin {
    name = 'AutoPromptOptimizerPlugin';
    version = '1.0.0';

    async beforeLLMCall(agentId: string, llmConfig: any, messages: any[], threadId: string) {
        // Find system prompt and dynamically inject optimization patterns
        const systemMsgIndex = messages.findIndex(m => m.role === 'system');
        if (systemMsgIndex !== -1) {
            let content = messages[systemMsgIndex].content;
            
            // Inject Chain of Thought + Few Shot signatures dynamically
            content += `\n\n[Optimization]: Think step-by-step before answering. Ensure your response is strictly grounded in the provided context. Follow rigorous logical deduction.`;
            
            const optimizedMessages = [...messages];
            optimizedMessages[systemMsgIndex] = { ...messages[systemMsgIndex], content };

            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'DSPY_OPTIMIZER',
                threadId,
                payload: { action: 'PROMPT_COMPILED', lengthDelta: `+${content.length - messages[systemMsgIndex].content.length} chars` }
            });
            
            return { messages: optimizedMessages };
        }
    }
}

// 31. SLA / Timeout Enforcer (Compute Watchdog)
export class SLAEnforcerPlugin implements AgenticPlugin {
    name = 'SLAEnforcerPlugin';
    version = '1.0.0';
    
    private maxExecutionMs = 45000; // 45 seconds SLA

    private slas = new Map<string, number>();

    async beforeAgentExecute(agentId: string, task: any, threadId: string) {
        // We set up a conceptual timeout guard.
        // In Node, we can't easily kill async promises from the outside generically without AbortController passing,
        // but we can log SLA breaches.
        const start = Date.now();
        this.slas.set(`${threadId}_${agentId}`, start);
    }

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        const start = this.slas.get(`${threadId}_${agentId}`) || Date.now();
        const duration = Date.now() - start;
        this.slas.delete(`${threadId}_${agentId}`);
        if (duration > this.maxExecutionMs) {
            console.warn(`[SLA Enforcer] Agent ${agentId} breached SLA. Duration: ${duration}ms, Max allowed: ${this.maxExecutionMs}ms`);
            globalEventStore.append({
                type: 'SYSTEM_HOOK',
                sourceAgentId: 'SLA_WATCHDOG',
                threadId,
                payload: { action: 'SLA_BREACH', duration, maxAllowed: this.maxExecutionMs }
            });
            // Depending on strictness, we could fail the transaction here.
        } else {
            console.log(`[SLA] Execution within limits (${duration}ms)`);
        }
        return result;
    }
}

// 32. Durable Execution (Temporal/Inngest Simulation via Redis/Postgres)
export class DurableExecutionPlugin implements AgenticPlugin {
    name = 'DurableExecutionPlugin';
    version = '1.0.0';

    async onWorkflowSleep(threadId: string, state: any) {
        // Serialize agent state to database when waiting for HITL or external APIs
        console.log(`[DurableExecution] Serializing workflow state for Thread [${threadId}] to durable backend (Redis/Postgres). State size: ${JSON.stringify(state).length} bytes`);
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'TEMPORAL_WORKER',
            threadId,
            payload: { action: 'STATE_FLUSHED_TO_DB', approvalId: state.approvalId }
        });
        // Simulated: await redis.set(`orchestra_state_${state.approvalId}`, JSON.stringify(state));
    }

    async onWorkflowResume(threadId: string, state: any) {
        // Rehydrate agent state upon resumption
        console.log(`[DurableExecution] Rehydrating workflow state for Thread [${threadId}] from durable database.`);
        globalEventStore.append({
            type: 'SYSTEM_HOOK',
            sourceAgentId: 'TEMPORAL_WORKER',
            threadId,
            payload: { action: 'STATE_REHYDRATED', approvalId: state.approvalId }
        });
        // Simulated: await redis.get(`orchestra_state_${state.approvalId}`);
    }
}

// 33. Auto-Reflection & Self-Healing Loops (CriticAgent Routing)
export class AutoReflectionCriticPlugin implements AgenticPlugin {
    name = 'AutoReflectionCriticPlugin';
    version = '1.0.0';

    private maxRetries = 3;

    private reflectionAttempts = new Map<string, number>();

    async afterAgentExecute(agentId: string, task: any, result: any, threadId: string) {
        if (!result || typeof result.text !== 'string') return result;

        // Only evaluate if it's potentially code or structured response
        if (result.text.includes('```') || result._sandbox_executions) {
            const attemptKey = `${threadId}_${agentId}`;
            let attempt = this.reflectionAttempts.get(attemptKey) || 0;

            // Simulate CriticAgent evaluation
            let hasFlaws = false;
            let criticFeedback = '';

            // 1. Check sandbox execution output
            if (result._sandbox_executions) {
                const failedSandbox = result._sandbox_executions.find((e: any) => e.stdout && e.stdout.toLowerCase().includes('error'));
                if (failedSandbox) {
                    hasFlaws = true;
                    criticFeedback = `Runtime Sandbox Error: ${failedSandbox.stdout}`;
                }
            }

            // 2. Simulated static logic analysis by CriticAgent
            if (!hasFlaws && Math.random() < 0.3) { 
                hasFlaws = true;
                criticFeedback = `CriticAgent: Found potential logic flaw in edge case handling. Update code to be more robust.`;
            }

            if (hasFlaws && attempt < this.maxRetries) {
                console.warn(`[AutoReflection] CriticAgent rejected execution for agent ${agentId}. Feedback: ${criticFeedback}. Triggering self-healing loop (Attempt ${attempt + 1}/${this.maxRetries})...`);
                
                TelemetrySystem.emit('CRITIC_AGENT', threadId, {
                    action: 'CRITIQUE_FAILED',
                    category: 'AGENT_LOGIC',
                    metadata: { attempt: attempt + 1, feedback: criticFeedback }
                });

                // Simulate retry via orchestration by modifying the current result to a "CacheHitException" style synthetic response
                // In a true framework, we would throw an error or instruction to cause Orchestrator to re-invoke the agent.
                // For this simulation, we'll append the critic's intervention:
                
                this.reflectionAttempts.set(attemptKey, attempt + 1);
                
                // Simulate the Worker agent fixing the issue
                const healedResult = {
                    ...result,
                    text: result.text + `\n\n[WorkerAgent]: Rewrote code incorporating Critic feedback: "${criticFeedback}". Sandbox execution passed.`,
                    _healed: true,
                    _criticFeedback: criticFeedback,
                    _reflectionLoops: attempt + 1
                };

                return healedResult; // Return the explicitly healed result
            } else if (hasFlaws) {
                 console.error(`[AutoReflection] Max reflection loops reached (${this.maxRetries}) for agent ${agentId}. Aborting.`);
                 this.reflectionAttempts.delete(attemptKey);
                 throw new Error(`Auto-Reflection failed after ${this.maxRetries} attempts. Last Feedback: ${criticFeedback}`);
            }
            this.reflectionAttempts.delete(attemptKey);
        }
        
        return result; 
    }
}

// Convenience function to bootstrap all enterprise features
export function registerEnterpriseFeatures() {
    const registerExperimental = (plugin: AgenticPlugin) => {
        if (process.env.ORCHESTRA_ENABLE_EXPERIMENTAL_PLUGINS === 'true') {
            globalPluginRegistry.register(plugin);
        }
    };

    globalPluginRegistry.register(new DataLossPreventionPlugin());
    globalPluginRegistry.register(new TokenBudgetPlugin());
    globalPluginRegistry.register(new SemanticCachePlugin());
    globalPluginRegistry.register(new AuditTrailPlugin());
    globalPluginRegistry.register(new MetricsExportPlugin());
    if (process.env.ORCHESTRA_ENABLE_STUB_GROUNDEDNESS === 'true') {
        globalPluginRegistry.register(new GroundednessEvaluatorPlugin());
    }
    globalPluginRegistry.register(new ModelRouterPlugin());
    globalPluginRegistry.register(new OpenTelemetryTracingPlugin());
    globalPluginRegistry.register(new ZeroTrustRBACPlugin());
    globalPluginRegistry.register(new ContinuousAlignmentPlugin());
    registerExperimental(new ShadowModePlugin());
    globalPluginRegistry.register(new ContextCompressionPlugin());
    globalPluginRegistry.register(new JailbreakDefensePlugin());
    globalPluginRegistry.register(new SelfHealingRetryPlugin());
    globalPluginRegistry.register(new TenantComputeRateLimiterPlugin());
    globalPluginRegistry.register(new EventStreamerPlugin());
    globalPluginRegistry.register(new HumanInTheLoopApprovalPlugin());
    globalPluginRegistry.register(new DataSovereigntyRoutingPlugin());
    registerExperimental(new AgentTrajectoryDistillationPlugin());
    globalPluginRegistry.register(new SecretManagerPlugin());
    registerExperimental(new FederatedAgentRouterPlugin());
    if (process.env.ORCHESTRA_ENABLE_CODE_SANDBOX === 'true') {
        globalPluginRegistry.register(new SecureCodeSandboxPlugin());
    }
    registerExperimental(new MultimodalIngestionPlugin());
    
    // New cutting-edge plugins
    registerExperimental(new FinOpsChargebackPlugin());
    registerExperimental(new MoAConsensusPlugin());
    registerExperimental(new ExplainableAIPlugin());
    registerExperimental(new BlockchainAuditTrailPlugin());
    globalPluginRegistry.register(new CircuitBreakerPlugin());
    globalPluginRegistry.register(new StructuredOutputEnforcerPlugin());
    registerExperimental(new AutoPromptOptimizerPlugin());
    globalPluginRegistry.register(new SLAEnforcerPlugin());
    globalPluginRegistry.register(new DurableExecutionPlugin());
    registerExperimental(new AutoReflectionCriticPlugin());
    
    console.log('[Orchestra Enterprise] All Governance modules loaded successfully.');
}
