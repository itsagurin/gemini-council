import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "./types";

interface CouncilMessageProps {
  message: ChatMessage;
  isTraceOpen: boolean;
  onToggleTrace: (messageId: string) => void;
  extraClassName?: string;
}

export default function CouncilMessage({
  message,
  isTraceOpen,
  onToggleTrace,
  extraClassName,
}: CouncilMessageProps) {
  const isUser = message.role === "user";

  return (
    <article
      className={`gc-message ${isUser ? "is-user" : "is-assistant"}${extraClassName ? ` ${extraClassName}` : ""}`}
    >
      <div className="gc-message-head">
        <div className="gc-message-title-wrap">
          {!isUser && message.color && (
            <span className="gc-color-dot" style={{ backgroundColor: message.color }} />
          )}
          <span className="gc-message-title">{message.title}</span>
        </div>
        <time>{message.time}</time>
      </div>

      <div className="gc-message-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body}</ReactMarkdown>
      </div>

      {message.trace && (
        <>
          <button
            type="button"
            className="gc-trace-toggle"
            onClick={() => onToggleTrace(message.id)}
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
}

