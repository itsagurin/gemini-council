import { useState } from "react";
import type { CSSProperties } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentId = "critic" | "optimist" | "analyst" | "devils_advocate";

interface Agent {
  id: AgentId;
  name: string;
  color: string;
  systemPrompt: string;
}

interface AgentState {
  round1: string | null;
  round2: string | null;
  round1Loading: boolean;
  round2Loading: boolean;
  round1Error: string | null;
  round2Error: string | null;
}

type CouncilState = Record<AgentId, AgentState>;

// ─── Agent Definitions ───────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  {
    id: "critic",
    name: "The Critic",
    color: "#ef4444",
    systemPrompt:
      "You are The Critic. Your role is to identify flaws, challenge assumptions, and find weaknesses in any argument or idea. Be sharp, direct, and intellectually rigorous. Keep responses to 3-4 sentences.",
  },
  {
    id: "optimist",
    name: "The Optimist",
    color: "#22c55e",
    systemPrompt:
      "You are The Optimist. Your role is to find opportunities, build on ideas, and reframe problems as possibilities. Be constructive and energizing. Keep responses to 3-4 sentences.",
  },
  {
    id: "analyst",
    name: "The Analyst",
    color: "#3b82f6",
    systemPrompt:
      "You are The Analyst. Your role is to break down problems with logic, data, and structure. No emotional language — just clear reasoning and evidence-based conclusions. Keep responses to 3-4 sentences.",
  },
  {
    id: "devils_advocate",
    name: "The Devil's Advocate",
    color: "#f59e0b",
    systemPrompt:
      "You are The Devil's Advocate. Your role is to deliberately argue the opposite of what seems obvious, in order to stress-test ideas and surface hidden assumptions. Be provocative but coherent. Keep responses to 3-4 sentences.",
  },
];

