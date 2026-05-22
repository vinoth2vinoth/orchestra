import { globalSecretVault, type SecretStore } from './SecretVault.ts';

export interface ToolInvocationContext {
    tenantId: string;
    agentId: string;
    threadId: string;
    capabilities: string[];
}

export interface SecurityPolicy {
    tenantId: string;
    allowedTools: string[]; // List of tools this tenant is allowed to execute
    requiredSecrets: Record<string, string[]>; // Map<ToolName, List of required secret keys>
}

/**
 * IAMInterceptor
 * 
 * Enforces Role-Based Access Control (RBAC) and Secret Injection at the tool execution boundary.
 * Prevents rogue or confused deputy agents from accessing other tenants' secrets or using forbidden tools.
 */
export class IAMInterceptor {
    private policies: Map<string, SecurityPolicy> = new Map();
    private secretVault: SecretStore;

    constructor(options: { secretVault?: SecretStore } = {}) {
        this.secretVault = options.secretVault || globalSecretVault;
    }

    public registerPolicy(policy: SecurityPolicy) {
        this.policies.set(policy.tenantId, policy);
    }

    /**
     * Intercept tool execution.
     * 1. Validates that the tenant has permission to run the tool.
     * 2. Injects any required secrets securely into the tool arguments.
     */
    public interceptAndInject(context: ToolInvocationContext, toolName: string, args: any): any {
        const policy = this.policies.get(context.tenantId);
        
        if (!policy) {
            throw new Error(`[IAM Error] No security policy found for tenant: ${context.tenantId}`);
        }

        if (!policy.allowedTools.includes(toolName) && !policy.allowedTools.includes('*')) {
            throw new Error(`[IAM Error] Tenant ${context.tenantId} is not authorized to execute tool: ${toolName}`);
        }

        // Clone args to prevent mutation of the original object
        const securedArgs = { ...args };

        // Inject secrets if required by the tool for this tenant
        const requiredSecrets = policy.requiredSecrets[toolName] || [];
        for (const secretKey of requiredSecrets) {
            const secretValue = this.secretVault.getSecret(context.tenantId, secretKey);
            
            if (!secretValue) {
                throw new Error(`[IAM Error] Required secret '${secretKey}' not found in vault for tenant ${context.tenantId}`);
            }

            // By convention, we inject secrets into a _secrets object within the arguments.
            // The tool implementation can access args._secrets to perform authentications.
            if (!securedArgs._secrets) {
                securedArgs._secrets = {};
            }
            securedArgs._secrets[secretKey] = secretValue;
        }

        return securedArgs;
    }
}

export const globalIAMInterceptor = new IAMInterceptor();
