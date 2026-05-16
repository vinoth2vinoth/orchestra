import { useState, useRef, useEffect, ChangeEvent, useMemo } from 'react';
import { Settings, Play, Square, UserPlus, Trash2, Bot, CircleUserRound, Sparkles, ShieldAlert, Save, Upload, Download, AlertCircle, XCircle, Terminal, Database, History, Brain, Keyboard, Workflow } from 'lucide-react';
import { TelemetryStudio } from './components/TelemetryStudio';
import { AgentInspectorPane } from './components/AgentInspectorPane';
import { ParadigmPlayground } from './components/ParadigmPlayground';
import { CommandPalette, CommandAction } from './components/CommandPalette';
import { Agent, ChatMessage, Edge } from './types';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const DEFAULT_AGENTS: Agent[] = [
  {
    id: '1',
    name: 'Architect',
    role: 'System Designer (Planner)',
    systemInstruction: 'You are an expert software architect. Provide high-level technical designs, structure, and choose the right patterns.',
    avatarColor: 'bg-indigo-400 shadow-[0_0_8px_currentColor]',
    llmProvider: 'auto',
    apiKeyValue: ''
  },
  {
    id: '4',
    name: 'Planner',
    role: 'Planner',
    systemInstruction: 'You are an execution planner. You break complex user tasks down into independent parallelizable subtasks. Write clear instructions for each subtask.',
    avatarColor: 'bg-purple-400 shadow-[0_0_8px_currentColor]',
    llmProvider: 'auto',
    apiKeyValue: ''
  },
  {
    id: '2',
    name: 'Developer',
    role: 'Code Implementer',
    systemInstruction: 'You are a senior full-stack developer. You write clean, performant, and robust code based on the technical design. Provide actual code blocks.',
    avatarColor: 'bg-emerald-400 shadow-[0_0_8px_currentColor]',
    llmProvider: 'auto',
    apiKeyValue: ''
  },
  {
    id: '3',
    name: 'Reviewer',
    role: 'Code Reviewer',
    systemInstruction: 'You are a strict code reviewer. Review the code provided by the Developer. Point out edge cases, security issues, and suggest improvements.',
    avatarColor: 'bg-rose-400 shadow-[0_0_8px_currentColor]',
    llmProvider: 'auto',
    apiKeyValue: ''
  }
];

