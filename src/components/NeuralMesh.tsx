import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { Bot, Network, Zap } from 'lucide-react';

interface Node extends d3.SimulationNodeDatum {
    id: string;
    label: string;
    type: 'AGENT' | 'SYSTEM' | 'ORCHESTRATOR';
    lastActive?: number;
    avatarColor?: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
    id: string;
    source: string | Node;
    target: string | Node;
    value: number;
    lastPulse?: number;
}

export function NeuralMesh({ liveLogs, agents }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    // Compute graph data from logs and agent definitions
    const { nodes, links } = useMemo(() => {
        const nodeList: Node[] = [
            { id: 'ORCHESTRATOR', label: 'Orchestrator', type: 'ORCHESTRATOR' },
            ...agents.map(a => ({
                id: a.id,
                label: a.name,
                type: 'AGENT' as const,
                avatarColor: a.avatarColor
            }))
        ];

        const linkMap = new Map<string, Link>();
        
        // Extract interactions from logs
        // A link exists if agents interact in the same thread sequence
        const threadSequences: Record<string, string[]> = {};
        
        liveLogs.forEach(log => {
            if (!log.threadId || !log.sourceAgentId) return;
            
            if (!threadSequences[log.threadId]) {
                threadSequences[log.threadId] = [];
            }
            
            const seq = threadSequences[log.threadId];
            const source = log.sourceAgentId;
            
            // Map common system IDs to recognized nodes
            const normalizedSource = agents.some(a => a.id === source || a.name === source) 
                ? (agents.find(a => a.id === source || a.name === source)?.id || source)
                : (source === 'ORCHESTRATOR' || source === 'SYSTEM' ? 'ORCHESTRATOR' : source);

            if (seq.length > 0) {
                const prev = seq[seq.length - 1];
                if (prev !== normalizedSource && nodeList.some(n => n.id === prev) && nodeList.some(n => n.id === normalizedSource)) {
                    const linkId = `${prev}-${normalizedSource}`;
                    if (!linkMap.has(linkId)) {
                        linkMap.set(linkId, {
                            id: linkId,
                            source: prev,
                            target: normalizedSource,
                            value: 1,
                            lastPulse: log.timestamp
                        });
                    } else {
                        const existing = linkMap.get(linkId)!;
                        existing.value += 1;
                        existing.lastPulse = Math.max(existing.lastPulse || 0, log.timestamp);
                    }
                }
            }
            seq.push(normalizedSource);
            
            // Mark node as active
            const node = nodeList.find(n => n.id === normalizedSource);
            if (node) {
                node.lastActive = Math.max(node.lastActive || 0, log.timestamp);
            }
        });

        return {
            nodes: nodeList,
            links: Array.from(linkMap.values())
        };
    }, [liveLogs, agents]);

    useEffect(() => {
        if (!svgRef.current || !containerRef.current) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Create groups
        const linkGroup = svg.append('g').attr('class', 'links');
        const nodeGroup = svg.append('g').attr('class', 'nodes');

        // Force simulation
        const simulation = d3.forceSimulation<Node>(nodes)
            .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(40));

        // Draw links
        const link = linkGroup.selectAll<SVGLineElement, Link>('.link')
            .data(links)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke', '#334155')
            .attr('stroke-width', (d: Link) => Math.sqrt(d.value) * 1.5)
            .attr('stroke-opacity', 0.4);

        // Link pulses for recent activity
        const pulses = linkGroup.selectAll<SVGCircleElement, Link>('.pulse')
            .data(links.filter(l => Date.now() - (l.lastPulse || 0) < 5000))
            .enter()
            .append('circle')
            .attr('r', 3)
            .attr('fill', '#60a5fa')
            .attr('class', 'pulse');

        // Draw nodes
        const node = nodeGroup.selectAll<SVGGElement, Node>('.node')
            .data(nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(d3.drag<SVGGElement, Node>()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

        // Node circles
        node.append('circle')
            .attr('r', 25)
            .attr('fill', (d: Node) => d.type === 'ORCHESTRATOR' ? '#1e293b' : '#0f172a')
            .attr('stroke', (d: Node) => {
                if (Date.now() - (d.lastActive || 0) < 2000) return '#60a5fa';
                return '#334155';
            })
            .attr('stroke-width', (d: Node) => Date.now() - (d.lastActive || 0) < 2000 ? 3 : 1)
            .style('filter', (d: Node) => Date.now() - (d.lastActive || 0) < 2000 ? 'drop-shadow(0 0 8px rgba(96, 165, 250, 0.5))' : 'none');

        // Node labels
        node.append('text')
            .attr('dy', 40)
            .attr('text-anchor', 'middle')
            .attr('fill', '#94a3b8')
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .attr('class', 'select-none pointer-events-none')
            .text((d: Node) => d.label);

        // Node Icons (placeholder circles for now, or emojis)
        node.append('text')
            .attr('dy', 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', '16px')
            .attr('class', 'select-none pointer-events-none')
            .text((d: Node) => d.type === 'ORCHESTRATOR' ? '🧠' : '🤖');

        simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

            pulses.each(function(d: any) {
                const elapsed = (Date.now() % 2000) / 2000;
                const source = d.source;
                const target = d.target;
                d3.select(this)
                    .attr('cx', source.x + (target.x - source.x) * elapsed)
                    .attr('cy', source.y + (target.y - source.y) * elapsed)
                    .attr('opacity', 1 - elapsed);
            });
        });

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

    }, [nodes, links]);

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex justify-between items-center mb-2 px-1">
                <div className="flex items-center gap-1.5">
                    <Network className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Neural Mesh Topology</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]"></div>
                        <span className="text-[8px] text-slate-600 uppercase font-bold">Active Neuron</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-blue-400 animate-pulse" />
                        <span className="text-[8px] text-slate-600 uppercase font-bold">Pulse Event</span>
                    </div>
                </div>
            </div>
            <div ref={containerRef} className="flex-1 bg-black/40 rounded-xl border border-white/5 relative overflow-hidden group">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px]"></div>
                <svg ref={svgRef} className="w-full h-full" />
                
                {/* Overlay instructions */}
                <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[8px] text-slate-600 uppercase font-mono bg-black/60 px-2 py-1 rounded">Drag nodes to rearrange synaptic weights</span>
                </div>
            </div>
        </div>
    );
}