const SYNTHESIZER_SYSTEM_PROMPT =
  "You are the Council Synthesizer. Given a multi-agent debate, identify the key tensions, what each side got right, and produce a final nuanced answer. Be concise and decisive.";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ─── API Helper ───────────────────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  userPrompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message = `API error ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed?.error?.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const data = await response.json();
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response text)"
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmptyAgentState(): AgentState {
  return {
    round1: null,
    round2: null,
    round1Loading: false,
    round2Loading: false,
    round1Error: null,
    round2Error: null,
  };
}

function makeInitialCouncilState(): CouncilState {
  return {
    critic: makeEmptyAgentState(),
    optimist: makeEmptyAgentState(),
    analyst: makeEmptyAgentState(),
    devils_advocate: makeEmptyAgentState(),
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e2e8f0",
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: "0 0 60px",
  } as CSSProperties,

  header: {
    borderBottom: "1px solid #1e1e2e",
    padding: "28px 32px 24px",
    background: "#0d0d18",
  } as CSSProperties,

  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "4px",
  } as CSSProperties,

  title: {
    fontSize: "22px",
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "#f1f5f9",
    margin: 0,
  } as CSSProperties,

  subtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: 0,
  } as CSSProperties,

  badge: (color: string) =>
    ({
      display: "inline-block",
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: color,
    }) as CSSProperties,

  inputArea: {
    padding: "28px 32px",
    borderBottom: "1px solid #1e1e2e",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  } as CSSProperties,

  inputRow: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  } as CSSProperties,

  inputLabel: {
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#475569",
    marginBottom: "6px",
    display: "block",
  } as CSSProperties,

  input: {
    background: "#111121",
    border: "1px solid #2a2a3e",
    borderRadius: "6px",
    color: "#e2e8f0",
    fontSize: "14px",
    padding: "10px 14px",
    outline: "none",
    transition: "border-color 0.15s",
  } as CSSProperties,

  questionInput: {
    background: "#111121",
    border: "1px solid #2a2a3e",
    borderRadius: "6px",
    color: "#e2e8f0",
    fontSize: "14px",
    padding: "12px 14px",
    outline: "none",
    resize: "vertical" as const,
    minHeight: "72px",
    width: "100%",
    boxSizing: "border-box" as const,
  } as CSSProperties,

  button: (disabled: boolean) =>
    ({
      background: disabled ? "#1e1e2e" : "#4f46e5",
      color: disabled ? "#475569" : "#fff",
      border: "none",
      borderRadius: "6px",
      fontSize: "14px",
      fontWeight: 600,
      padding: "11px 24px",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.15s",
      whiteSpace: "nowrap" as const,
    }) as CSSProperties,

  content: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0 32px",
  } as CSSProperties,

  sectionDivider: () =>
    ({
      display: "flex",
      alignItems: "center",
      gap: "14px",
      margin: "40px 0 24px",
    }) as CSSProperties,

  sectionLabel: (color: string) =>
    ({
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.12em",
      textTransform: "uppercase" as const,
      color,
      whiteSpace: "nowrap" as const,
    }) as CSSProperties,

  sectionLine: (color: string) =>
    ({
      flex: 1,
      height: "1px",
      background: `linear-gradient(to right, ${color}44, transparent)`,
    }) as CSSProperties,

  agentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
  } as CSSProperties,

  agentCard: (color: string, visible: boolean) =>
    ({
      background: "#111121",
      border: `1px solid ${color}33`,
      borderRadius: "10px",
      overflow: "hidden",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(12px)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
    }) as CSSProperties,

  cardHeader: (color: string) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "12px 16px",
      borderBottom: `1px solid ${color}22`,
      background: `${color}0d`,
    }) as CSSProperties,

  colorDot: (color: string) =>
    ({
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
      boxShadow: `0 0 6px ${color}88`,
    }) as CSSProperties,

  agentName: (color: string) =>
    ({
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
      color,
    }) as CSSProperties,

  cardBody: {
    padding: "14px 16px",
    minHeight: "80px",
  } as CSSProperties,

  responseText: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    fontSize: "13px",
    lineHeight: "1.7",
    color: "#cbd5e1",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
  } as CSSProperties,

  loadingDots: {
    display: "flex",
    gap: "5px",
    alignItems: "center",
    padding: "8px 0",
  } as CSSProperties,

  errorText: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    fontSize: "12px",
    color: "#ef4444",
    margin: 0,
  } as CSSProperties,

  synthesisCard: {
    background: "#111121",
    border: "1px solid #4f46e533",
    borderRadius: "10px",
    overflow: "hidden",
  } as CSSProperties,

  synthesisHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "14px 18px",
    borderBottom: "1px solid #4f46e522",
    background: "#4f46e50d",
  } as CSSProperties,

  synthesisTitle: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#818cf8",
  } as CSSProperties,

  synthesisBody: {
    padding: "18px",
  } as CSSProperties,

  synthesisText: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    fontSize: "13px",
    lineHeight: "1.8",
    color: "#e2e8f0",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
  } as CSSProperties,

  agentBadges: {
    display: "flex",
    gap: "8px",
  } as CSSProperties,
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingDots({ color }: { color: string }) {
  return (
    <div style={S.loadingDots}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: color,
            opacity: 0.7,
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  state,
  round,
}: {
  agent: Agent;
  state: AgentState;
  round: 1 | 2;
}) {
  const isLoading = round === 1 ? state.round1Loading : state.round2Loading;
  const response = round === 1 ? state.round1 : state.round2;
  const error = round === 1 ? state.round1Error : state.round2Error;
  const visible = isLoading || response !== null || error !== null;

  return (
    <div style={S.agentCard(agent.color, visible)}>
      <div style={S.cardHeader(agent.color)}>
        <div style={S.colorDot(agent.color)} />
        <span style={S.agentName(agent.color)}>{agent.name}</span>
      </div>
      <div style={S.cardBody}>
        {isLoading && <LoadingDots color={agent.color} />}
        {error && <p style={S.errorText}>⚠ {error}</p>}
        {response && <p style={S.responseText}>{response}</p>}
      </div>
    </div>
  );
}

function SectionDivider({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <div style={S.sectionDivider()}>
      <span style={S.sectionLabel(color)}>{label}</span>
      <div style={S.sectionLine(color)} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GeminiCouncil() {
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [council, setCouncil] = useState<CouncilState>(
    makeInitialCouncilState()
  );
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  function patchAgent(id: AgentId, patch: Partial<AgentState>) {
    setCouncil((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  async function runCouncil() {
    if (!apiKey.trim() || !question.trim() || running) return;

    setRunning(true);
    setStarted(true);
    setCouncil(makeInitialCouncilState());
    setSynthesis(null);
    setSynthesisLoading(false);
    setSynthesisError(null);

    // ── Round 1 ──────────────────────────────────────────────────────────────
    for (const agent of AGENTS) {
      patchAgent(agent.id, { round1Loading: true });
    }

    const round1Results: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };

    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const text = await callGemini(apiKey, question, agent.systemPrompt);
          round1Results[agent.id] = text;
          patchAgent(agent.id, { round1: text, round1Loading: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          patchAgent(agent.id, { round1Error: msg, round1Loading: false });
        }
      })
    );

    // ── Round 2 ──────────────────────────────────────────────────────────────
    for (const agent of AGENTS) {
      patchAgent(agent.id, { round2Loading: true });
    }

    const round2Prompt = (agent: Agent) => {
      const others = AGENTS.filter((a) => a.id !== agent.id);
      const otherResponses = others
        .map((a) => `${a.name}: ${round1Results[a.id] ?? "(no response)"}`)
        .join("\n\n");
      return `Original question: ${question}

