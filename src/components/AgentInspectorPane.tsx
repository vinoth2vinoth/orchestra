import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Brain, ShieldAlert, Cpu, Wrench, RefreshCw, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent } from '../types';

interface AgentInspectorProps {
    agentId: string;
    onClose: () => void;
}

export function AgentInspectorPane({ agentId, onClose }: AgentInspectorProps) {
    const [state, setState] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchState = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/agents/${agentId}/state`);
            if (res.ok) {
                const data = await res.json();
                setState(data);
            } else {
                setState(null);
            }
        } catch (e) {
            console.error(e);
            setState(null);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchState();
        // Periodic refresh or subscribe to SSE in a real app
        const timer = setInterval(fetchState, 5000);
        return () => clearInterval(timer);
    }, [agentId]);

    return (
        <AnimatePresence>
            <motion.div 
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed right-0 top-0 bottom-0 w-[400px] z-[100] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"
            >
                <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950">
                    <div className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-indigo-400" />
                        <div>
                            <h2 className="font-bold text-slate-200">Mental State Inspector</h2>
                            <p className="text-[10px] uppercase text-slate-500 font-mono tracking-wider">{agentId}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                         <button onClick={fetchState} className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors bg-slate-800 rounded-md hover:bg-slate-700">
                            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                        </button>
                        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors bg-slate-800 rounded-md hover:bg-slate-700">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {!state ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                            <Cpu className="w-8 h-8 opacity-20" />
                            <p className="text-sm font-medium">Agent offline or not materialized</p>
                            <p className="text-xs text-center px-4 opacity-60">The simulation must be running or recently executed for an agent's memory to be inspected.</p>
                        </div>
                    ) : (
                        <>
                            {/* MemGPT Core Memory */}
                            {state.coreMemory && (
                                <section>
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                        <Brain className="w-3.5 h-3.5 text-purple-400" />
                                        Core Memory (MemGPT Hybrid)
                                    </h3>
                                    <div className="space-y-2">
                                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                                            <span className="text-[9px] uppercase font-mono text-purple-400 mb-2 block font-bold">Persona Block</span>
                                            <p className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{state.coreMemory.persona}</p>
                                        </div>
                                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                                            <span className="text-[9px] uppercase font-mono text-teal-400 mb-2 block font-bold">Human Block</span>
                                            <p className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{state.coreMemory.human}</p>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Active Constraints / Laws */}
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                                    Active Constraints
                                </h3>
                                
                                {state.instructionPatches && state.instructionPatches.length > 0 ? (
                                    <div className="space-y-2">
                                        {state.instructionPatches.map((patch: string, i: number) => (
                                            <div key={i} className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                                                <span className="text-[9px] font-mono text-rose-400 font-bold mb-1 block">LAW {i+1}</span>
                                                <p className="text-xs text-slate-300 leading-relaxed">{patch}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-4 border border-dashed border-slate-800 rounded-lg text-center flex flex-col items-center justify-center gap-1 bg-slate-950">
                                        <span className="text-xs text-slate-500">No mutated instructions</span>
                                        <span className="text-[10px] text-slate-600">Pure base system prompt active</span>
                                    </div>
                                )}
                            </section>

                            {/* Local Blackboard */}
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                    <Layers className="w-3.5 h-3.5 text-blue-400" />
                                    Local Blackboard
                                </h3>
                                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[10px] text-slate-300 overflow-x-auto relative">
                                    {Object.keys(state.localBlackboard || {}).length > 0 ? (
                                        <pre>{JSON.stringify(state.localBlackboard, null, 2)}</pre>
                                    ) : (
                                        <span className="text-slate-600 italic">Blackboard is empty...</span>
                                    )}
                                </div>
                            </section>

                            {/* Tool Loadout */}
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                    <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                                    Tool Loadout
                                </h3>
                                {state.hostedTools && state.hostedTools.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {state.hostedTools.map((tool: string) => (
                                            <div key={tool} className="px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                                <span className="text-xs font-mono text-emerald-100">{tool}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-4 border border-dashed border-slate-800 rounded-lg text-center text-xs text-slate-500 bg-slate-950">
                                        No tools hosted locally
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
