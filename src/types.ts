export interface Agent {
  id: string;
  name: string;
  role: string;
  priority?: number;
  urgency?: number;
  systemInstruction: string;
  avatarColor: string;
  llmProvider: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'auto';
  apiKeyValue: string;
  temperature?: number;
  capabilities?: string[];
  modelName?: string;
  baseURL?: string;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderRole: string; // 'System', 'User', 'Manager', or 'Agent'
  text: string;
  timestamp: number;
}

export interface Edge {
    from: string;
    to: string;
}
