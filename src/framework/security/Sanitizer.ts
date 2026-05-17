/**
 * Sanitizer provides utilities to prevent Prompt Injection (Indirect and Direct).
 * It ensures that untrusted data from memory or blackboard doesn't break out of its context.
 */
export class Sanitizer {
    /**
     * Escapes critical structural tags that could be used for prompt injection.
     */
    public static escapePromptInjections(text: string): string {
        if (!text) return '';
        
        // Escape standard XML/Markdown like tags if they match our internal structural blocks
        let escaped = text
            .replace(/\[MEMGPT_CORE_MEMORY\]/g, '\\[MEMGPT_CORE_MEMORY\\]')
            .replace(/\[\/MEMGPT_CORE_MEMORY\]/g, '\\[\\/MEMGPT_CORE_MEMORY\\]')
            .replace(/\[LEARNED_EXPERIENCE_ORCHESTRATION\]/g, '\\[LEARNED_EXPERIENCE_ORCHESTRATION\\]')
            .replace(/\[INSTRUCTIONAL_MUTATION_ACTIVE\]/g, '\\[INSTRUCTIONAL_MUTATION_ACTIVE\\]')
            .replace(/SYSTEM_INSTRUCTION:/g, 'SYSTEM_INSTRUCTION\\:')
            .replace(/SECURITY DIRECTIVE:/g, 'SECURITY DIRECTIVE\\:');

        // Prevent triple-backtick breakout if used in markdown blocks
        escaped = escaped.replace(/```/g, '`\\`\\`');

        return escaped;
    }

    /**
     * Wraps untrusted data in a sterile boundary.
     */
    public static wrapSterile(text: string, label: string = 'UNTRUSTED_DATA'): string {
        const escaped = this.escapePromptInjections(text);
        return `\n<${label}>\n${escaped}\n</${label}>\n`;
    }

    /**
     * Basic PII/Secret scrubbing - VERY SIMPLE MOCK for the demo
     */
    public static scrubSecrets(text: string): string {
        // Redact potential API keys (simple heuristic)
        return text.replace(/[a-zA-Z0-9]{32,}/g, (match) => {
            // If it looks like a hex or base64 long string, redact it
            if (/^[a-fA-F0-9]+$/.test(match) || /^[a-zA-Z0-9+/=]+$/.test(match)) {
                return '[REDACTED_SECRET]';
            }
            return match;
        });
    }
}
