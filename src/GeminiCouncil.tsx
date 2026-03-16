import { useMemo, useState } from "react";
import { GoogleGenAI } from "@google/genai";

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

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "synthesis";
  title: string;
  body: string;
  time: string;
  color?: string;
  trace?: string;
}

type CouncilState = Record<AgentId, AgentState>;

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
      "You are The Analyst. Your role is to break down problems with logic, data, and structure. No emotional language, just clear reasoning and evidence-based conclusions. Keep responses to 3-4 sentences.",
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

const GEMINI_MODEL = "gemini-3.0-flash";

async function callGemini(
  client: GoogleGenAI,
  userPrompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
    },
  });

  return response.text ?? "(no response text)";
}

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

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function GeminiCouncil() {
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim() ?? "";
  const client = useMemo(
    () => (envApiKey ? new GoogleGenAI({ apiKey: envApiKey }) : null),
    [envApiKey]
  );
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [council, setCouncil] = useState<CouncilState>(makeInitialCouncilState());
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [openTraces, setOpenTraces] = useState<Record<string, boolean>>({});

  const hasApiKey = envApiKey.length > 0;

  const round1Done = useMemo(
    () =>
      AGENTS.filter((agent) => {
        const state = council[agent.id];
        return Boolean(state.round1 || state.round1Error);
      }).length,
    [council]
  );

  const round2Done = useMemo(
    () =>
      AGENTS.filter((agent) => {
        const state = council[agent.id];
        return Boolean(state.round2 || state.round2Error);
      }).length,
    [council]
  );

  const progressLabel = useMemo(() => {
    if (!running) return "Idle";
    if (round1Done < AGENTS.length) {
      return `Round 1 ${round1Done}/${AGENTS.length}`;
    }
    if (round2Done < AGENTS.length) {
      return `Round 2 ${round2Done}/${AGENTS.length}`;
    }
    if (synthesisLoading) {
      return "Synthesis";
    }
    return "Finalizing";
  }, [round1Done, round2Done, running, synthesisLoading]);

  function patchAgent(id: AgentId, patch: Partial<AgentState>) {
    setCouncil((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  function toggleTrace(messageId: string) {
    setOpenTraces((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }

  async function runCouncil() {
    if (!question.trim() || running) return;
    if (!hasApiKey || !client) {
      setGlobalError("Missing VITE_GEMINI_API_KEY. Add it in your .env file.");
      return;
    }

    const prompt = question.trim();
    setGlobalError(null);
    setSynthesisError(null);
    setOpenTraces({});
    setRunning(true);
    setStarted(true);
    setCouncil(makeInitialCouncilState());
    setMessages([
      {
        id: `user-${Date.now()}`,
        role: "user",
        title: "You",
        body: prompt,
        time: nowTime(),
      },
    ]);

    for (const agent of AGENTS) {
      patchAgent(agent.id, { round1Loading: true });
    }

    const round1Results: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };
    const round1Errors: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };

    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const text = await callGemini(client, prompt, agent.systemPrompt);
          round1Results[agent.id] = text;
          patchAgent(agent.id, { round1: text, round1Loading: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          round1Errors[agent.id] = msg;
          patchAgent(agent.id, { round1Error: msg, round1Loading: false });
        }
      })
    );

    setMessages((prev) => [
      ...prev,
      ...AGENTS.map((agent) => {
        const body = round1Results[agent.id] ?? round1Errors[agent.id] ?? "(no response)";
        return {
          id: `r1-${agent.id}-${Date.now()}`,
          role: "assistant" as const,
          title: `${agent.name} - Round 1`,
          body,
          time: nowTime(),
          color: agent.color,
          trace: `Input question:\n${prompt}\n\nPersona instruction:\n${agent.systemPrompt}`,
        };
      }),
    ]);

    for (const agent of AGENTS) {
      patchAgent(agent.id, { round2Loading: true });
    }

    const round2Results: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };
    const round2Errors: Record<AgentId, string | null> = {
      critic: null,
      optimist: null,
      analyst: null,
      devils_advocate: null,
    };

    const buildRound2Prompt = (agent: Agent): string => {
      const others = AGENTS.filter((item) => item.id !== agent.id);
      const reactions = others
        .map((item) => `${item.name}: ${round1Results[item.id] ?? "(no response)"}`)
        .join("\n\n");

      return `Original question: ${prompt}

Round 1 from other council members:

${reactions}

Now respond as your role. You may agree, disagree, or build on what was said.`;
    };

    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const promptForAgent = buildRound2Prompt(agent);
          const text = await callGemini(client, promptForAgent, agent.systemPrompt);
          round2Results[agent.id] = text;
          patchAgent(agent.id, { round2: text, round2Loading: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          round2Errors[agent.id] = msg;
          patchAgent(agent.id, { round2Error: msg, round2Loading: false });
        }
      })
    );

    setMessages((prev) => [
      ...prev,
      ...AGENTS.map((agent) => {
        const body = round2Results[agent.id] ?? round2Errors[agent.id] ?? "(no response)";
        const peers = AGENTS.filter((item) => item.id !== agent.id)
          .map((item) => `${item.name}: ${round1Results[item.id] ?? "(no response)"}`)
          .join("\n");
        return {
          id: `r2-${agent.id}-${Date.now()}`,
          role: "assistant" as const,
          title: `${agent.name} - Round 2`,
          body,
          time: nowTime(),
          color: agent.color,
          trace: `Question:\n${prompt}\n\nRound 1 context from peers:\n${peers}`,
        };
      }),
    ]);

    setSynthesisLoading(true);

    const allResponses = AGENTS.map((agent) => {
      return `${agent.name}:\nRound 1: ${round1Results[agent.id] ?? "(no response)"}\nRound 2: ${round2Results[agent.id] ?? "(no response)"}`;
    }).join("\n\n");

    const synthesisPrompt = `Question debated: ${prompt}

Here is the full debate:

${allResponses}

Synthesize the debate and provide a final nuanced answer.`;

    try {
      const text = await callGemini(
        client,
        synthesisPrompt,
        SYNTHESIZER_SYSTEM_PROMPT
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `synthesis-${Date.now()}`,
          role: "synthesis",
          title: "Council Synthesis",
          body: text,
          time: nowTime(),
          color: "#818cf8",
          trace: `Synthesis used all responses from both rounds to produce one balanced answer.`,
        },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      setSynthesisError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `synthesis-error-${Date.now()}`,
          role: "synthesis",
          title: "Council Synthesis",
          body: `Error: ${msg}`,
          time: nowTime(),
          color: "#818cf8",
        },
      ]);
    } finally {
      setSynthesisLoading(false);
      setRunning(false);
    }
  }

  const canRun = question.trim().length > 0 && !running;

  return (
    <div className="gc-root">
      <header className="gc-header">
        <div className="gc-title-row">
          <h1>Gemini Council</h1>
          <span className="gc-beta">Council chat</span>
        </div>
        <p>
          A clean multi-agent chat experience: 4 perspectives, 2 rounds, and one
          final synthesis.
        </p>
      </header>

      <main className="gc-main">
        {!hasApiKey && (
          <div className="gc-alert">
            Add <code>VITE_GEMINI_API_KEY</code> to your <code>.env</code> file.
          </div>
        )}

        {globalError && <div className="gc-alert gc-alert-error">{globalError}</div>}
        {synthesisError && <div className="gc-alert gc-alert-error">{synthesisError}</div>}

        <section className="gc-chat-shell">
          <div className="gc-chat-thread">
            {!started && (
              <div className="gc-empty">
                <h2>Start a new council thread</h2>
                <p>Ask a question and the council will debate it in real time.</p>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === "user";
              const isTraceOpen = Boolean(openTraces[message.id]);

              return (
                <article
                  key={message.id}
                  className={`gc-message ${isUser ? "is-user" : "is-assistant"}`}
                >
                  <div className="gc-message-head">
                    <div className="gc-message-title-wrap">
                      {!isUser && message.color && (
                        <span
                          className="gc-color-dot"
                          style={{ backgroundColor: message.color }}
                        />
                      )}
                      <span className="gc-message-title">{message.title}</span>
                    </div>
                    <time>{message.time}</time>
                  </div>

                  <p className="gc-message-body">{message.body}</p>

                  {message.trace && (
                    <>
                      <button
                        type="button"
                        className="gc-trace-toggle"
                        onClick={() => toggleTrace(message.id)}
                      >
                        {isTraceOpen ? "Hide thinking" : "Thinking"}
                      </button>
                      {isTraceOpen && (
                        <pre className="gc-trace-box gc-trace-highlight">{message.trace}</pre>
                      )}
                    </>
                  )}
                </article>
              );
            })}

            {running && (
              <div className="gc-thinking-inline">
                <span className="gc-thinking-dot" />
                Models are thinking... {progressLabel}
              </div>
            )}
          </div>

          <div className="gc-composer">
            <label htmlFor="question" className="gc-composer-label">
              Your question
            </label>
            <textarea
              id="question"
              value={question}
              disabled={running}
              placeholder="e.g. Should we launch this product now or wait one quarter?"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button type="button" onClick={runCouncil} disabled={!canRun || !hasApiKey}>
              {running ? "Council in progress..." : "Convene council"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
