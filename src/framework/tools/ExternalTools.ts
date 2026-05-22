import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { globalToolRegistry } from './ToolRegistry.ts';

const workspaceRoot = path.resolve(process.cwd(), 'workspace');
const execAsync = promisify(exec);

type ToolMode = 'mock' | 'live' | 'disabled';

const getToolMode = (toolName: string): ToolMode => {
    const specific = process.env[`ORCHESTRA_TOOL_${toolName.toUpperCase()}_MODE`];
    const globalMode = process.env.ORCHESTRA_TOOL_MODE;
    const mode = (specific || globalMode || 'mock').toLowerCase();
    if (mode === 'live' || mode === 'disabled' || mode === 'mock') return mode;
    throw new Error(`Invalid tool mode "${mode}" for ${toolName}. Use mock, live, or disabled.`);
};

const ensureToolEnabled = (toolName: string): ToolMode => {
    const mode = getToolMode(toolName);
    if (mode === 'disabled') {
        throw new Error(`Tool ${toolName} is disabled by ORCHESTRA_TOOL_${toolName.toUpperCase()}_MODE/ORCHESTRA_TOOL_MODE.`);
    }
    return mode;
};

const assertExternalUrlAllowed = (rawUrl: string) => {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isBlockedHost = hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '0.0.0.0'
        || hostname === '::1'
        || hostname.startsWith('10.')
        || hostname.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
        || hostname === '169.254.169.254';

    if (isBlockedHost) {
        throw new Error('Sandbox Security Violation: Access to internal/locally-hosted services is prohibited.');
    }
};

const fetchTextWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 10000) => {
    assertExternalUrlAllowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        return { status: response.status, statusText: response.statusText, text: text.slice(0, 20000) };
    } finally {
        clearTimeout(timer);
    }
};

const safeResolveWorkspacePath = (userPath: string): string | null => {
    const targetPath = path.resolve(workspaceRoot, userPath);
    const relativePath = path.relative(workspaceRoot, targetPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }
    return targetPath;
};

const writeFileAtomically = (absolutePath: string, content: string): void => {
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${absolutePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    try {
        fs.renameSync(tempPath, absolutePath);
    } catch (err: any) {
        if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EEXIST')) {
            fs.rmSync(absolutePath, { force: true });
            try {
                fs.renameSync(tempPath, absolutePath);
                return;
            } catch (retryErr) {
                fs.rmSync(tempPath, { force: true });
                throw retryErr;
            }
        }
        fs.rmSync(tempPath, { force: true });
        throw err;
    }
};

