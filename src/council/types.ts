export type AgentId = "critic" | "optimist" | "analyst" | "devils_advocate";

export interface Agent {
  id: AgentId;
  name: string;
  color: string;
  systemPrompt: string;
}

export interface AgentState {
  round1: string | null;
  round2: string | null;
  round1Loading: boolean;
  round2Loading: boolean;
  round1Error: string | null;
  round2Error: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "synthesis";
  title: string;
  body: string;
  time: string;
  color?: string;
  trace?: string;
}

export type CouncilState = Record<AgentId, AgentState>;

