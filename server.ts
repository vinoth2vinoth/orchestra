import express from 'express';
import path from 'path';
import * as fs from 'fs';

const logToFile = (msg: string) => {
    try {
        fs.appendFileSync('server_logs.txt', `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
};

import { createServer as createViteServer } from 'vite';
import { BaseAgent } from './src/framework/agents/BaseAgent.js';
import { WorkerAgent } from './src/framework/agents/WorkerAgent.js';
import { ManagerAgent } from './src/framework/agents/ManagerAgent.js';
import { globalRegistry } from './src/framework/agents/AgentRegistry.js';
import { Orchestrator, WorkflowConfig } from './src/framework/orchestration/Orchestrator.js';
import { MemoryMesh } from './src/framework/memory/MemoryMesh.js';
import { globalEventStore } from './src/framework/core/EventStore.js';
import { globalStateAdapter } from './src/framework/core/StateAdapter.js';
import { InfraStressor } from './src/framework/testing/Stressor.js';
import { globalEscalationManager } from './src/framework/governance/EscalationManager.js';
import { globalPluginRegistry, AgenticPlugin } from './src/framework/core/PluginRegistry.js';
import './src/framework/tools/ExternalTools.js';
import { MCPClient } from './src/framework/tools/MCPClient.js';

import { registerEnterpriseFeatures, MetricsExportPlugin } from './src/framework/plugins/EnterpriseFeatures.js';
import { globalStateStore } from './src/framework/orchestration/StateStore.js';
import { CriticAgent } from './src/framework/agents/CriticAgent.js';
import { PlannerAgent } from './src/framework/agents/PlannerAgent.js';
import { ProviderRegistry } from './src/framework/llm/ProviderRegistry.js';
import { GoogleGenAI } from '@google/genai';
import { globalWorkerPool } from './src/framework/WorkerPool.js';

// Bootstrap Enterprise Features (DLP, Token Budget, Semantic Cache, Audit, Metrics)
registerEnterpriseFeatures();

// Bootstrap Model Context Protocol connections
MCPClient.discoverAndRegister('https://internal.enterprise.mcp.ai/v1');

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON
  app.use(express.json({ limit: '10mb' }));

  const globalMemory = new MemoryMesh();
  
  // Initialize Distributed Workers
  globalWorkerPool.init(3);

  // SSE streaming endpoint for telemetry
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send immediate ping to establish connection
    res.write(': keep-alive\n\n');

    // Subscribe to framework events from backend
    const unsubscribe = globalEventStore.subscribe((event) => {
        const dataStr = JSON.stringify(event);
        res.write(`data: ${dataStr}\n\n`);
    });

    req.on('close', () => {
        unsubscribe();
    });
  });

  // Approval endpoint for Human-in-the-Loop (resumes suspended orchestrator state)
  app.post('/api/approval/:approvalId', async (req, res) => {
      const { approvalId } = req.params;
      const { resolution, feedback } = req.body;
      
      try {
          const state = await globalStateStore.getState(approvalId);
          const agents: BaseAgent[] = [];
          if (state && state.agentDefinitions) {
             globalRegistry.clear();
             let managerNode = null;
             for (const def of state.agentDefinitions) {
                 let roleUpper = def.role.toUpperCase();
                 let ag: BaseAgent;
                 if (roleUpper.includes('MANAGER')) {
                    ag = new ManagerAgent(def.name, def.systemInstruction, 'MANAGER', globalMemory, def.llmConfig, def.capabilities, undefined, def.priority, def.urgency);
                 } else if (roleUpper.includes('REVIEW') || roleUpper.includes('CRITIC')) {
                    ag = new CriticAgent(def.name, def.systemInstruction, 'CRITIC', globalMemory, def.llmConfig, def.capabilities, undefined, def.priority, def.urgency);
                 } else if (roleUpper.includes('PLAN')) {
                    ag = new PlannerAgent(def.name, def.systemInstruction, 'PLANNER', globalMemory, def.llmConfig, def.capabilities, undefined, def.priority, def.urgency);
                 } else {
                    ag = new WorkerAgent(def.name, def.systemInstruction, 'WORKER', globalMemory, def.llmConfig, def.capabilities, undefined, def.priority, def.urgency);
                 }
                 agents.push(ag);
                 globalRegistry.register(ag);
                 if (ag instanceof ManagerAgent && !managerNode) managerNode = ag;
             }
             if (managerNode) {
                 managerNode.setSubordinates(agents.filter(a => a !== managerNode));
             }
          }

          const orchestrator = new Orchestrator();
          
          const result = await orchestrator.resumeWorkflow(approvalId, resolution, feedback, agents);
          
          res.json({ success: true, result });
      } catch (error: any) {
          console.error('Error resuming workflow:', error);
          res.status(500).json({ error: error.message });
      }
  });

  // Time-Travel Debugging (Dimension 09)
  app.get('/api/debug/snapshot/:threadId/:timestamp', (req, res) => {
      const { threadId, timestamp } = req.params;
      const snapshot = globalEventStore.getSnapshotAtTimestamp(threadId, parseInt(timestamp, 10));
      res.json({ snapshot });
  });

  // Analytics & Dashboard Telemetry
  app.get('/api/analytics', (req, res) => {
      const logs = globalEventStore.getLogs();
      let totalTokens = 0;
      let errorCount = 0;
      let totalWorkflows = 0;
      let totalAgentInvocations = 0;

      logs.forEach(log => {
          const isTelemetry = log.type === 'TELEMETRY_EMIT' || log.type === 'SYSTEM_HOOK';
          if (isTelemetry && (log.payload?.action === 'TELEMETRY_LOG' || log.payload?.action === 'LLM_USAGE_RECORDED')) {
              const usage = log.payload?.tokenUsage || log.payload?.metrics;
              if (usage) {
                  totalTokens += (usage.promptTokens || usage.prompt_tokens || 0) + (usage.completionTokens || usage.completion_tokens || 0);
              }
          }
          if (log.type === 'ERROR_THROWN') errorCount++;
          if (log.type === 'WORKFLOW_COMPLETED') totalWorkflows++;
          if (log.type === 'LLM_GENERATION_STARTED') totalAgentInvocations++;
      });

      res.json({
          totalTokens,
          errorCount,
          totalWorkflows,
          totalAgentInvocations,
          totalEvents: logs.length
      });
  });

  // --- Workspace File Management APIs ---
  const workspaceRoot = path.join(process.cwd(), 'workspace');
  
  // Ensure workspace exists
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // Get directory structure
  app.get('/api/workspace/files', (req, res) => {
    try {
      const getDirStructure = (dirPath: string): any[] => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        let result = [];
        for (const entry of entries) {
           const fullPath = path.join(dirPath, entry.name);
           const relativePath = path.relative(workspaceRoot, fullPath);
           const isDir = entry.isDirectory();
           
           result.push({
              name: entry.name,
              path: relativePath,
              type: isDir ? 'directory' : 'file',
              children: isDir ? getDirStructure(fullPath) : undefined
           });
        }
        return result.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      };
      
      const tree = getDirStructure(workspaceRoot);
      res.json(tree);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read file
  app.get('/api/workspace/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      
      const absolutePath = path.join(workspaceRoot, filePath);
      
      // Simple security check to prevent directory traversal
      if (!absolutePath.startsWith(workspaceRoot)) {
         return res.status(403).json({ error: 'Access denied' });
      }
      
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
         return res.status(404).json({ error: 'File not found' });
      }
      
      const content = fs.readFileSync(absolutePath, 'utf8');
      res.json({ content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Write file
  app.post('/api/workspace/file', (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      
      const absolutePath = path.join(workspaceRoot, filePath);
      
      if (!absolutePath.startsWith(workspaceRoot)) {
         return res.status(403).json({ error: 'Access denied' });
      }
      
      // Ensure directory exists
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
         fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(absolutePath, content || '', 'utf8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create directory
  app.post('/api/workspace/dir', (req, res) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: 'path required' });
      
      const absolutePath = path.join(workspaceRoot, dirPath);
      
      if (!absolutePath.startsWith(workspaceRoot)) {
         return res.status(403).json({ error: 'Access denied' });
      }
      
      if (!fs.existsSync(absolutePath)) {
         fs.mkdirSync(absolutePath, { recursive: true });
      }
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete file or directory
  app.delete('/api/workspace/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      
      const absolutePath = path.join(workspaceRoot, filePath);
      
      if (!absolutePath.startsWith(workspaceRoot) || absolutePath === workspaceRoot) {
         return res.status(403).json({ error: 'Access denied' });
      }
      
      if (fs.existsSync(absolutePath)) {
         fs.rmSync(absolutePath, { recursive: true, force: true });
      }
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  // --- End Workspace APIs ---

  // API endpoint for reading agent mental state
  app.get('/api/agents/:id/state', async (req, res) => {
      const agent = globalRegistry.get(req.params.id);
      if (!agent) {
          // If not in global registry (e.g., if simulation hasn't run yet or agent isn't spawned), return empty state
          return res.json({
              instructionPatches: [],
              localBlackboard: {},
              hostedTools: [],
              coreMemory: { persona: '', human: '' }
          });
      }
      
      const localToolNames = Object.keys(agent.localTools);
      const globalToolNames = Object.keys(globalRegistry.getToolsForAgent(agent.card.id));
      const localBlackboard = await globalStateAdapter.get<Record<string, any>>(`bb:${agent.card.id}`) || {};
      
      res.json({
          id: agent.card.id,
          name: agent.card.name,
          instructionPatches: agent.instructionPatches,
          localBlackboard,
          hostedTools: Array.from(new Set([...localToolNames, ...globalToolNames])),
          coreMemory: agent.memory.getCoreMemory(agent.card.id)
      });
  });

  app.post('/api/diag/stress-test', async (req, res) => {
      try {
          const results = await InfraStressor.runAll();
          res.json(results);
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  // API endpoint for agent interaction
  app.post('/api/chat', async (req, res) => {
    try {
      const { systemInstruction, prompt, agentDefinitions, paradigm: requestedParadigm, edges } = req.body;
      
      // Instead of simple routing, the frontend now provides the transcript as prompt.
      // We will create the agents dynamically using the payload.
      const agents: BaseAgent[] = [];
      let managerNode: ManagerAgent | null = null;
      
      const getLLMConfig = (def: any): any => {
          // No brand lock! If the user provides an API key and a baseURL via def (frontend) or env, use it.
          // Fallback gracefully across whatever keys happen to be provided, prioritizing generic configs first.
          
          let baseURL = def.baseURL || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL;
          let reqModel = def.modelName || process.env.LLM_MODEL || 'gemini-2.5-flash';
          let primaryKey = def.apiKeyValue || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY;

          // If it's openrouter but no explicit base URL is set
          if (!baseURL && reqModel.toLowerCase().includes('openrouter')) {
              baseURL = 'https://openrouter.ai/api/v1';
          }
          
          // Determine potential provider just for failover logic
          const getProvider = (m: string, bUrl?: string) => {
              if (bUrl) return 'openai'; // custom endpoints use openai SDK
              if (m.includes('deepseek')) return 'deepseek';
              if (m.includes('gpt') || m.includes('o1') || m.includes('o3')) return 'openai';
              if (m.includes('claude')) return 'anthropic';
              return 'gemini';
          };
          
          let provider = getProvider(reqModel, baseURL);
          
          logToFile(`Selected provider: ${provider} for model: ${reqModel}`);
          console.log(`[server] Selected provider: ${provider} for model: ${reqModel}`);

          // Try to map specific provider API keys if not universally set, as a fallback
          if (!def.apiKeyValue && !process.env.LLM_API_KEY) {
              if (provider === 'deepseek' && process.env.DEEPSEEK_API_KEY) primaryKey = process.env.DEEPSEEK_API_KEY;
              else if (provider === 'openai' && process.env.OPENAI_API_KEY) primaryKey = process.env.OPENAI_API_KEY;
              else if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) primaryKey = process.env.ANTHROPIC_API_KEY;
              else if (provider === 'gemini' && process.env.GEMINI_API_KEY) primaryKey = process.env.GEMINI_API_KEY;
          }
          
          if (!primaryKey) {
              logToFile(`WARNING: No API key found for provider ${provider}.`);
              console.warn(`[server] WARNING: No API key found for provider ${provider}. This will likely fail.`);
          } else {
              logToFile(`API key found for ${provider} (prefix: ${primaryKey.substring(0, 6)}...)`);
              console.log(`[server] API key found for ${provider} (prefix: ${primaryKey.substring(0, 6)}...)`);
          }
          
          const config: any = { 
              apiKey: primaryKey || '',
              temperature: def.temperature ?? 0.7,
              modelName: reqModel,
              useNativeREST: provider === 'gemini' || !!def.useNativeREST,
              baseURL
          };
          
          // Dynamic fallback mapping: If primary fails, pick a different provider we have the key for
          if (provider !== 'gemini' && process.env.GEMINI_API_KEY) {
              config.fallbackConfig = { apiKey: process.env.GEMINI_API_KEY, modelName: 'gemini-2.5-flash', temperature: def.temperature ?? 0.7 };
          } else if (provider !== 'openai' && process.env.OPENAI_API_KEY) {
              config.fallbackConfig = { apiKey: process.env.OPENAI_API_KEY, modelName: 'gpt-4o-mini', temperature: def.temperature ?? 0.7 };
          } else if (provider !== 'deepseek' && process.env.DEEPSEEK_API_KEY) {
              config.fallbackConfig = { apiKey: process.env.DEEPSEEK_API_KEY, modelName: 'deepseek-chat', temperature: def.temperature ?? 0.7 };
          }
          
          return config;
      };

        if (agentDefinitions && agentDefinitions.length > 0) {
          globalRegistry.clear();
          for (const def of agentDefinitions) {
                 let roleUpper = def.role.toUpperCase();
                 let ag: BaseAgent;
                 const llmConfig = getLLMConfig(def);
                 
                 if (roleUpper.includes('MANAGER')) {
                    ag = new ManagerAgent(def.name, def.systemInstruction, 'MANAGER', globalMemory, llmConfig, def.capabilities, undefined, def.priority, def.urgency, def.id);
                 } else if (roleUpper.includes('REVIEW') || roleUpper.includes('CRITIC')) {
                    ag = new CriticAgent(def.name, def.systemInstruction, 'CRITIC', globalMemory, llmConfig, def.capabilities, undefined, def.priority, def.urgency, def.id);
                 } else if (roleUpper.includes('PLAN')) {
                    ag = new PlannerAgent(def.name, def.systemInstruction, 'PLANNER', globalMemory, llmConfig, def.capabilities, undefined, def.priority, def.urgency, def.id);
                 } else {
                    ag = new WorkerAgent(def.name, def.systemInstruction, 'WORKER', globalMemory, llmConfig, def.capabilities, undefined, def.priority, def.urgency, def.id);
                 }
                 agents.push(ag);
                 globalRegistry.register(ag); // Make sure it's in the global registry!
             if (ag instanceof ManagerAgent && !managerNode) managerNode = ag;
          }
      }

      // If we don't have agents or we're just hitting the manager route
      if (agents.length === 0) {
         // Fallback legacy behavior
         try {
             const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
             const response = await ai.models.generateContent({
                 model: 'gemini-2.5-flash',
                 contents: prompt,
                 config: { systemInstruction, temperature: 0.3 }
             });
             return res.json({ text: response.text });
         } catch (e: any) {
             console.error('Legacy Gemini failed, trying DeepSeek fallback:', e.message);
             if (process.env.DEEPSEEK_API_KEY) {
                 const response = await ProviderRegistry.generate(
                     { apiKey: process.env.DEEPSEEK_API_KEY },
                     systemInstruction,
                     [{ role: 'user', content: prompt }]
                 );
                 return res.json({ text: response.text });
             }
             throw e;
         }
      }

      // Ensure proper hierarchy
      const managerAgents = agents.filter(a => a instanceof ManagerAgent) as ManagerAgent[];
      for (const mgr of managerAgents) {
          if (edges && edges.length > 0) {
              const subordinateIds = edges.filter((e: any) => e.from === mgr.card.id).map((e: any) => e.to);
              mgr.setSubordinates(agents.filter(a => subordinateIds.includes(a.card.id)));
          } else {
              mgr.setSubordinates(agents.filter(a => a !== mgr));
          }
      }

      const orchestrator = new Orchestrator();
      
      const threadId = crypto.randomUUID();
      const hasPlanner = agents.some(a => a.card.role === 'PLANNER');
      const hasCritic = agents.some(a => a.card.role === 'CRITIC');
      const workerCount = agents.filter(a => a.card.role === 'WORKER').length;
      
      // Paradigm selection
      let paradigm: WorkflowConfig['paradigm'] = requestedParadigm || 'HIERARCHICAL';
      if (!requestedParadigm) {
          if (hasPlanner) paradigm = 'MAP_REDUCE';
          else if (workerCount >= 3 && hasCritic) paradigm = 'CONSENSUS';
          else if (agents.length >= 4) paradigm = 'DEBATE';
          else if (managerNode) paradigm = 'HIERARCHICAL';
      }

      const config: WorkflowConfig = { 
          paradigm, 
          agents,
          edges: edges || [],
          blackboard: {
              startTime: new Date().toISOString(),
              initialTask: prompt.substring(0, 500)
          },
          useDistributedQueue: true
      };
      
      const result = await orchestrator.executeWorkflow(prompt, config, threadId);

      // Emit completion with blackboard state for UI observability
      globalEventStore.append({
          type: 'WORKFLOW_COMPLETED',
          sourceAgentId: 'ORCHESTRATOR',
          threadId,
          payload: { 
              result: typeof result === 'string' ? result.substring(0, 1000) : 'Complex Result',
              blackboard: config.blackboard
          }
      });

      // result is from orchestrator
      res.json({ text: typeof result === 'string' ? result : JSON.stringify(result) });

    } catch (error: any) {
      console.error('API Error:', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  // Enterprise Metrics Endpoint
  app.get('/api/metrics', (req, res) => {
    const m = MetricsExportPlugin.metrics;
    let p = `# HELP agent_llm_calls_total Total LLM API Calls\n`;
    p += `# TYPE agent_llm_calls_total counter\n`;
    p += `agent_llm_calls_total ${m.totalLLMCalls}\n\n`;
    p += `# HELP agent_tokens_used_total Total tokens consumed\n`;
    p += `# TYPE agent_tokens_used_total counter\n`;
    p += `agent_tokens_used_total ${m.totalTokensUsed}\n\n`;
    p += `# HELP agent_tools_invoked_total Total tools invoked\n`;
    p += `# TYPE agent_tools_invoked_total counter\n`;
    p += `agent_tools_invoked_total ${m.toolInvocations}\n\n`;
    p += `# HELP agent_tasks_executed_total Total agent workflows/tasks\n`;
    p += `# TYPE agent_tasks_executed_total counter\n`;
    p += `agent_tasks_executed_total ${m.agentExecutions}\n\n`;

    p += `# HELP agent_avg_latency_ms Average agent execution latency\n`;
    p += `# TYPE agent_avg_latency_ms gauge\n`;
    p += `agent_avg_latency_ms ${m.avgLatencyMs.toFixed(2)}\n\n`;

    p += `# HELP agent_last_latency_ms Last agent execution latency\n`;
    p += `# TYPE agent_last_latency_ms gauge\n`;
    p += `agent_last_latency_ms ${m.lastLatencyMs}\n`;
    
    res.set('Content-Type', 'text/plain');
    res.send(p);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