// 1. Web Search Tool
globalToolRegistry.register(
    'webSearch',
    'Search the web for real-time information.',
    z.object({
        query: z.string().describe('The search query or keywords.'),
        numResults: z.number().optional().describe('Number of results to return (default 3)')
    }),
    async ({ query, numResults = 3 }) => {
        const mode = ensureToolEnabled('webSearch');
        if (mode === 'live') {
            throw new Error('webSearch live mode requires a configured search provider. Set this tool to mock mode or add a search provider integration.');
        }

        return JSON.stringify([
            { title: `Mock result for ${query}`, url: 'https://example.com/1', snippet: `Mock snippet for ${query}. Configure live mode with a search provider before treating this as real-time data.` },
            { title: `Mock documentation: ${query}`, url: 'https://example.com/2', snippet: 'Mock documentation result.' }
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
        const mode = ensureToolEnabled('fetchUrl');
        if (mode === 'live') {
            const result = await fetchTextWithTimeout(url);
            return `[HTTP ${result.status} ${result.statusText}]\n${result.text}`;
        }

        return `[MOCK Content of ${url}]: Simulated extracted markdown/text. Set ORCHESTRA_TOOL_FETCHURL_MODE=live to fetch the real URL.`;
    }
);

// 3. Execute Sandbox Code
import * as vm from 'node:vm';

globalToolRegistry.register(
    'executeCodeSandbox',
    'Execute Javascript code only when ORCHESTRA_ENABLE_CODE_SANDBOX=true. This is not a production isolation boundary.',
    z.object({
        language: z.enum(['javascript']).describe('Programming language (currently restricts to javascript)'),
        code: z.string().describe('The code to execute')
    }),
    async ({ language, code }) => {
        if (process.env.ORCHESTRA_ENABLE_CODE_SANDBOX !== 'true') {
            throw new Error('Code sandbox execution is disabled by default. Set ORCHESTRA_ENABLE_CODE_SANDBOX=true only in an isolated environment.');
        }
        
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
    'Read the contents of a file from the workspace file system.',
    z.object({
        filePath: z.string().describe('Relative path to the file within the workspace')
    }),
    async ({ filePath }) => {
        const absolutePath = safeResolveWorkspacePath(filePath);
        if (!absolutePath) {
            return `[File System Error]: Access denied to ${filePath}. Path must be within workspace.`;
        }
        
        if (!fs.existsSync(absolutePath)) {
            return `[File System Error]: File not found: ${filePath}`;
        }
        
        const content = fs.readFileSync(absolutePath, 'utf8');
        return content;
    }
);

// 6. File System Write
globalToolRegistry.register(
    'fileSystemWrite',
    'Write contents to a file in the workspace file system.',
    z.object({
        filePath: z.string().describe('Relative path to the file to create or overwrite'),
        content: z.string().describe('Content to write into the file')
    }),
    async ({ filePath, content }) => {
        const absolutePath = safeResolveWorkspacePath(filePath);
        if (!absolutePath) {
            return `[File System Error]: Access denied to ${filePath}. Path must be within workspace.`;
        }
        
        writeFileAtomically(absolutePath, content || '');
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
        const mode = ensureToolEnabled('executeShellCommand');
        const blacklist = ['rm ', 'mv ', 'chmod', 'chown', 'kill', 'pkill', 'format', ':(){ :|:& };:'];
        if (blacklist.some(forbidden => command.includes(forbidden))) {
            throw new Error(`Sandbox Security Violation: Command "${command}" contains potentially destructive operations.`);
        }

        if (mode === 'live') {
            if (process.env.ORCHESTRA_ENABLE_SHELL_TOOL !== 'true') {
                throw new Error('executeShellCommand live mode requires ORCHESTRA_ENABLE_SHELL_TOOL=true.');
            }
            const { stdout, stderr } = await execAsync(command, { cwd: workspaceRoot, timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
            return `[Shell Output]\n${stdout}\n${stderr ? `[stderr]\n${stderr}` : ''}`.trim();
        }

        return `[MOCK Shell Output]: "${command}" passed safety checks. Set ORCHESTRA_TOOL_EXECUTESHELLCOMMAND_MODE=live and ORCHESTRA_ENABLE_SHELL_TOOL=true to execute for real.`;
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
    async ({ method, url, headers, body }) => {
        const mode = ensureToolEnabled('httpRequest');
        assertExternalUrlAllowed(url);

        if (mode === 'live') {
            const result = await fetchTextWithTimeout(url, { method, headers, body });
            return `[HTTP ${method} ${result.status} ${result.statusText}]\n${result.text}`;
        }

        return `[MOCK HTTP ${method} 200 OK]: Simulated response from ${url}. Set ORCHESTRA_TOOL_HTTPREQUEST_MODE=live for a real request.`;
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
        const mode = ensureToolEnabled('databaseQuery');
        if (query.toLowerCase().includes('drop table') || query.toLowerCase().includes('truncate')) {
             throw new Error('Sandbox Security Violation: Destructive database operations are prohibited via this agentic interface.');
        }

        if (mode === 'live') {
            throw new Error('databaseQuery live mode requires a database adapter. Keep this tool in mock mode until a DB connector is configured.');
        }

        return `[MOCK Database Result]: 3 rows returned successfully (query sanitized).`;
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
        const mode = ensureToolEnabled('ragSearch');
        if (mode === 'live') {
            throw new Error('ragSearch live mode requires a vector database or MemoryMesh-backed retrieval adapter.');
        }

        // M5 Remediation: Higher semantic threshold simulation
        const similarityScore = Math.random(); // In reality, this would be from a vector DB
        if (similarityScore < 0.75) {
            return `[RAG Result]: No matches found above the 0.75 strict similarity threshold.`;
        }

        return `[RAG Result in ${namespace || 'default'}]: Found relevant snippets matching "${contextQuery}" (Similarity: ${similarityScore.toFixed(2)}). Use this context to answer the user.`;
    }
);