export default function App() {
  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [paradigm, setParadigm] = useState<'HIERARCHICAL' | 'CONSENSUS' | 'MAP_REDUCE' | 'DEBATE' | 'SWARM' | 'GRAPH'>('GRAPH');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  
  // Orchestration state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  
  // Observability state
  const [liveLogs, setLiveLogs] = useState<any[]>([]);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [inspectAgentId, setInspectAgentId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<any | null>(null);
  const [timeTravelSnapshot, setTimeTravelSnapshot] = useState<any | null>(null);
  const [activeThoughts, setActiveThoughts] = useState<Record<string, string>>({});
  const [healingAgents, setHealingAgents] = useState<Record<string, string>>({});
  const [systemErrors, setSystemErrors] = useState<any[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState<'DEFAULT'|'GHOST'|'BIO'>('DEFAULT');

  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence: Load from localStorage on mount
  useEffect(() => {
    const savedAgents = localStorage.getItem('orchestra_agents_config');
    if (savedAgents) {
      try {
        setAgents(JSON.parse(savedAgents));
      } catch (err) {
        console.error("Failed to load agents from localStorage", err);
      }
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('orchestra_agents_config', JSON.stringify(agents));
  }, [agents]);

  // Connect to SSE for Observability
  useEffect(() => {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        setLiveLogs(prev => {
          const next = [...prev.slice(-199), ev];
          // If we were at the "live" edge, stay at the live edge
          if (scrubIndex === null || scrubIndex === prev.length - 1) {
            setScrubIndex(next.length - 1);
          }
          return next;
        }); 

        if (ev.type === 'HUMAN_INTERVENTION_REQUIRED') {
            setPendingApproval(ev);
        }

        if (ev.type === 'SYSTEM_HOOK' && ev.payload?.action === 'AGENT_THOUGHT_CHUNK') {
          setActiveThoughts(prev => ({
            ...prev,
            [ev.sourceAgentId]: (prev[ev.sourceAgentId] || '') + ev.payload.chunk
          }));
        }

        if (ev.type === 'SYSTEM_HOOK' && ev.payload?.action === 'SELF_HEALING_START') {
          setHealingAgents(prev => ({
            ...prev,
            [ev.sourceAgentId]: ev.payload.reason === 'CRITIQUE_FAILED' ? 'Critique Failed - Refining...' : 'Error Encountered - Recovering...'
          }));
          // Auto-clear healing after 10s if it doesn't resolve
          setTimeout(() => {
             setHealingAgents(prev => {
                const copy = {...prev};
                delete copy[ev.sourceAgentId];
                return copy;
             });
          }, 10000);
        }

        if (ev.type === 'SYSTEM_HOOK' && ev.payload?.action === 'DIAGNOSTIC_ALERT') {
           setSystemErrors(prev => [...prev, ev.payload.error]);
        }

        if (ev.type === 'WORKFLOW_COMPLETED') {
           setActiveThoughts({}); // Clear thoughts on completion
           setHealingAgents({});
        }
      } catch (err) {}
    };
    return () => evtSource.close();
  }, []);

  const handleApprovalResponse = async (resolution: string, feedback?: string) => {
      if (!pendingApproval) return;
      
      setProcessingStatus('Resuming workflow after human intervention...');
      setIsProcessing(true);
      
      try {
          const res = await fetch(`/api/approval/${pendingApproval.payload.approvalId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resolution, feedback })
          });
          setPendingApproval(null);
          
          if (!res.ok) throw new Error('API request failed');
          const data = await res.json();
          
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            senderName: 'Orchestrator',
            senderRole: 'System',
            text: typeof data.result === 'string' ? data.result : JSON.stringify(data.result),
            timestamp: Date.now()
          }]);
  
          setIsProcessing(false);
          setProcessingStatus('Completed');
      } catch(e) {
          console.error("Failed to approve", e);
          setProcessingStatus('Failed to resume workflow.');
          setIsProcessing(false);
      }
  };

  const handleTimeTravelClick = async (logItem: any) => {
      try {
          const res = await fetch(`/api/debug/snapshot/${logItem.threadId}/${logItem.timestamp}`);
          const data = await res.json();
          setTimeTravelSnapshot({ logItem, snapshot: data.snapshot });
      } catch(e) {
          console.error("Failed to fetch snapshot", e);
      }
  };

  // Derived Temporal State
  const viewLogs = useMemo(() => {
    if (scrubIndex === null) return liveLogs;
    return liveLogs.slice(0, scrubIndex + 1);
  }, [liveLogs, scrubIndex]);

  const isTemporalActive = scrubIndex !== null && scrubIndex !== liveLogs.length - 1;

  // Reconstruct messages from viewLogs
  const temporalMessages = useMemo(() => {
    if (!isTemporalActive) return messages;
    
    // In a real system, messages would be in logs too. 
    // For this demo, we'll filter the actual messages by their timestamp against the scrubbed log's timestamp
    const scrubTimestamp = viewLogs.length > 0 ? viewLogs[viewLogs.length - 1].timestamp : Date.now();
    return messages.filter(m => m.timestamp <= scrubTimestamp);
  }, [messages, viewLogs, isTemporalActive]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [temporalMessages, processingStatus]);

  const isRequestInFlight = useRef(false);

  // Main orchestration logic
  useEffect(() => {
    if (!isProcessing || isRequestInFlight.current) return;

    const runOrchestrator = async () => {
      try {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.senderRole !== 'User') {
             // We only trigger if the last message is from User to avoid loops
             setIsProcessing(false);
             return;
        }

        isRequestInFlight.current = true;
        setProcessingStatus('Orchestrator is directing the agents...');

        const transcript = messages.map(m => `[${m.senderName}]: ${m.text}`).join('\n\n');

        const orchestratorResponse = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: transcript,
            agentDefinitions: agents,
            paradigm: paradigm,
            edges: edges
          })
        });

        if (!orchestratorResponse.ok) {
          const errData = await orchestratorResponse.json().catch(() => ({}));
          throw new Error(errData.error || 'API request failed');
        }
        const data = await orchestratorResponse.json();
        
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          senderName: 'Orchestrator',
          senderRole: 'System',
          text: data.text,
          timestamp: Date.now()
        }]);

        setProcessingStatus('Completed');

      } catch (err) {
        console.error(err);
        setProcessingStatus('An error occurred. Orchestration stopped.');
      } finally {
        setIsProcessing(false);
        isRequestInFlight.current = false;
      }
    };

    // Use a small timeout to avoid overwhelming the rendering thread
    const timerId = setTimeout(() => {
      runOrchestrator();
    }, 500);

    return () => clearTimeout(timerId);
  }, [messages, isProcessing, agents, paradigm, edges]);

  const handleSend = () => {
    if (!inputText.trim() || isProcessing) return;
    
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      senderName: 'User',
      senderRole: 'User',
      text: inputText.trim(),
      timestamp: Date.now()
    }]);
    
    setInputText('');
    setIsProcessing(true);
  };

  const handleStop = () => {
    setIsProcessing(false);
    setProcessingStatus('Stopped by user.');
  };

  const addAgent = () => {
    setAgents(prev => [...prev, {
      id: crypto.randomUUID(),
      name: 'New Agent',
      role: 'Role',
      systemInstruction: 'System prompt here...',
      avatarColor: 'bg-blue-400 shadow-[0_0_8px_currentColor]',
      llmProvider: 'auto',
      apiKeyValue: '',
      temperature: 0.7,
      capabilities: ['web_search']
    }]);
  };

  const deleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
  };

  const updateAgent = (id: string, field: keyof Agent, value: any) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const toggleCapability = (agentId: string, cap: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    const currentCaps = agent.capabilities || [];
    const newCaps = currentCaps.includes(cap) 
      ? currentCaps.filter(c => c !== cap) 
      : [...currentCaps, cap];
    updateAgent(agentId, 'capabilities', newCaps);
  };

  const exportAgents = () => {
    const dataStr = JSON.stringify(agents, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'agents_config.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importAgents = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (Array.isArray(json)) {
          setAgents(json);
        } else {
          alert('Invalid configuration format. Expected an array of agents.');
        }
      } catch (err) {
        console.error('Failed to parse config file', err);
        alert('Failed to parse configuration file.');
      }
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const applyTemplate = (templateName: string) => {
    switch(templateName) {
      case 'DEV_TEAM':
        setAgents(DEFAULT_AGENTS);
        break;
      case 'CONTENT_CRUISER':
        setAgents([
          { id: 'c1', name: 'Researcher', role: 'Data Miner', systemInstruction: 'Gather comprehensive data on the given topic from multiple perspectives.', avatarColor: 'bg-cyan-400', llmProvider: 'auto', apiKeyValue: '' },
          { id: 'c2', name: 'Writer', role: 'Copywriter', systemInstruction: 'Write engaging articles based on research data provided.', avatarColor: 'bg-orange-400', llmProvider: 'auto', apiKeyValue: '' },
          { id: 'c3', name: 'Editor', role: 'Manager', systemInstruction: 'Review and refine the content for tone and clarity.', avatarColor: 'bg-indigo-400', llmProvider: 'auto', apiKeyValue: '' }
        ]);
        break;
      case 'SECURITY_SWARM':
        setAgents([
          { id: 's1', name: 'Pentester', role: 'Vulnerability Scanner', systemInstruction: 'Identify potential security flaws in the provided code or architecture.', avatarColor: 'bg-rose-500', llmProvider: 'auto', apiKeyValue: '' },
          { id: 's2', name: 'Hardener', role: 'Security Architect', systemInstruction: 'Suggest remediation steps and infrastructure hardening strategies.', avatarColor: 'bg-slate-400', llmProvider: 'auto', apiKeyValue: '' },
          { id: 's3', name: 'Reviewer', role: 'Critic', systemInstruction: 'Strictly review the security audit and ensure no false positives.', avatarColor: 'bg-amber-500', llmProvider: 'auto', apiKeyValue: '' }
        ]);
        break;
    }
  };

  const commandActions: CommandAction[] = [
    {
      id: 'clear-chat',
      name: 'Clear Session Memory',
      category: 'Chat',
      icon: <Trash2 className="w-4 h-4" />,
      shortcut: ['Cmd', 'Shift', 'Backspace'],
      perform: () => setMessages([])
    },
    {
      id: 'stop-execution',
      name: 'Halt Execution',
      category: 'System Tasks',
      icon: <Square className="w-4 h-4" />,
      shortcut: ['Cmd', '.'],
      perform: () => handleStop()
    },
    {
      id: 'sync-present',
      name: 'Sync to Present Timeline',
      category: 'Observability',
      icon: <History className="w-4 h-4" />,
      perform: () => setScrubIndex(null)
    },
    {
      id: 'add-agent',
      name: 'Spawn New Agent',
      category: 'Agents',
      icon: <UserPlus className="w-4 h-4" />,
      perform: () => addAgent()
    },
    {
      id: 'download-logs',
      name: 'Export Session Logs',
      category: 'IO',
      icon: <Download className="w-4 h-4" />,
      perform: () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({messages, liveLogs, agents}));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", "orchestra_session_export.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
      }
    },
    {
      id: 'paradigm-graph',
      name: 'Paradigm: Graph (Visual)',
      category: 'Orchestration',
      icon: <Workflow className="w-4 h-4" />,
      perform: () => setParadigm('GRAPH')
    },
    {
      id: 'paradigm-hierarchical',
      name: 'Paradigm: Hierarchical',
      category: 'Orchestration',
      icon: <Workflow className="w-4 h-4" />,
      perform: () => setParadigm('HIERARCHICAL')
    },
    {
      id: 'paradigm-consensus',
      name: 'Paradigm: Consensus',
      category: 'Orchestration',
      icon: <Workflow className="w-4 h-4" />,
      perform: () => setParadigm('CONSENSUS')
    },
    {
      id: 'paradigm-swarm',
      name: 'Paradigm: Swarm',
      category: 'Orchestration',
      icon: <Workflow className="w-4 h-4" />,
      perform: () => setParadigm('SWARM')
    },
    {
      id: 'focus-input',
      name: 'Focus Chat Input',
      category: 'General',
      icon: <Keyboard className="w-4 h-4" />,
      shortcut: ['/'],
      perform: () => { document.querySelector<HTMLInputElement>('textarea')?.focus() }
    },
    {
      id: 'theme-ghost',
      name: 'Theme: Ghost in the Machine',
      category: 'Aesthetics',
      icon: <Sparkles className="w-4 h-4 text-slate-100" />,
      perform: () => setUiTheme('GHOST')
    },
    {
      id: 'theme-bio',
      name: 'Theme: Bio-Organic Swarm',
      category: 'Aesthetics',
      icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
      perform: () => setUiTheme('BIO')
    },
    {
      id: 'theme-default',
      name: 'Theme: Default',
      category: 'Aesthetics',
      icon: <Sparkles className="w-4 h-4 text-blue-400" />,
      perform: () => setUiTheme('DEFAULT')
    }
  ];

  return (
    <div className={cn("flex h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans relative", uiTheme === 'GHOST' && 'theme-ghost', uiTheme === 'BIO' && 'theme-bio')}>
      {uiTheme === 'GHOST' && <div className="scanline-overlay"></div>}
      <CommandPalette open={commandPaletteOpen} setOpen={setCommandPaletteOpen} actions={commandActions} />
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>
      <div className="blob blob-3"></div>
      
      {/* Sidebar: Agents Configuration */}
      <div className="w-80 glass m-4 mr-2 flex flex-col z-10 hidden md:flex">
        <div className="p-4 border-b border-white/10 sticky top-0 bg-slate-900/50 backdrop-blur-sm z-10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-400" />
              <h2 className="font-semibold text-slate-200">Swarm Agents</h2>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-slate-200 transition-colors"
                title="Import Config"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button 
                onClick={exportAgents}
                className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-slate-200 transition-colors"
                title="Export Config"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={addAgent}
                className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-slate-200 transition-colors"
                title="Add Agent"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 shrink-0">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Orchestration Strategy</label>
            <select 
              value={paradigm} 
              onChange={(e) => setParadigm(e.target.value as any)}
              className="w-full text-xs bg-black/40 border border-white/10 rounded-lg p-2 focus:ring-1 focus:ring-blue-500/50 outline-none appearance-none cursor-pointer"
            >
              <option value="GRAPH">Graph (Visual Flow)</option>
              <option value="HIERARCHICAL">Hierarchical (Leader/Follower)</option>
              <option value="CONSENSUS">Consensus (Majority Vote)</option>
              <option value="MAP_REDUCE">MapReduce (Divide & Conquer)</option>
              <option value="DEBATE">Debate (Dialectical Reasoning)</option>
              <option value="SWARM">Swarm (Parallel Execution)</option>
            </select>
            
            {(paradigm === 'GRAPH' || paradigm === 'HIERARCHICAL') && (
                <div className="mt-2 mb-2">
                    <ParadigmPlayground agents={agents} edges={edges} setEdges={setEdges} />
                </div>
            )}
          </div>
        </div>

        {/* Hidden input for loading files */}
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".json"
          onChange={importAgents}
        />
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex flex-wrap gap-1 mb-2 px-1">
             <button onClick={() => applyTemplate('DEV_TEAM')} className="text-[10px] px-2 py-0.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-full transition-colors">Dev Team</button>
             <button onClick={() => applyTemplate('CONTENT_CRUISER')} className="text-[10px] px-2 py-0.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-full transition-colors">Content</button>
             <button onClick={() => applyTemplate('SECURITY_SWARM')} className="text-[10px] px-2 py-0.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-full transition-colors">Security</button>
          </div>
          <AnimatePresence>
            {agents.map(agent => (
              <motion.div 
                key={agent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass p-3 relative group transition-colors hover:border-white/20"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", agent.avatarColor)}></div>
                    <input 
                      value={agent.name}
                      onChange={(e) => updateAgent(agent.id, 'name', e.target.value)}
                      className="font-medium bg-transparent border-none p-0 focus:ring-0 w-full text-slate-200 placeholder:text-slate-500"
                      placeholder="Agent Name"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setInspectAgentId(agent.id)}
                      title="Inspect Mental State"
                      className="p-1 text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all rounded hover:bg-white/5"
                    >
                      <Brain className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => deleteAgent(agent.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all rounded hover:bg-white/5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                
                <input 
                  value={agent.role}
                  onChange={(e) => updateAgent(agent.id, 'role', e.target.value)}
                  className="text-xs text-slate-400 bg-transparent border-none p-0 focus:ring-0 w-full mb-2 placeholder:text-slate-600"
                  placeholder="Role (e.g. Developer)"
                />
                
                <textarea 
                  value={agent.systemInstruction}
                  onChange={(e) => updateAgent(agent.id, 'systemInstruction', e.target.value)}
                  className="w-full text-xs text-slate-300 bg-black/20 border border-white/5 rounded-lg p-2 resize-none h-20 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600 mb-2"
                  placeholder="System Instruction..."
                />

                <div className="flex gap-2 mb-2">
                  <input
                    type="number"
                    value={agent.priority || ''}
                    onChange={(e) => updateAgent(agent.id, 'priority', parseInt(e.target.value) || 0)}
                    className="w-1/2 text-xs text-slate-300 bg-black/30 border border-white/10 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600"
                    placeholder="Priority (e.g. 10)"
                  />
                  <input
                    type="number"
                    value={agent.urgency || ''}
                    onChange={(e) => updateAgent(agent.id, 'urgency', parseInt(e.target.value) || 0)}
                    className="w-1/2 text-xs text-slate-300 bg-black/30 border border-white/10 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600"
                    placeholder="Urgency (e.g. 10)"
                  />
                </div>
                
                <div className="flex flex-col gap-2">
                  <input
                    type="password"
                    value={agent.apiKeyValue || ''}
                    onChange={(e) => updateAgent(agent.id, 'apiKeyValue', e.target.value)}
                    className="w-full text-xs text-slate-300 bg-black/30 border border-white/10 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600"
                    placeholder="Custom API Key (Optional)"
                  />
                  <input
                    type="text"
                    value={agent.baseURL || ''}
                    onChange={(e) => updateAgent(agent.id, 'baseURL', e.target.value)}
                    className="w-full text-xs text-slate-300 bg-black/30 border border-white/10 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600"
                    placeholder="Custom Base URL (vLLM, OpenRouter, etc.)"
                  />
                  <input
                    type="text"
                    value={agent.modelName || ''}
                    onChange={(e) => updateAgent(agent.id, 'modelName', e.target.value)}
                    className="w-full text-xs text-slate-300 bg-black/30 border border-white/10 rounded-md p-1.5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder:text-slate-600"
                    placeholder="Specific Model Name (e.g. gpt-4o, claude-3-5-sonnet)"
                  />
                </div>

                {/* Advanced Controls */}
                <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                   <div className="flex justify-between items-center">
                     <span className="text-[10px] text-slate-500 uppercase font-bold">Temperature</span>
                     <span className="text-[10px] text-blue-400 font-mono">{(agent.temperature || 0.7).toFixed(1)}</span>
                   </div>
                   <input 
                     type="range" min="0" max="1" step="0.1" 
                     value={agent.temperature || 0.7}
                     onChange={(e) => updateAgent(agent.id, 'temperature', parseFloat(e.target.value))}
                     className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                   />

                   <div className="space-y-1">
                     <span className="text-[10px] text-slate-500 uppercase font-bold">Capabilities</span>
                     <div className="flex flex-wrap gap-1">
                        {['web_search', 'code_interpreter', 'tool_escalation'].map(cap => (
                          <button
                            key={cap}
                            onClick={() => toggleCapability(agent.id, cap)}
                            className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded border transition-all",
                              agent.capabilities?.includes(cap) 
                                ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                : "bg-black/20 border-white/5 text-slate-600 hover:text-slate-400"
                            )}
                          >
                            {cap.replace('_', ' ')}
                          </button>
                        ))}
                     </div>
                   </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
          "flex-1 flex flex-col m-4 ml-2 glass relative overflow-hidden z-10 transition-all duration-700",
          isTemporalActive && "scale-[0.99] border-amber-500/30 shadow-[0_0_40px_rgba(245,158,11,0.1)]"
      )}>
        {isTemporalActive && (
          <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
             <div className="absolute inset-0 bg-amber-500/5 backdrop-sepia-[0.3]"></div>
             <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] bg-[length:100%_2px,3px_100%] animate-scanline"></div>
          </div>
        )}
        
        {/* Observability Studio Panel */}
        <TelemetryStudio liveLogs={viewLogs} handleTimeTravelClick={handleTimeTravelClick} agents={agents} />

        {/* Human-in-the-Loop Modal */}
        <AnimatePresence>
            {pendingApproval && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="w-full max-w-md bg-slate-900 border border-green-500/50 rounded-xl shadow-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" />
                        <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                           <ShieldAlert className="w-5 h-5 text-yellow-400" />
                           Human Intervention Required
                        </h3>
                        <p className="text-sm text-slate-400 mt-2 mb-4">
                           Agent <strong className="text-slate-200">{pendingApproval.sourceAgentId}</strong> has hit a systemic guardrail or missing context.
                        </p>
                        
                        <div className="bg-black/30 p-3 rounded-lg border border-white/5 mb-4 text-sm font-mono text-slate-300">
                           {pendingApproval.payload.context?.requestedToolName && (
                             <div className="mb-2 pb-2 border-b border-white/5">
                                <span className="text-blue-400 font-bold uppercase text-[10px] block mb-1">Requested Tool</span>
                                <code className="text-emerald-400">{pendingApproval.payload.context.requestedToolName}</code>
                             </div>
                           )}
                           {pendingApproval.payload.context?.justification && (
                             <div className="mb-2 pb-2 border-b border-white/5">
                                <span className="text-blue-400 font-bold uppercase text-[10px] block mb-1">Justification</span>
                                <p className="text-slate-300 not-italic font-sans leading-relaxed">{pendingApproval.payload.context.justification}</p>
                             </div>
                           )}
                           <span className="text-blue-400 font-bold uppercase text-[10px] block mb-1">System Message</span>
                           {pendingApproval.payload.actionDescription}
                        </div>
                        
                        <textarea 
                           id="feedbackInput"
                           placeholder="Optional feedback or context for the agent..." 
                           className="w-full mb-4 bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 min-h-[80px]"
                        />

                        <div className="flex flex-col gap-2">
                            <button onClick={() => {
                                const feedback = (document.getElementById('feedbackInput') as HTMLTextAreaElement)?.value;
                                handleApprovalResponse('APPROVED', feedback);
                            }} className="w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 font-medium rounded-lg transition-colors border border-emerald-500/30">
                                Approve Action
                            </button>
                            <button onClick={() => {
                                const feedback = (document.getElementById('feedbackInput') as HTMLTextAreaElement)?.value;
                                handleApprovalResponse('MODIFIED', feedback);
                            }} className="w-full py-2 bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 font-medium rounded-lg transition-colors border border-yellow-500/30">
                                Submit Feedback & Retry
                            </button>
                            <button onClick={() => handleApprovalResponse('REJECTED')} className="w-full py-2 bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 font-medium rounded-lg transition-colors border border-rose-500/30">
                                Reject & Terminate
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        {/* Time-Travel Snapshot Modal */}
        <AnimatePresence>
            {timeTravelSnapshot && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
                      <div className="w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-teal-500/50 flex flex-col rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(20,184,166,0.2)] relative">
                          <div className="p-4 border-b border-white/10 bg-black/40 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="p-2 bg-teal-500/10 rounded-lg">
                                      <Settings className="w-5 h-5 text-teal-400 animate-spin-slow"/>
                                  </div>
                                  <div>
                                      <h3 className="text-lg font-bold text-teal-400 tracking-tight">
                                          Quantum Time-Travel Debugger
                                      </h3>
                                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                                          Snapshot T-{timeTravelSnapshot.logItem.timestamp} | Thread: {timeTravelSnapshot.logItem.threadId.substring(0,8)}
                                      </p>
                                  </div>
                              </div>
                              <button onClick={() => setTimeTravelSnapshot(null)} className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg transition-all border border-white/10 text-xs font-bold uppercase tracking-widest">Close Nexus</button>
                          </div>
                          
                          <div className="flex flex-1 overflow-hidden">
                              {/* Left Pane: Event Trace */}
                              <div className="w-1/3 border-r border-white/10 flex flex-col bg-black/20">
                                  <div className="p-3 bg-white/5 border-b border-white/5">
                                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Causal Event Trace</h4>
                                  </div>
                                  <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                      {timeTravelSnapshot.snapshot.map((ev: any, idx: number) => (
                                          <div key={idx} className={cn(
                                              "p-2 rounded border transition-all text-[10px] font-mono",
                                              ev.timestamp === timeTravelSnapshot.logItem.timestamp 
                                                ? "bg-teal-500/10 border-teal-500/30 text-teal-300 shadow-[0_0_10px_rgba(20,184,166,0.1)]" 
                                                : "bg-slate-800/30 border-white/5 text-slate-500 opacity-60"
                                          )}>
                                              <div className="flex justify-between items-center mb-1">
                                                  <span className="font-bold">[{ev.type}]</span>
                                                  <span className="text-[8px] opacity-50">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                              </div>
                                              <div className="truncate opacity-80">{ev.sourceAgentId}</div>
                                              {ev.payload?.action && <div className="text-[8px] mt-1 text-slate-400 italic">{'->'} {ev.payload.action}</div>}
                                          </div>
                                      ))}
                                  </div>
                              </div>

                              {/* Middle Pane: Inspector */}
                              <div className="flex-1 flex flex-col overflow-hidden">
                                  <div className="p-3 bg-white/5 border-b border-white/5 flex gap-4">
                                      <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Active Inspector: {timeTravelSnapshot.logItem.type}</h4>
                                  </div>
                                  <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-8">
                                      {/* Primary Event Source */}
                                      <section>
                                          <div className="flex items-center gap-2 mb-3">
                                              <Terminal className="w-3.5 h-3.5 text-teal-500" />
                                              <h5 className="text-xs font-bold text-slate-300">Raw Telemetry Node</h5>
                                          </div>
                                          <div className="relative group">
                                              <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500/20 to-blue-500/20 rounded-xl blur opacity-30 group-hover:opacity-50 transition duration-1000"></div>
                                              <pre className="relative text-[11px] text-teal-100/90 font-mono bg-black/60 p-5 rounded-xl border border-white/10 overflow-x-auto leading-relaxed scrollbar-hide">
                                                  {JSON.stringify(timeTravelSnapshot.logItem, null, 2)}
                                              </pre>
                                          </div>
                                      </section>

                                      {/* Reconstructed State Visualization */}
                                      <section>
                                          <div className="flex items-center gap-2 mb-3">
                                              <Database className="w-3.5 h-3.5 text-blue-500" />
                                              <h5 className="text-xs font-bold text-slate-300">Reconstructed Blackboard State</h5>
                                          </div>
                                          <div className="bg-black/40 border border-white/5 rounded-xl p-4">
                                              {(() => {
                                                  const latestBlackboard = [...timeTravelSnapshot.snapshot].reverse().find(e => e.payload?.blackboard)?.payload?.blackboard;
                                                  if (!latestBlackboard) return <div className="text-xs text-slate-600 italic">No shared state metadata available at this nexus point.</div>;
                                                  
                                                  return (
                                                      <div className="grid grid-cols-2 gap-3">
                                                          {Object.entries(latestBlackboard).map(([key, value]: [string, any]) => (
                                                              <div key={key} className="bg-white/5 p-2 rounded border border-white/5 flex flex-col gap-1">
                                                                  <span className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter">{key}</span>
                                                                  <div className="text-[11px] text-slate-300 font-mono break-all max-h-20 overflow-y-auto">
                                                                      {typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value)}
                                                                  </div>
                                                              </div>
                                                          ))}
                                                      </div>
                                                  );
                                              })()}
                                          </div>
                                      </section>

                                      {/* Agent Mentality Snapshot */}
                                      <section>
                                          <div className="flex items-center gap-2 mb-3">
                                              <Bot className="w-3.5 h-3.5 text-indigo-500" />
                                              <h5 className="text-xs font-bold text-slate-300">Swarm Evolution (Active Invariant Patches)</h5>
                                          </div>
                                          <div className="bg-black/40 border border-white/5 rounded-xl p-4 space-y-2">
                                              {(() => {
                                                  const patches = timeTravelSnapshot.snapshot.filter((e: any) => e.payload?.action === 'INSTRUCTION_MUTATED');
                                                  if (patches.length === 0) return <div className="text-xs text-slate-600 italic">No agentic self-evolution detected prior to this event.</div>;
                                                  
                                                  return patches.map((p: any, i: number) => (
                                                      <div key={i} className="text-[10px] bg-indigo-500/10 p-2 rounded border border-indigo-500/20 text-indigo-200 italic border-l-2 border-l-indigo-500">
                                                          "{p.payload.patch}"
                                                          <div className="mt-1 text-[8px] text-slate-600 not-italic uppercase font-bold tracking-tighter">— Applied to {p.targetAgentId}</div>
                                                      </div>
                                                  ));
                                              })()}
                                          </div>
                                      </section>
                                  </div>
                              </div>
                          </div>

                          <div className="p-3 border-t border-white/10 bg-black/40 flex justify-between items-center">
                              <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Orchestra Dimension 09: Temporal Inspection Protocol Active</span>
                              <div className="flex gap-2">
                                  {/* Future feature: Step forward/backward */}
                                  <button disabled className="text-[9px] px-2 py-1 bg-white/5 text-slate-600 rounded opacity-50">Step Backward</button>
                                  <button disabled className="text-[9px] px-2 py-1 bg-white/5 text-slate-600 rounded opacity-50">Step Forward</button>
                              </div>
                          </div>
                      </div>
                </motion.div>
            )}
        </AnimatePresence>

        {/* Header */}
        <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 z-10 bg-black/10">
          <h1 
            className={cn("font-semibold text-lg flex items-center gap-2 text-slate-200", uiTheme === 'GHOST' && 'glitch-text')} 
            data-text="Orchestra"
          >
            <Sparkles className="w-5 h-5 text-blue-400" />
            Orchestra
          </h1>
          <div className="flex items-center gap-3">
            {isProcessing && (
              <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full animate-pulse border border-emerald-500/20 flex gap-2 items-center">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                {processingStatus}
              </span>
            )}
            {isProcessing ? (
               <button 
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium transition-colors"
               >
                 <Square className="w-4 h-4" fill="currentColor" />
                 Stop
               </button>
            ) : null}
          </div>
        </header>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {temporalMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <Bot className="w-16 h-16 text-slate-700 mb-4" />
              <p className="text-lg font-medium text-slate-400">Welcome to Orchestra</p>
              <p className="text-sm max-w-sm text-center mt-2">
                Define your multi-agent swarm on the left, then give them a task below. The Manager will automatically route the conversation.
              </p>
            </div>
          ) : (
            temporalMessages.map((msg, idx) => {
              const isUser = msg.senderRole === 'User';
              const isSystem = msg.senderRole === 'System';
              const agent = agents.find(a => a.name === msg.senderName);
              
              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center my-4">
                    <span className="bg-black/30 border border-white/10 text-slate-400 text-xs px-3 py-1 rounded-full">
                      {msg.text}
                    </span>
                  </div>
                );
              }
              
              return (
                <motion.div 
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex", isUser ? "justify-end" : "justify-start")}
                >
                  <div className={cn(
                    "max-w-2xl flex flex-col gap-1",
                    isUser ? "items-end" : "items-start"
                  )}>
                    <div className="flex items-center gap-2 px-1">
                      {!isUser && agent && (
                        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", agent.avatarColor)}></div>
                      )}
                      <span className="text-xs font-semibold text-slate-400">
                        {msg.senderName} {agent ? `(${agent.role})` : ''}
                      </span>
                    </div>
                    
                    <div className={cn(
                      "px-5 py-3.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed glass border-white/10",
                      isUser 
                        ? "bg-blue-600/20 text-blue-100 rounded-tr-none border-blue-500/30" 
                        : "bg-white/5 text-slate-200 rounded-tl-none opacity-90"
                    )}>
                      {msg.text}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}

          {/* Active Streaming Thoughts */}
          <AnimatePresence>
            {Object.entries(activeThoughts).map(([agentId, text]) => {
              const agent = agents.find(a => a.id === agentId) || agents.find(a => a.name === agentId);
              if (!text) return null;
              return (
                <motion.div 
                  key={`thought-${agentId}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start mb-4"
                >
                  <div className="max-w-xl flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-2 px-1">
                      <div className={cn("w-2 h-2 rounded-full animate-pulse", agent?.avatarColor || 'bg-slate-400')}></div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {agent?.name || 'Agent'} Thinking...
                      </span>
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl text-xs bg-white/5 border border-white/5 text-slate-400 italic">
                      {text}...
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {Object.entries(healingAgents).map(([agentId, status]) => {
              const agent = agents.find(a => a.id === agentId) || agents.find(a => a.name === agentId);
              return (
                <motion.div 
                  key={`healing-${agentId}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start mb-4"
                >
                  <div className="max-w-xl flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                        {agent?.name || 'Agent'} HEALING: {status}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                      Workflow suspended for auto-reflection. Agent is re-evaluating strategy...
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {systemErrors.map((err, i) => (
              <motion.div 
                key={`error-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-2 p-6 mb-4 bg-rose-500/10 border border-rose-500/20 rounded-3xl"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-rose-500/20 rounded-full">
                      <AlertCircle className="w-5 h-5 text-rose-500" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-rose-400">NEURAL_CIRCUIT_FAULT: {err.code}</h4>
                      <p className="text-[10px] text-rose-500/70 uppercase tracking-widest font-mono">{err.context.timestamp}</p>
                    </div>
                  </div>
                  <div className="text-[10px] bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 text-rose-300 font-mono">
                    AGENT: {err.context.agentId || 'ORCHESTRATOR'}
                  </div>
                </div>
                
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                  <div className="flex items-start gap-2">
                    <Terminal className="w-3 h-3 text-slate-500 mt-1 shrink-0" />
                    <p className="text-xs text-slate-300 font-mono leading-relaxed">
                      {err.message}
                    </p>
                  </div>
                  {err.stack && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                       <details className="cursor-pointer group">
                         <summary className="text-[9px] text-slate-500 hover:text-slate-300 uppercase font-bold transition-colors">View Neural Stack Trace</summary>
                         <pre className="mt-2 p-3 bg-black/60 rounded text-[10px] text-slate-500 overflow-x-auto custom-scrollbar font-mono">
                           {err.stack}
                         </pre>
                       </details>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2">
                   <button 
                    onClick={() => setSystemErrors(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-[10px] px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-full border border-rose-500/20 transition-all font-bold"
                   >
                     ACKNOWLEDGE FAULT
                   </button>
                   <button 
                    onClick={handleSend}
                    className="text-[10px] px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-full border border-blue-500/20 transition-all font-bold"
                   >
                     RE-EXECUTE WORKFLOW
                   </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          <div ref={endOfMessagesRef} className="h-4" />
        </div>

        {/* Input Area */}
        <div className="p-4 w-full mx-auto pb-8 z-10 border-t border-white/10 bg-black/20 backdrop-blur-sm">
          
          <div className="max-w-4xl mx-auto mb-3 flex flex-wrap gap-2">
            <span className="text-xs text-slate-400 font-medium mr-2 flex items-center">
              <Sparkles className="w-3 h-3 mr-1" /> Templates:
            </span>
            <button
              onClick={() => setInputText("Design a scalable SaaS architecture for a B2B platform.\n\n1. Purpose: [Insert Purpose]\n2. Users: [Insert Users]\n3. Features: [Insert Features]\n4. Constraints: [Insert Constraints]")}
              className="px-2 py-1 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-[10px] rounded transition-colors"
            >
              System Design
            </button>
            <button
              onClick={() => setInputText("Refactor the provided codebase to improve maintainability.\n\nKey areas to focus on:\n- Error handling\n- Separation of concerns\n- Testability")}
              className="px-2 py-1 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-[10px] rounded transition-colors"
            >
              Code Refactor
            </button>
            <button
              onClick={() => setInputText("Draft a comprehensive security audit report.\n\nScope:\n- Authentication boundaries\n- Data at rest encryption\n- External API integrations")}
              className="px-2 py-1 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-[10px] rounded transition-colors"
            >
              Security Audit
            </button>
          </div>

          <div className="relative flex items-center glass p-1 border-white/10 rounded-2xl max-w-4xl mx-auto">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isProcessing ? "Agents are working..." : "Give your agents a task (e.g., 'Write a python script to...')"}
              disabled={isProcessing}
              className="w-full bg-transparent border-none rounded-xl pl-4 pr-14 py-3.5 focus:outline-none focus:ring-0 resize-none max-h-32 text-sm text-slate-200 placeholder:text-slate-500 disabled:opacity-50"
              rows={2}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isProcessing}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-[0_0_12px_rgba(37,99,235,0.4)]"
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
          </div>
          <div className="text-center mt-3 max-w-4xl mx-auto flex items-center justify-center gap-4">
             <span className="text-xs text-slate-500">Shift + Enter for new line</span>
             <span className="text-xs text-slate-500"><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono text-[10px]">Cmd</kbd> + <kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono text-[10px]">K</kbd> for Command Palette</span>
          </div>
        </div>
        {/* Global Temporal Timeline */}
        <AnimatePresence>
            {liveLogs.length > 0 && (
                <motion.div 
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] max-w-5xl z-[60] px-6 py-3 glass border-white/5 flex flex-col gap-2 group transition-all hover:bg-black/60"
                >
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "p-2 rounded-lg transition-colors",
                                isTemporalActive ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/10 text-blue-400"
                            )}>
                                <History className="w-4 h-4" />
                            </div>
                            <div>
                                <h4 className={cn(
                                    "text-xs font-bold uppercase tracking-widest",
                                    isTemporalActive ? "text-amber-400" : "text-blue-400"
                                )}>
                                    {isTemporalActive ? 'Temporal Rewind Active' : 'Real-time Synchronized'}
                                </h4>
                                <p className="text-[10px] text-slate-500 font-mono">
                                    {isTemporalActive ? `Viewing Event ${scrubIndex! + 1} of ${liveLogs.length}` : `System Live @ ${new Date(liveLogs[liveLogs.length-1].timestamp).toLocaleTimeString()}`}
                                </p>
                            </div>
                        </div>
                        
                        {isTemporalActive && (
                            <button 
                                onClick={() => setScrubIndex(liveLogs.length - 1)}
                                className="px-3 py-1 bg-amber-500 text-black text-[10px] font-bold uppercase rounded-full hover:bg-amber-400 transition-colors shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                            >
                                Re-sync to Present
                            </button>
                        )}
                    </div>

                    <div className="relative pt-2 pb-4">
                        <input 
                            type="range"
                            min="0"
                            max={liveLogs.length - 1}
                            value={scrubIndex ?? liveLogs.length - 1}
                            onChange={(e) => setScrubIndex(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-amber-500 group-hover:h-2 transition-all outline-none"
                        />
                        <div className="flex justify-between mt-2 overflow-hidden px-1 pointer-events-none">
                            {liveLogs.filter((_, i) => i % Math.max(1, Math.floor(liveLogs.length/10)) === 0).map((log, i) => (
                                <div key={i} className="flex flex-col items-center gap-1">
                                    <div className="w-[1px] h-1.5 bg-white/10"></div>
                                    <span className="text-[8px] text-slate-600 font-mono">{new Date(log.timestamp).toLocaleTimeString([], {minute:'2-digit', second:'2-digit'})}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
      </div>
      
      {/* Agent Mental State Inspector */}
      {inspectAgentId && (
        <AgentInspectorPane 
          agentId={inspectAgentId} 
          onClose={() => setInspectAgentId(null)} 
        />
      )}
    </div>
  );
}
