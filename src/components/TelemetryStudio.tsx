import { useMemo } from 'react';
import { Settings, Play, Square, UserPlus, Trash2, Bot, CircleUserRound, Sparkles, ShieldAlert, Activity, Network, Database, ArrowRight, DollarSign, ZapOff, Clock, Hammer, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import { NeuralMesh } from './NeuralMesh';

export function TelemetryStudio({ liveLogs, handleTimeTravelClick, agents }) {
    
    // Parse Token Usage
    const tokenData = useMemo(() => {
        const usage = {};
        liveLogs.forEach(log => {
            if (log.payload?.tokenUsage || (log.payload?.action === 'TELEMETRY_LOG' && log.payload?.tokenUsage)) {
                const t = log.payload.tokenUsage;
                usage[log.sourceAgentId] = (usage[log.sourceAgentId] || 0) + (t.promptTokens || 0) + (t.completionTokens || 0);
            }
        });
        return Object.entries(usage).map(([name, tokens]) => ({ name, tokens }));
    }, [liveLogs]);

    // Parse execution times over time
    const executionTimeData = useMemo(() => {
        return liveLogs
            .filter(log => log.payload?.action === 'AGENT_EXECUTION_COMPLETED')
            .map(log => ({
                time: new Date(log.timestamp).toLocaleTimeString([], { hour12: false, minute:'2-digit', second:'2-digit' }),
                duration: log.payload.duration,
                agent: log.sourceAgentId
            }))
            .slice(-20);
    }, [liveLogs]);

    // Parse Tool Invocations
    const toolUsageData = useMemo(() => {
        const tools = {};
        liveLogs.forEach(log => {
            if (log.payload?.action === 'TOOL_INVOKED') {
                const name = log.payload.toolName;
                tools[name] = (tools[name] || 0) + 1;
            }
        });
        return Object.entries(tools).map(([name, count]) => ({ name, count }));
    }, [liveLogs]);

    // Human Intervention Stats
    const humanStats = useMemo(() => {
        const interventions = liveLogs.filter(log => 
            log.payload?.action === 'WORKFLOW_SUSPENDED' || 
            log.type === 'HUMAN_INTERVENTION_REQUIRED' ||
            log.payload?.action === 'HUMAN_INTERVENTION_REQUIRED'
        );
        return {
            count: interventions.length,
            recent: interventions.slice(-3).reverse().map(i => ({
                agent: i.sourceAgentId,
                reason: i.payload?.reason || i.payload?.message || 'Verification required',
                time: i.timestamp
            }))
        };
    }, [liveLogs]);

    // Parse estimated cost
    const costData = useMemo(() => {
        const costs: Record<string, number> = {};
        liveLogs.forEach(log => {
            let cost = 0;
            if (log.payload?.cost) {
                cost = log.payload.cost;
            } else if (log.payload?.tokenUsage || (log.payload?.action === 'TELEMETRY_LOG' && log.payload?.tokenUsage)) {
                // Fallback hardcoded if missing
                const t = log.payload.tokenUsage || log.payload?.tokenUsage;
                cost = ((t.promptTokens || 0) / 1000000) * 2.50 + ((t.completionTokens || 0) / 1000000) * 10.00;
            }
            if (cost > 0) {
                costs[log.sourceAgentId] = (costs[log.sourceAgentId] || 0) + cost;
            }
        });
        return Object.entries(costs).map(([name, value]) => ({ name, value: Number(value.toFixed(4)) })).filter(d => d.value > 0);
    }, [liveLogs]);

    // Parse Blackboard state
    const blackboardState = useMemo(() => {
        const lastBlackboardEvent = [...liveLogs].reverse().find(log => log.payload?.blackboard);
        return lastBlackboardEvent?.payload?.blackboard || {};
    }, [liveLogs]);

    const healingStats = useMemo(() => {
        let total = 0;
        const perAgent = {};
        const faults = [];
        liveLogs.forEach(log => {
            if (log.payload?.action === 'SELF_HEALING_START') {
               total++;
               perAgent[log.sourceAgentId] = (perAgent[log.sourceAgentId] || 0) + 1;
            }
            if (log.payload?.action === 'DIAGNOSTIC_ALERT') {
                faults.push({
                    agent: log.sourceAgentId,
                    code: log.payload.error?.code,
                    msg: log.payload.error?.message,
                    time: log.payload.error?.context?.timestamp
                });
            }
        });
        return { total, perAgent, recentFaults: faults.slice(-5).reverse() };
    }, [liveLogs]);

    const wisdomStats = useMemo(() => {
        const distilledRules = liveLogs.filter(log => log.payload?.action === 'WISDOM_DISTILLED');
        return distilledRules.map(log => ({
            rule: log.payload.rule,
            time: log.timestamp
        })).reverse();
    }, [liveLogs]);

    const isSimulationMode = useMemo(() => {
        // Since we can't easily check SimulationManager.isActive() from client if it's purely server-side state,
        // we look for simulation indicators in logs. 
        // In this architecture, we'll assume simulation if logs contain [SIMULATED_LOGIC] or similar.
        return liveLogs.some(log => 
            (log.payload?.text && log.payload.text.includes('[SIMULATED')) ||
            (log.payload?.action === 'TELEMETRY_LOG' && log.payload?.text?.includes('[SIMULATED'))
        );
    }, [liveLogs]);

    const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

    // Parse Interaction Graph (Sequence of unique recent hops)
    const agentSequence = useMemo(() => {
        const seq = [];
        liveLogs.forEach(log => {
            if (log.sourceAgentId && log.sourceAgentId !== 'SYSTEM' && log.sourceAgentId !== 'FINOPS_ENGINE' && log.sourceAgentId !== 'MOA_ROUTER' && log.sourceAgentId !== 'XAI_ENGINE') {
                if (seq.length === 0 || seq[seq.length - 1] !== log.sourceAgentId) {
                    seq.push(log.sourceAgentId);
                }
            }
        });
        return seq.slice(-8); // keep last 8 hops
    }, [liveLogs]);

    return (
        <div className="absolute top-16 right-6 bottom-6 w-96 glass flex flex-col z-20 transition-all duration-300 border border-white/10 shadow-2xl backdrop-blur-md hidden xl:flex overflow-hidden rounded-xl bg-slate-900/80 font-sans">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/40 shrink-0">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs uppercase font-bold tracking-widest text-slate-300">Observability Studio</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_currentColor]"></div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
                {/* 1. Agent Interaction Graph */}
                <div className="p-4 border-b border-white/10 bg-gradient-to-b from-black/20 to-transparent">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-4 flex items-center gap-1.5"><Network className="w-3 h-3"/> Active Topology</h3>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                        {agentSequence.length === 0 ? (
                            <span className="text-xs text-slate-500 italic">No agent activity yet...</span>
                        ) : (
                            agentSequence.map((agent, i) => (
                                <div key={`${agent}-${i}`} className="flex items-center gap-3">
                                    <motion.div 
                                      initial={{ scale: 0.8, opacity: 0 }} 
                                      animate={{ scale: 1, opacity: 1 }}
                                      className="px-3 py-1.5 text-[10px] font-bold rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 whitespace-nowrap shadow-[0_0_10px_rgba(99,102,241,0.1)] flex items-center gap-2"
                                    >
                                        <Bot className="w-3 h-3 opacity-70" />
                                        {agent}
                                    </motion.div>
                                    {i < agentSequence.length - 1 && (
                                        <motion.div
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.1 }}
                                        >
                                            <ArrowRight className="w-4 h-4 text-slate-600" />
                                        </motion.div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 1.5 Shared Blackboard Visualization */}
                <div className="p-4 border-b border-white/10 bg-black/10 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-2 flex items-center gap-1.5"><Database className="w-3 h-3"/> Shared Blackboard (WASM/IPC)</h3>
                    {Object.keys(blackboardState).length > 0 ? (
                        <div className="max-h-24 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                           {Object.entries(blackboardState).map(([key, val]) => (
                               <div key={key} className="flex justify-between items-center text-[10px] bg-black/40 p-1.5 rounded border border-white/5">
                                   <span className="text-blue-400 font-mono">{key}:</span>
                                   <span className="text-slate-300 truncate max-w-[200px]">{JSON.stringify(val)}</span>
                               </div>
                           ))}
                        </div>
                    ) : (
                        <span className="text-[10px] text-zinc-600 italic">No shared data serialized...</span>
                    )}
                </div>

                {/* 1.6 Self-Healing Insights */}
                <div className="p-4 border-b border-white/10 bg-amber-500/5 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-2 flex items-center gap-1.5 text-amber-500/80"><ShieldAlert className="w-3 h-3"/> Self-Healing Insights</h3>
                    <div className="flex gap-4 items-center">
                        <div className="flex flex-col">
                            <span className="text-xl font-bold text-amber-400 font-mono">{healingStats.total}</span>
                            <span className="text-[8px] text-slate-500 uppercase tracking-tighter">Total Rescues</span>
                        </div>
                        <div className="flex-1 flex gap-1 overflow-x-auto pb-1 custom-scrollbar">
                            {Object.entries(healingStats.perAgent).map(([agent, count]) => (
                                <div key={agent} className="flex flex-col items-center bg-black/40 px-2 py-1 rounded border border-amber-500/10 min-w-[50px]">
                                    <span className="text-amber-500 font-mono text-[10px]">{count}</span>
                                    <span className="text-[7px] text-slate-500 truncate w-full text-center">{agent}</span>
                                </div>
                            ))}
                            {healingStats.total === 0 && <span className="text-[9px] text-slate-600 italic">No healing events detected</span>}
                        </div>
                    </div>
                </div>

                {/* 1.6.5 Fault Diagnostic Log */}
                <div className="p-4 border-b border-white/10 bg-rose-500/5 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-2 flex items-center gap-1.5 text-rose-500/80"><ZapOff className="w-3 h-3"/> Neural Fault log</h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                        {healingStats.recentFaults.map((f, i) => (
                            <div key={i} className="text-[9px] bg-black/40 p-1.5 rounded border border-rose-500/10 flex flex-col gap-0.5">
                                <div className="flex justify-between items-center whitespace-nowrap">
                                    <span className="text-rose-400 font-bold tracking-tight uppercase truncate max-w-[120px]">{f.code}</span>
                                    <span className="text-[8px] text-slate-600 font-mono italic">@{new Date(f.time).toLocaleTimeString([], { hour12: false, minute:'2-digit', second:'2-digit' })}</span>
                                </div>
                                <span className="text-slate-500 line-clamp-2 leading-tight">{f.msg}</span>
                                <div className="flex items-center gap-1 mt-1 font-mono text-[7px] text-rose-500/60 uppercase">
                                    <span className="bg-rose-500/10 px-1 rounded">AGENT: {f.agent}</span>
                                </div>
                            </div>
                        ))}
                        {healingStats.recentFaults.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-4 text-slate-600 italic">
                                <Activity className="w-4 h-4 mb-1 opacity-20" />
                                <span className="text-[9px]">Neural network healthy</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 1.6.5 Wisdom Engine (Evolution) */}
                <div className="p-4 border-b border-white/10 bg-indigo-500/5 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-2 flex items-center gap-1.5 text-indigo-500/80"><Sparkles className="w-3 h-3"/> Autonomous Wisdom Engine</h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                        {wisdomStats.map((w, i) => (
                            <motion.div 
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                key={i} 
                                className="text-[9px] bg-indigo-500/10 p-2 rounded border border-indigo-500/20 flex flex-col gap-1 border-l-2 border-l-indigo-400"
                            >
                                <span className="text-indigo-300 leading-snug italic">"{w.rule}"</span>
                                <span className="text-[7px] text-slate-600 font-mono text-right uppercase tracking-tighter">Distilled Wisdom @ {new Date(w.time).toLocaleTimeString()}</span>
                            </motion.div>
                        ))}
                        {wisdomStats.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-4 text-slate-600 italic">
                                <Bot className="w-4 h-4 mb-1 opacity-20" />
                                <span className="text-[9px]">Evolving policy base...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 1.7 Neural Swarm Topology (Vis) */}
                <div className="p-4 border-b border-white/10 bg-black/5 shrink-0 h-72">
                    <NeuralMesh liveLogs={liveLogs} agents={agents} />
                </div>

                {/* 2. Compute & Performance */}
                <div className="p-4 border-b border-white/10 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-4"><Clock className="w-3 h-3"/> Neural compute Latency (ms)</h3>
                    <div className="h-32 mb-4">
                        {executionTimeData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={executionTimeData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorDuration" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="time" hide />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 8 }} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '10px' }}
                                    />
                                    <Area type="monotone" dataKey="duration" stroke="#3b82f6" fillOpacity={1} fill="url(#colorDuration)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center border border-dashed border-white/5 rounded-lg">
                                <span className="text-[9px] text-slate-600 font-mono">Calibrating synaptic latency...</span>
                            </div>
                        )}
                    </div>

                    <h3 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-2"><Database className="w-3 h-3"/> Token Usage / Agent</h3>
                    <div className="h-32">
                        {tokenData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={tokenData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 8 }} axisLine={false} tickLine={false} hide />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 8 }} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '10px' }} 
                                    />
                                    <Bar dataKey="tokens" fill="#8b5cf6" radius={[2, 2, 0, 0]} barSize={15} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center">
                                <span className="text-[9px] text-slate-600">Waiting for LLM generation...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2.2 Tool Analytics */}
                <div className="p-4 border-b border-white/10 bg-black/10 shrink-0">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-3 flex items-center gap-1.5"><Hammer className="w-3 h-3"/> Decentralized Tool Utility</h3>
                    <div className="h-28">
                        {toolUsageData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={toolUsageData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 7 }} width={60} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '9px' }}
                                    />
                                    <Bar dataKey="count" fill="#4ade80" radius={[0, 2, 2, 0]} barSize={10} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center border border-dashed border-white/5 rounded-lg">
                                <Hammer className="w-4 h-4 mb-2 opacity-20 text-slate-400" />
                                <span className="text-[8px] text-slate-600 uppercase">Awaiting tool executions</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2.3 Human Intervention Required */}
                <div className="p-4 border-b border-white/10 bg-indigo-500/5 shrink-0">
                    <div className="flex justify-between items-center mb-3">
                         <h3 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5 text-indigo-400"><UserCheck className="w-3 h-3"/> Governance: Human Oversight</h3>
                         <span className="text-[10px] font-bold text-indigo-300 bg-indigo-500/20 px-1.5 rounded">{humanStats.count}</span>
                    </div>
                    <div className="space-y-2">
                        {humanStats.recent.map((h, i) => (
                            <div key={i} className="text-[9px] bg-indigo-500/10 p-2 rounded border border-indigo-500/20 flex flex-col gap-1 border-l-2 border-l-indigo-400">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-indigo-300 uppercase tracking-tighter">Nexus Verification</span>
                                    <span className="text-[7px] text-slate-600 font-mono">@{new Date(h.time).toLocaleTimeString()}</span>
                                </div>
                                <span className="text-slate-400 leading-snug truncate">Agent: {h.agent}</span>
                                <span className="text-indigo-200 line-clamp-2 italic">"{h.reason}"</span>
                            </div>
                        ))}
                        {humanStats.count === 0 && (
                            <div className="flex flex-col items-center justify-center py-4 bg-black/20 rounded-lg border border-dashed border-white/5">
                                <ShieldAlert className="w-4 h-4 mb-1 opacity-20 text-slate-400" />
                                <span className="text-[8px] text-slate-600 uppercase">Fully Autonomous State</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2.5 Estimated Cost Chart */}
                <div className="p-4 border-b border-white/10 h-40 shrink-0 flex items-center bg-black/10">
                    <div className="w-1/2 flex flex-col items-start justify-center">
                        <h3 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-2"><DollarSign className="w-3 h-3"/> Estimated Cost</h3>
                         <span className="text-2xl font-bold text-emerald-400 font-mono tracking-tighter">
                             ${costData.reduce((acc, curr) => acc + curr.value, 0).toFixed(4)}
                         </span>
                         <span className="text-[9px] text-slate-500 mt-1">SaaS Model Compute Spend</span>
                    </div>
                    <div className="w-1/2 h-full">
                    {costData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={costData} innerRadius={25} outerRadius={40} paddingAngle={3} dataKey="value" stroke="none">
                                    {costData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    formatter={(value) => `$${value}`}
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px' }} 
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center">
                            <span className="text-[9px] text-slate-600 italic">No cost data</span>
                        </div>
                    )}
                    </div>
                </div>

                {/* 3. Event Stream */}
                <div className="p-4 flex-1 flex flex-col min-h-[300px]">
                    <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-3 flex items-center gap-1.5"><Sparkles className="w-3 h-3"/> Interactive Event Stream</h3>
                    <div className="flex-1 overflow-y-auto flex flex-col-reverse justify-start relative text-[10px] font-mono leading-relaxed bg-black/20 rounded-md border border-black/40 p-2">
                        {liveLogs.slice().reverse().map((log) => (
                            <motion.div 
                                initial={{opacity: 0, x: 10}} 
                                animate={{opacity: 1, x: 0}} 
                                key={log.id || Math.random()} 
                                className="mb-2 text-slate-400 break-words cursor-pointer hover:bg-slate-800 p-2 rounded-lg transition-all border border-transparent hover:border-slate-700 hover:shadow-lg"
                                onClick={() => handleTimeTravelClick(log)}
                            >
                                <div className="flex items-start justify-between">
                                    <span className="text-zinc-500 flex-shrink-0">[{new Date(log.timestamp).toISOString().substring(11,23)}]</span>
                                    <span className={`text-emerald-400 font-semibold text-right ${log.type === 'ERROR' ? 'text-rose-400' : ''}`}>{log.type}</span> 
                                </div>
                                <div className="mt-1">
                                    <span className="text-purple-400 opacity-90">{log.sourceAgentId}</span>
                                    <span className="text-slate-400 opacity-70 ml-2">
                                        {log.payload?.task ? '-> Task processing triggered' : ''}
                                        {log.payload?.action ? `-> ${log.payload.action}` : ''}
                                        {log.payload?.text ? '-> Generated response' : ''}
                                        {log.payload?.error ? `-> Error: ${log.payload.error}` : ''}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                        {liveLogs.length === 0 && (
                            <div className="text-slate-600 italic text-center py-4">Event stream empty. Prompt agents to begin telemetry.</div>
                        )}
                    </div>
                </div>
            </div>
            <div className="p-2 border-t border-white/5 bg-black/40 shrink-0 text-center">
                <span className="text-[9px] text-slate-600">Click any event to open Time-Travel Debugger</span>
            </div>
        </div>
    );
}
