import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';

export interface CommandAction {
    id: string;
    name: string;
    icon: React.ReactNode;
    shortcut?: string[];
    perform: () => void;
    category?: string;
}

interface CommandPaletteProps {
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    actions: CommandAction[];
}

export function CommandPalette({ open, setOpen, actions }: CommandPaletteProps) {
    const [search, setSearch] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(o => !o);
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [setOpen]);

    useEffect(() => {
        if (open) {
            setSearch('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const filteredActions = actions.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.category?.toLowerCase().includes(search.toLowerCase()));

    useEffect(() => {
        setSelectedIndex(0);
    }, [search]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filteredActions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredActions.length) % filteredActions.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredActions[selectedIndex]) {
                filteredActions[selectedIndex].perform();
                setOpen(false);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
        }
    };

    // Keep selected item in view
    useEffect(() => {
        if (!listRef.current) return;
        const selectedEl = listRef.current.querySelector('[data-selected="true"]') as HTMLElement;
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex, filteredActions]);

    if (!open) return null;

    // Group by category
    const grouped = filteredActions.reduce((acc, action) => {
        const cat = action.category || 'General';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(action);
        return acc;
    }, {} as Record<string, CommandAction[]>);

    let currentIndex = 0;

    return (
        <AnimatePresence>
            {open && (
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
                    onClick={() => setOpen(false)}
                >
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        className="w-full max-w-2xl bg-[#0f111a]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[70vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-4 border-b border-white/10 flex items-center gap-3 bg-white/5">
                            <Search className="w-5 h-5 text-slate-400" />
                            <input 
                                ref={inputRef}
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a command or search..."
                                className="flex-1 bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 font-medium text-lg"
                                spellCheck={false}
                            />
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded shadow-sm">ESC</span>
                            </div>
                        </div>

                        <div className="p-2 overflow-y-auto flex-1 custom-scrollbar" ref={listRef}>
                            {Object.entries(grouped).map(([category, acts], groupIdx) => (
                                <div key={category} className="mb-2">
                                    <div className="px-3 md:px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        {category}
                                    </div>
                                    <div className="space-y-0.5">
                                        {acts.map((action) => {
                                            const isSelected = currentIndex === selectedIndex;
                                            currentIndex++;
                                            
                                            return (
                                                <button
                                                    key={action.id}
                                                    data-selected={isSelected}
                                                    onMouseMove={() => setSelectedIndex(currentIndex - 1)}
                                                    onClick={() => {
                                                        action.perform();
                                                        setOpen(false);
                                                    }}
                                                    className={cn(
                                                        "w-full flex items-center justify-between px-3 md:px-4 py-3 rounded-xl transition-all group text-left",
                                                        isSelected ? "bg-blue-500/20 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)]" : "hover:bg-white/5"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "transition-colors",
                                                            isSelected ? "text-blue-400" : "text-slate-400 group-hover:text-slate-300"
                                                        )}>
                                                            {action.icon}
                                                        </div>
                                                        <span className={cn(
                                                            "text-sm font-medium transition-colors",
                                                            isSelected ? "text-blue-100" : "text-slate-300 group-hover:text-slate-200"
                                                        )}>{action.name}</span>
                                                    </div>
                                                    {action.shortcut && (
                                                        <div className="flex items-center gap-1">
                                                            {action.shortcut.map(key => (
                                                                <span key={key} className={cn(
                                                                    "text-[10px] font-bold transition-colors px-1.5 py-0.5 rounded border shadow-sm",
                                                                    isSelected 
                                                                        ? "text-blue-300 bg-blue-500/20 border-blue-500/30" 
                                                                        : "text-slate-500 bg-slate-950 border-slate-800"
                                                                )}>
                                                                    {key}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {filteredActions.length === 0 && (
                                <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-3">
                                    <Search className="w-8 h-8 opacity-20" />
                                    <span className="text-sm font-medium">No system actions found.</span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
