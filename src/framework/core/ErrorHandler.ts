
export interface ErrorContext {
    agentId?: string;
    threadId?: string;
    task?: any;
    provider?: string;
    timestamp: string;
}

export class AgentFrameworkError extends Error {
    constructor(
        public message: string,
        public code: string,
        public context: ErrorContext,
        public originalError?: any
    ) {
        super(message);
        this.name = 'AgentFrameworkError';
        // Ensure stack trace is preserved
        if (originalError?.stack) {
            this.stack = `${this.stack}\n\nCaused by: ${originalError.stack}`;
        }
    }

    public toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            stack: this.stack
        };
    }
}
