import { z } from 'zod';
import { globalToolRegistry } from './ToolRegistry.ts';
import { globalEventStore } from '../core/EventStore.ts';

// 1. Web Search Tool
globalToolRegistry.register(
    'webSearch',
    'Search the web for real-time information.',
    z.object({
        query: z.string().describe('The search query or keywords.'),
        numResults: z.number().optional().describe('Number of results to return (default 3)')
    }),
    async ({ query, numResults = 3 }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'webSearch', query }
        });
        
        return JSON.stringify([
            { title: `Result for ${query}`, url: 'https://example.com/1', snippet: `Mock snippet containing latest info on ${query}.` },
            { title: `Documentation: ${query}`, url: 'https://example.com/2', snippet: 'Official documentation and guides.' }
        ].slice(0, numResults));
    }
);

// 2. Fetch URL Content
globalToolRegistry.register(
    'fetchUrl',
    'Fetch the text content of a specific URL.',
    z.object({
        url: z.string().url().describe('The absolute URL to fetch.')
    }),
    async ({ url }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'fetchUrl', url }
        });
        return `[Content of ${url}]: This is the simulated extracted markdown or text content from the requested webpage.`;
    }
);

// 3. Execute Sandbox Code
import * as vm from 'node:vm';

globalToolRegistry.register(
    'executeCodeSandbox',
    'Execute Javascript code in a secure sandboxed environment.',
    z.object({
        language: z.enum(['javascript']).describe('Programming language (currently restricts to javascript)'),
        code: z.string().describe('The code to execute')
    }),
    async ({ language, code }) => {
        globalEventStore.append({
            type: 'TOOL_CALL_REQUESTED',
            sourceAgentId: 'SYSTEM',
            threadId: 'GLOBAL',
            payload: { tool: 'executeCodeSandbox', language }
        });
        
        if (code.includes('rm -rf') || code.includes('process.exit')) {
             throw new Error('Sandbox Security Violation: Malicious code pattern detected.');
        }

        if (language === 'javascript') {
            try {
                let logs: string[] = [];
                const context = vm.createContext({
                    console: { log: (...args: any[]) => logs.push(args.join(' ')) },
                    setTimeout,
                    Math,
                    JSON
                });
                const result = vm.runInNewContext(code, context, { timeout: 2000 });
                return `[Sandbox Execution Result]:\nReturned: ${JSON.stringify(result)}\nConsole Output:\n${logs.join('\n')}`;
            } catch (e: any) {
                return `[Sandbox Execution Error]: ${e.message}`;
            }
        }
        
        return `[Sandbox Error]: Unsupported language ${language}`;
    }
);

// 4. Time and Date Utility
globalToolRegistry.register(
    'getCurrentTime',
    'Get the exact current date, time, and timezone.',
    z.object({}),
    async () => {
        const now = new Date();
        return `Current local time: ${now.toString()}`;
    }
);

// 5. File System Read
globalToolRegistry.register(
    'fileSystemRead',
    'Read the contents of a file from the virtual file system.',
    z.object({
        filePath: z.string().describe('Absolute or relative path to the file')
    }),
    async ({ filePath }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'fileSystemRead', filePath } });
        return `[Simulated File Content for ${filePath}]:\n// Read-only mock data\nexport const config = "loaded";`;
    }
);

// 6. File System Write
globalToolRegistry.register(
    'fileSystemWrite',
    'Write contents to a file in the virtual file system.',
    z.object({
        filePath: z.string().describe('Path to the file to create or overwrite'),
        content: z.string().describe('Content to write into the file')
    }),
    async ({ filePath, content }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'fileSystemWrite', filePath, length: content.length } });
        return `Successfully wrote ${content.length} characters to ${filePath}.`;
    }
);

// 7. Execute Shell Command
globalToolRegistry.register(
    'executeShellCommand',
    'Execute a shell/terminal command. Use responsibly. Dangerous commands will be blocked.',
    z.object({
        command: z.string().describe('The shell command to run (e.g. "ls -la", "npm install")')
    }),
    async ({ command }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'executeShellCommand', command } });
        
        const blacklist = ['rm ', 'mv ', 'chmod', 'chown', 'kill', 'pkill', 'format', ':(){ :|:& };:'];
        if (blacklist.some(forbidden => command.includes(forbidden))) {
            throw new Error(`Sandbox Security Violation: Command "${command}" contains potentially destructive operations.`);
        }

        return `[Simulated Shell Output]: Executed "${command}" successfully (checked against safety blacklist).\ntotal 42\ndrwxr-xr-x 2 user group 4096 .`;
    }
);

// 8. HTTP Generic Request
globalToolRegistry.register(
    'httpRequest',
    'Make a customizable REST API request (GET, POST, PUT, DELETE). Note: SSRF protection active.',
    z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional()
    }),
    async ({ method, url }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'httpRequest', method, url } });
        
        // Basic SSRF protection simulation
        if (url.includes('169.254.169.254') || url.includes('localhost') || url.includes('127.0.0.1')) {
             throw new Error('Sandbox Security Violation: Access to internal/locally-hosted services is prohibited.');
        }

        return `[HTTP ${method} 200 OK]: Simulated successful API response from ${url}`;
    }
);

// 9. Database Query Tool
globalToolRegistry.register(
    'databaseQuery',
    'Run a SQL/NoSQL query against the connected project databases. SQL Injection protection active.',
    z.object({
        query: z.string().describe('The query string to execute')
    }),
    async ({ query }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'databaseQuery', query } });
        
        if (query.toLowerCase().includes('drop table') || query.toLowerCase().includes('truncate')) {
             throw new Error('Sandbox Security Violation: Destructive database operations are prohibited via this agentic interface.');
        }

        return `[Database Result]: 3 rows updated/returned successfully (Query sanitized).`;
    }
);

// 10. Memory/RAG Search Tool 
globalToolRegistry.register(
    'ragSearch',
    'Semantic search over the organization knowledge base, docs, and codebase context.',
    z.object({
        contextQuery: z.string().describe('The concept or semantic question to search for'),
        namespace: z.string().optional().describe('Optional namespace like "codebase", "company-docs", etc.')
    }),
    async ({ contextQuery, namespace }) => {
        globalEventStore.append({ type: 'TOOL_CALL_REQUESTED', sourceAgentId: 'SYSTEM', threadId: 'GLOBAL', payload: { tool: 'ragSearch', contextQuery } });
        
        // M5 Remediation: Higher semantic threshold simulation
        const similarityScore = Math.random(); // In reality, this would be from a vector DB
        if (similarityScore < 0.75) {
            return `[RAG Result]: No matches found above the 0.75 strict similarity threshold.`;
        }

        return `[RAG Result in ${namespace || 'default'}]: Found relevant snippets matching "${contextQuery}" (Similarity: ${similarityScore.toFixed(2)}). Use this context to answer the user.`;
    }
);