Here is what the other council members said in Round 1:

${otherResponses}

Now respond as your role. You may agree, disagree, or build on what was said.`;
    };

    const round2Results: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };

    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const text = await callGemini(
            apiKey,
            round2Prompt(agent),
            agent.systemPrompt
          );
          round2Results[agent.id] = text;
          patchAgent(agent.id, { round2: text, round2Loading: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          patchAgent(agent.id, { round2Error: msg, round2Loading: false });
        }
      })
    );

    // ── Synthesis ─────────────────────────────────────────────────────────────
    setSynthesisLoading(true);

    const allResponses = AGENTS.map(
      (a) =>
        `${a.name}:\n  Round 1: ${round1Results[a.id] ?? "(no response)"}\n  Round 2: ${round2Results[a.id] ?? "(no response)"}`
    ).join("\n\n");

    const synthesisPrompt = `Question debated: ${question}

Here is the full debate:

${allResponses}

Synthesize the debate and give a final nuanced answer.`;

    try {
      const text = await callGemini(
        apiKey,
        synthesisPrompt,
        SYNTHESIZER_SYSTEM_PROMPT
      );
      setSynthesis(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSynthesisError(msg);
    } finally {
      setSynthesisLoading(false);
      setRunning(false);
    }
  }

  const canRun = apiKey.trim().length > 0 && question.trim().length > 0 && !running;

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        textarea:focus, input:focus {
          border-color: #4f46e5 !important;
          box-shadow: 0 0 0 3px #4f46e522;
        }
        button:hover:not(:disabled) {
          background: #4338ca !important;
        }
      `}</style>

      <div style={S.root}>
        {/* Header */}
        <header style={S.header}>
          <div style={S.titleRow}>
            <div style={S.agentBadges}>
              {AGENTS.map((a) => (
                <div key={a.id} style={S.badge(a.color)} />
              ))}
            </div>
            <h1 style={S.title}>Gemini Council</h1>
          </div>
          <p style={S.subtitle}>
            4 AI agents with distinct personas debate your question across 2
            rounds, followed by a synthesis
          </p>
        </header>

        {/* Input area */}
        <div style={S.inputArea}>
          <div style={S.content}>
            <div>
              <label style={S.inputLabel} htmlFor="api-key">
                Gemini API Key
              </label>
              <input
                id="api-key"
                type="password"
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ ...S.input, width: "100%", maxWidth: "420px" }}
                disabled={running}
              />
            </div>
            <div>
              <label style={S.inputLabel} htmlFor="question">
                Your Question
              </label>
              <textarea
                id="question"
                placeholder="e.g. Should humanity colonize Mars?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                style={S.questionInput}
                disabled={running}
              />
            </div>
            <div style={S.inputRow}>
              <button
                onClick={runCouncil}
                disabled={!canRun}
                style={S.button(!canRun)}
              >
                {running ? "Council in session…" : "Convene the Council"}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {started && (
          <div style={{ ...S.content, paddingTop: "8px" }}>
            {/* Round 1 */}
            <SectionDivider label="Round 1 — Initial Positions" color="#6366f1" />
            <div style={S.agentGrid}>
              {AGENTS.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  state={council[agent.id]}
                  round={1}
                />
              ))}
            </div>

            {/* Round 2 */}
            <SectionDivider label="Round 2 — Debate" color="#8b5cf6" />
            <div style={S.agentGrid}>
              {AGENTS.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  state={council[agent.id]}
                  round={2}
                />
              ))}
            </div>

            {/* Synthesis */}
            <SectionDivider label="Synthesis" color="#818cf8" />
            {(synthesisLoading || synthesis || synthesisError) && (
              <div style={S.synthesisCard}>
                <div style={S.synthesisHeader}>
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#818cf8",
                      boxShadow: "0 0 6px #818cf888",
                    }}
                  />
                  <span style={S.synthesisTitle}>Council Synthesis</span>
                </div>
                <div style={S.synthesisBody}>
                  {synthesisLoading && <LoadingDots color="#818cf8" />}
                  {synthesisError && (
                    <p style={S.errorText}>⚠ {synthesisError}</p>
                  )}
                  {synthesis && <p style={S.synthesisText}>{synthesis}</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
