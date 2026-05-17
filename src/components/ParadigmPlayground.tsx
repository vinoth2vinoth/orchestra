import React, { useState, useRef, useEffect } from 'react';
import { Agent, Edge } from '../types';
import { Network, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import * as d3 from 'd3';

interface ParadigmPlaygroundProps {
    agents: Agent[];
    edges: Edge[];
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
}

interface NodeData extends d3.SimulationNodeDatum {
    id: string;
    agent: Agent;
}

interface LinkData extends d3.SimulationLinkDatum<NodeData> {
    from: string;
    to: string;
}

export function ParadigmPlayground({ agents, edges, setEdges }: ParadigmPlaygroundProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const [nodes, setNodes] = useState<NodeData[]>([]);
    
    // Drag interaction states for wiring
    const [isWiring, setIsWiring] = useState(false);
    const [dragStartNode, setDragStartNode] = useState<string | null>(null);
    const [dragCurrentPos, setDragCurrentPos] = useState<{ x: number, y: number } | null>(null);

    useEffect(() => {
        // Init nodes based on agents (only update if agent list changes length or ids change, to preserve positions)
        setNodes(prev => {
            const newNodes = agents.map(a => {
                const existing = prev.find(p => p.id === a.id);
                if (existing) return { ...existing, agent: a }; // Keep x, y, vx, vy
                return { id: a.id, agent: a } as NodeData;
            });
            return newNodes;
        });
    }, [agents]);

    useEffect(() => {
        if (!containerRef.current || !svgRef.current || nodes.length === 0) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const simulation = d3.forceSimulation<NodeData>(nodes)
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(40));

        // Let simulation run to initialize positions
        simulation.tick(50);
        
        // Save computed positions back to state to render them with React
        setNodes([...simulation.nodes()]);
        simulation.stop();
        
    }, [agents.length]); // Only recompute layout when agent count changes

    // Handlers for wiring
    const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        if (e.button !== 0) return; // Only left click
        setIsWiring(true);
        setDragStartNode(nodeId);
        
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            setDragCurrentPos({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isWiring && dragStartNode) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
                setDragCurrentPos({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                });
            }
        } else {
             // Optional node dragging could go here, but let's keep it simple
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (isWiring) {
            setIsWiring(false);
            setDragStartNode(null);
            setDragCurrentPos(null);
        }
    };

    const handleNodeMouseUp = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        if (isWiring && dragStartNode && dragStartNode !== nodeId) {
            // Create edge
            const exists = edges.find(ed => ed.from === dragStartNode && ed.to === nodeId);
            if (!exists) {
                setEdges(prev => [...prev, { from: dragStartNode, to: nodeId }]);
            }
        }
        setIsWiring(false);
        setDragStartNode(null);
        setDragCurrentPos(null);
    };
    
    const handleDeleteEdge = (e: React.MouseEvent, edgeIndex: number) => {
        e.stopPropagation();
        setEdges(prev => prev.filter((_, i) => i !== edgeIndex));
    };

    return (
        <div 
            className="w-full h-64 bg-slate-950 rounded-xl border border-slate-800 relative overflow-hidden group select-none"
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none"></div>
            
            <div className="absolute top-2 left-2 flex items-center gap-1 opacity-70">
                <Network className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paradigm Playground</span>
            </div>
            
            <div className="absolute bottom-2 left-2 flex flex-col gap-0.5 opacity-60">
                 <span className="text-[9px] font-mono text-slate-400">Drag between nodes to create flow handles</span>
                 <span className="text-[9px] font-mono text-slate-500">Authority flows from Source to Target</span>
            </div>

            <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none">
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
                    </marker>
                    <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
                    </marker>
                </defs>
                {/* Existing Edges */}
                {edges.map((edge, idx) => {
                    const src = nodes.find(n => n.id === edge.from);
                    const tgt = nodes.find(n => n.id === edge.to);
                    if (!src || !tgt || src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) return null;
                    
                    const dx = tgt.x - src.x;
                    const dy = tgt.y - src.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const radius = 24;
                    
                    if (len <= radius * 2) return null;
                    
                    const midX = src.x + dx / 2;
                    const midY = src.y + dy / 2;
                    
                    const startX = src.x + (dx / len) * radius;
                    const startY = src.y + (dy / len) * radius;
                    const endX = tgt.x - (dx / len) * radius;
                    const endY = tgt.y - (dy / len) * radius;

                    return (
                        <g key={idx}>
                            <line 
                                x1={startX} y1={startY} 
                                x2={endX} y2={endY} 
                                stroke="#475569" 
                                strokeWidth="2"
                                strokeDasharray="4 2"
                                markerEnd="url(#arrowhead)"
                            />
                            
                            {/* Delete button wrapper (pointer events enabled) */}
                            <g 
                                className="pointer-events-auto cursor-pointer" 
                                transform={`translate(${midX}, ${midY})`}
                                onClick={(e) => handleDeleteEdge(e, idx)}
                            >
                                <circle r="8" fill="#1e293b" stroke="#ef4444" strokeWidth="1" />
                                <text textAnchor="middle" dy="3" fill="#ef4444" fontSize="10" fontWeight="bold">×</text>
                            </g>
                        </g>
                    );
                })}
                
                {/* Wiring Line currently drawn */}
                {isWiring && dragStartNode && dragCurrentPos && (() => {
                    const startNode = nodes.find(n => n.id === dragStartNode);
                    if (!startNode || startNode.x === undefined || startNode.y === undefined) return null;
                    
                    const dx = dragCurrentPos.x - startNode.x;
                    const dy = dragCurrentPos.y - startNode.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const radius = 24;
                    
                    if (len <= radius) return null;
                    
                    const startX = startNode.x + (dx / len) * radius;
                    const startY = startNode.y + (dy / len) * radius;

                    return (
                        <line 
                            x1={startX} y1={startY} 
                            x2={dragCurrentPos.x} y2={dragCurrentPos.y} 
                            stroke="#3b82f6" 
                            strokeWidth="2"
                            strokeDasharray="4 4"
                            className="animate-pulse"
                            markerEnd="url(#arrowhead-active)"
                        />
                    );
                })()}
            </svg>

            {/* Nodes Rendered via React DOM for easier events and styling */}
            {nodes.map(node => {
                if (node.x === undefined || node.y === undefined) return null;
                const isManager = node.agent.role === 'MANAGER';
                return (
                    <div 
                        key={node.id}
                        className={cn(
                            "absolute flex flex-col items-center justify-center transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-crosshair transition-transform hover:scale-110 group/node",
                            isManager ? "text-amber-400" : "text-blue-400"
                        )}
                        style={{ left: node.x, top: node.y }}
                        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                        onMouseUp={(e) => handleNodeMouseUp(e, node.id)}
                    >
                        <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center border-2 bg-slate-900 shadow-[0_0_15px_rgba(0,0,0,0.5)] z-10 relative",
                            isManager ? "border-amber-500/50" : "border-blue-500/50"
                        )}>
                            <div className={cn("w-3 h-3 rounded-full", node.agent.avatarColor)}></div>
                            {/* Hover info */}
                            <div className="absolute -top-10 bg-slate-800 px-2 py-1 rounded text-[10px] font-bold text-white whitespace-nowrap opacity-0 group-hover/node:opacity-100 transition-opacity pointer-events-none shadow-lg">
                                {node.agent.name} <br/> <span className="text-slate-400 font-mono text-[8px]">{node.agent.role}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
