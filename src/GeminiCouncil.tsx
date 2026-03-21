import { useMemo, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import CouncilMessage from "./council/CouncilMessage";
import { callGemini } from "./council/api";
import {
  AGENTS,
  FREE_TIER_DELAY_MS,
  GEMINI_MODEL,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "./council/constants";
import type { Agent, AgentId, AgentState, ChatMessage, CouncilState } from "./council/types";
import { formatGeminiError, makeInitialCouncilState, nowTime, sleep } from "./council/utils";

export default function GeminiCouncil() {
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim() ?? "";
  const isFreeTier =
    (import.meta.env.VITE_FREE_TIER_GEMINI ?? import.meta.env.FREE_TIER_GEMINI) ===
    "true";
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
        return callGemini(client, GEMINI_MODEL, userPrompt, systemPrompt);
      }

      if (lastFreeTierRequestCompletedAt > 0) {
        const elapsed = Date.now() - lastFreeTierRequestCompletedAt;
        const waitMs = Math.max(0, FREE_TIER_DELAY_MS - elapsed);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }

      try {
        return await callGemini(client, GEMINI_MODEL, userPrompt, systemPrompt);
      } finally {
        // Keep at least FREE_TIER_DELAY_MS between every free-tier API call.
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
                const isTraceOpen = Boolean(openTraces[message.id]);

                return (
                  <CouncilMessage
                    key={message.id}
                    message={message}
                    isTraceOpen={isTraceOpen}
                    onToggleTrace={toggleTrace}
                  />
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
                        <CouncilMessage
                          key={message.id}
                          message={message}
                          isTraceOpen={isTraceOpen}
                          onToggleTrace={toggleTrace}
                          extraClassName="gc-message-detail"
                        />
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
      <footer className="gc-footer">
        made with &lt;3 by{" "}
        <a href="https://github.com/itsagurin" target="_blank" rel="noreferrer">
          itsagurin
        </a>
      </footer>
    </div>
  );
}
