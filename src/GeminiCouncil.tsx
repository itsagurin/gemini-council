import { useMemo, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

const GEMINI_MODEL = "gemini-3-flash-preview";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelaySeconds(rawMessage: string): number | null {
  const retryInMatch = rawMessage.match(/Please retry in\s+([\d.]+)s/i);
  if (retryInMatch) {
    const seconds = Number.parseFloat(retryInMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      error?: { details?: Array<{ retryDelay?: string }> };
    };
    const retryDelay = parsed.error?.details?.find((detail) => detail.retryDelay)
      ?.retryDelay;
    if (!retryDelay) return null;
    const retryDelayMatch = retryDelay.match(/^([\d.]+)s$/);
    if (!retryDelayMatch) return null;
    const seconds = Number.parseFloat(retryDelayMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

function formatGeminiError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const isRateLimitError =
    rawMessage.includes('"code":429') ||
    /RESOURCE_EXHAUSTED/i.test(rawMessage) ||
    /quota exceeded/i.test(rawMessage);

  if (!isRateLimitError) {
    return rawMessage;
  }

  const retryAfterSeconds = extractRetryDelaySeconds(rawMessage);
  if (retryAfterSeconds !== null) {
    const roundedSeconds = Math.ceil(retryAfterSeconds);
    return `Free Gemini limit reached (429). Wait about ${roundedSeconds}s and try again.`;
  }

  return "Free Gemini limit reached (429). Wait a bit and try again.";
}

export default function GeminiCouncil() {
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim() ?? "";
  const isFreeTier =
    (import.meta.env.VITE_FREE_TIER_GEMINI ?? import.meta.env.FREE_TIER_GEMINI) ===
    "true";
  const DELAY_MS = 13000;
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
  const [showThinkingPanel, setShowThinkingPanel] = useState(true);

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
    setQuestion("");
    let lastFreeTierRequestCompletedAt = 0;

    const callGeminiWithRateLimit = async (
      userPrompt: string,
      systemPrompt: string
    ): Promise<string> => {
      if (!isFreeTier) {
        return callGemini(client, userPrompt, systemPrompt);
      }

      if (lastFreeTierRequestCompletedAt > 0) {
        const elapsed = Date.now() - lastFreeTierRequestCompletedAt;
        const waitMs = Math.max(0, DELAY_MS - elapsed);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }

      try {
        return await callGemini(client, userPrompt, systemPrompt);
      } finally {
        // Keep at least DELAY_MS between every free-tier API call.
        lastFreeTierRequestCompletedAt = Date.now();
      }
    };

    setGlobalError(null);
    setSynthesisError(null);
    setOpenTraces({});
    setShowThinkingPanel(true);
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

    const executeRound1 = async (agent: Agent) => {
      try {
        const text = await callGeminiWithRateLimit(prompt, agent.systemPrompt);
        round1Results[agent.id] = text;
        patchAgent(agent.id, { round1: text, round1Loading: false });
      } catch (error) {
        const msg = formatGeminiError(error);
        round1Errors[agent.id] = msg;
        patchAgent(agent.id, { round1Error: msg, round1Loading: false });
      }
    };

    if (isFreeTier) {
      for (const agent of AGENTS) {
        await executeRound1(agent);
      }
    } else {
      await Promise.all(AGENTS.map(executeRound1));
    }

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

    const executeRound2 = async (agent: Agent) => {
      try {
        const promptForAgent = buildRound2Prompt(agent);
        const text = await callGeminiWithRateLimit(
          promptForAgent,
          agent.systemPrompt
        );
        round2Results[agent.id] = text;
        patchAgent(agent.id, { round2: text, round2Loading: false });
      } catch (error) {
        const msg = formatGeminiError(error);
        round2Errors[agent.id] = msg;
        patchAgent(agent.id, { round2Error: msg, round2Loading: false });
      }
    };

    if (isFreeTier) {
      for (const agent of AGENTS) {
        await executeRound2(agent);
      }
    } else {
      await Promise.all(AGENTS.map(executeRound2));
    }

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
      const text = await callGeminiWithRateLimit(
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
      const msg = formatGeminiError(error);
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

            {messages
              .filter((message) => message.role === "user" || message.role === "synthesis")
              .map((message) => {
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

                  <div className="gc-message-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.body}
                    </ReactMarkdown>
                  </div>

                  {message.role === "synthesis" && message.trace && (
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

            {running && showThinkingPanel && (
              <div className="gc-thinking-panel" aria-live="polite">
                <div className="gc-thinking-panel-head">
                  <div className="gc-thinking-main">
                    <span className="gc-thinking-spinner" />
                    <div>
                      <p className="gc-thinking-title">Council is convening...</p>
                      <p className="gc-thinking-status">{progressLabel}</p>
                    </div>
                    <button
                      type="button"
                      className="gc-thinking-close"
                      onClick={() => setShowThinkingPanel(false)}
                    >
                      Hide
                    </button>
                  </div>
                  <details className="gc-process-toggle">
                    <summary>View process</summary>
                    <div className="gc-process-panel">
                      {AGENTS.map((agent) => {
                        const state = council[agent.id];
                        const round1Status = state.round1Error
                          ? "Error"
                          : state.round1
                            ? "Done"
                            : state.round1Loading
                              ? "Loading"
                              : "Pending";
                        const round2Status = state.round2Error
                          ? "Error"
                          : state.round2
                            ? "Done"
                            : state.round2Loading
                              ? "Loading"
                              : "Pending";

                        return (
                          <article key={agent.id} className="gc-process-agent">
                            <div className="gc-process-agent-head">
                              <span
                                className="gc-process-agent-dot"
                                style={{ backgroundColor: agent.color }}
                              />
                              <span>{agent.name}</span>
                            </div>
                            <div className="gc-process-rounds">
                              <span
                                className={`gc-process-pill is-${round1Status.toLowerCase()}`}
                              >
                                R1: {round1Status}
                              </span>
                              <span
                                className={`gc-process-pill is-${round2Status.toLowerCase()}`}
                              >
                                R2: {round2Status}
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                </div>
              </div>
            )}

            {running && !showThinkingPanel && (
              <button
                type="button"
                className="gc-thinking-inline"
                onClick={() => setShowThinkingPanel(true)}
              >
                <span className="gc-thinking-dot" />
                Show thinking
              </button>
            )}

            {!running && messages.some((message) => message.role === "synthesis") && (
              <details className="gc-debate-details">
                <summary>View detailed debate</summary>
                <div className="gc-debate-list">
                  {messages
                    .filter((message) => message.role === "assistant")
                    .map((message) => {
                      const isTraceOpen = Boolean(openTraces[message.id]);
                      return (
                        <article key={message.id} className="gc-message gc-message-detail">
                          <div className="gc-message-head">
                            <div className="gc-message-title-wrap">
                              {message.color && (
                                <span
                                  className="gc-color-dot"
                                  style={{ backgroundColor: message.color }}
                                />
                              )}
                              <span className="gc-message-title">{message.title}</span>
                            </div>
                            <time>{message.time}</time>
                          </div>
                          <div className="gc-message-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.body}
                            </ReactMarkdown>
                          </div>
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
                </div>
              </details>
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
              {running ? "Council in progress..." : "Ask the Council"}
            </button>
          </div>
        </section>
      </main>
      <footer style={{ textAlign: 'center', padding: '24px', opacity: 0.4, fontSize: '15px' }}>
        made with ♥ by <a href="https://github.com/itsagurin" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>itsagurin</a>
      </footer>
    </div>
  );
}
