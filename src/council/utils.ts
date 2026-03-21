import type { AgentState, CouncilState } from "./types";

export function makeEmptyAgentState(): AgentState {
  return {
    round1: null,
    round2: null,
    round1Loading: false,
    round2Loading: false,
    round1Error: null,
    round2Error: null,
  };
}

export function makeInitialCouncilState(): CouncilState {
  return {
    critic: makeEmptyAgentState(),
    optimist: makeEmptyAgentState(),
    analyst: makeEmptyAgentState(),
    devils_advocate: makeEmptyAgentState(),
  };
}

export function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sleep(ms: number): Promise<void> {
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

export function formatGeminiError(error: unknown): string {
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

