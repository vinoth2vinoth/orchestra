import { motion } from 'motion/react';
import { Network, Database, Shield, Zap, Workflow, Cpu, History, Activity, AlertCircle, CheckCircle2 } from 'lucide-react';
import architectureDiagram from '../assets/architecture-diagram.svg';
import { useState, useEffect } from 'react';

interface AuditLogEntry {
  timestamp: number;
  type: string;
  payload: {
    action: string;
    status?: string;
    violations?: string[];
    tier?: string;
    error?: string;
  };
}

export function ArchitectureOverview() {
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/governance/audit');
        const data = await res.json();
        setAuditLogs(data.auditTrail || []);
      } catch (e) {
        console.error('Failed to fetch audit logs');
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-12 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-12">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider"
            >
              <Network className="w-3 h-3" />
              Agentic Grid v2.4
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl font-bold text-slate-100 tracking-tight"
            >
              Orchestra Architecture
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-lg text-slate-400 max-w-2xl leading-relaxed"
            >
              Standardizing distributed agent coordination through a multi-layered governance engine and event-driven persistence.
            </motion.p>
          </div>

          <div className="flex gap-4">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center gap-4 min-w-[160px]">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Sys Status</div>
                <div className="text-sm font-bold text-slate-200">Operational</div>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center gap-4 min-w-[160px]">
              <Shield className="w-5 h-5 text-blue-500" />
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Active Policies</div>
                <div className="text-sm font-bold text-slate-200">12 Enabled</div>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <section className="lg:col-span-2 relative group">
            <motion.div 
               initial={{ opacity: 0, scale: 0.98 }}
               animate={{ opacity: 1, scale: 1 }}
               transition={{ delay: 0.3 }}
               className="relative z-10 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Control Hierarchy</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-slate-800" />
                  <div className="w-2 h-2 rounded-full bg-slate-800" />
                  <div className="w-2 h-2 rounded-full bg-slate-800" />
                </div>
              </div>
              <div className="p-12 flex justify-center bg-[#09090b]">
                <img src={architectureDiagram} alt="Orchestra Architecture" className="w-full h-auto max-w-4xl" />
              </div>
            </motion.div>
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 rounded-[2rem] blur-2xl -z-10 opacity-50 group-hover:opacity-100 transition duration-1000"></div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full min-h-[500px]">
             <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center gap-2">
                <History className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Governance Feed</span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-slate-600 text-sm animate-pulse">
                    Monitoring Governance Engine...
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-600 text-sm italic">
                    No governance events recorded.
                  </div>
                ) : (
                  auditLogs.slice().reverse().map((log, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 border-l-2 border-l-blue-500"
                    >
                      <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                         {log.payload?.status === 'RED' ? (
                           <AlertCircle className="w-3 h-3 text-red-500" />
                         ) : (
                           <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                         )}
                      </div>
                      <div className="text-xs font-bold text-slate-300">{log.payload?.action}</div>
                      <div className="text-[10px] text-slate-500 leading-tight">
                        {log.payload?.status === 'RED' ? (
                          <span className="text-red-400/80">Violation: {log.payload.violations?.join(', ')}</span>
                        ) : log.payload?.tier ? (
                          <span className="text-amber-400/80">Escalation: {log.payload.tier}</span>
                        ) : (
                          <span>Policy passed successfully.</span>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
             </div>
          </section>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors"
          >
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4 border border-blue-500/20">
              <Cpu className="w-5 h-5 text-blue-500" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 mb-2">Control Plane</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Decouples task reception from agent execution using an asynchronous message bus.
            </p>
          </motion.div>

          {/* ... and so on for other 3 blocks, simplifying for brevity ... */}
        </div>
      </div>
    </div>
  );
}
