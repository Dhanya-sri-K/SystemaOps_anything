import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";
import { queryChatbot, getActiveCodebaseFiles } from "../utils/geminiService";

interface ProjectChatbotProps {
  embedded?: boolean;
}

export default function ProjectChatbot({ embedded = false }: ProjectChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Zustand states
  const chatbotMessages = useDashboardStore((s) => s.chatbotMessages);
  const addChatbotMessage = useDashboardStore((s) => s.addChatbotMessage);
  const isChatbotLoading = useDashboardStore((s) => s.isChatbotLoading);
  const setChatbotLoading = useDashboardStore((s) => s.setChatbotLoading);
  const analyzingRepoLabel = useDashboardStore((s) => s.analyzingRepoLabel);

  // Auto scroll to bottom when new messages arrive or loading state changes
  useEffect(() => {
    if (embedded || isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatbotMessages, isChatbotLoading, isOpen, embedded]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputValue.trim();
    if (!query || isChatbotLoading) return;

    setInputValue("");
    
    // Add user message to store
    addChatbotMessage({ role: "user", parts: query });
    setChatbotLoading(true);

    try {
      const codebase = getActiveCodebaseFiles();
      if (codebase.length === 0) {
        throw new Error("No source files available for context.");
      }

      // Convert history to format needed by geminiService
      const history = chatbotMessages.map(msg => ({
        role: msg.role,
        parts: msg.parts
      }));

      const response = await queryChatbot(codebase, history, query);
      addChatbotMessage({ role: "model", parts: response });
    } catch (err) {
      console.error("Chatbot Error:", err);
      addChatbotMessage({
        role: "model",
        parts: `Error: ${err instanceof Error ? err.message : "Failed to generate response."}`
      });
    } finally {
      setChatbotLoading(false);
    }
  };

  const messagesContent = (
    <>
      {chatbotMessages.map((msg, index) => {
        const isUser = msg.role === "user";
        return (
          <div
            key={index}
            className={`flex flex-col max-w-[85%] ${
              isUser ? "self-end items-end" : "self-start items-start"
            }`}
          >
            <div
              className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                isUser
                  ? "bg-accent/15 text-accent border border-accent/30 rounded-tr-none"
                  : "bg-elevated text-text-secondary border border-border-subtle rounded-tl-none"
              }`}
            >
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                  code: ({ className, children }) => {
                    const isBlock = className?.includes("language-");
                    return isBlock ? (
                      <code className="block bg-surface rounded p-2 my-1 overflow-x-auto text-[10px] font-mono leading-relaxed border border-border-subtle">
                        {children}
                      </code>
                    ) : (
                      <code className="bg-surface border border-border-subtle rounded px-1 py-0.5 text-[10px] font-mono text-accent">
                        {children}
                      </code>
                    );
                  },
                  ul: ({ children }) => <ul className="list-disc list-inside mb-1 pl-1 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-1 pl-1 space-y-0.5">{children}</ol>
                }}
              >
                {msg.parts}
              </ReactMarkdown>
            </div>
          </div>
        );
      })}

      {/* Typing Indicator */}
      {isChatbotLoading && (
        <div className="self-start bg-elevated border border-border-subtle rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
          <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
          <span className="w-1.5 h-1.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </>
  );

  const inputForm = (
    <form
      onSubmit={handleSend}
      className="p-3 bg-elevated border-t border-border-subtle flex gap-2 shrink-0"
    >
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Ask anything about the codebase..."
        disabled={isChatbotLoading}
        className="flex-1 bg-surface border border-border-subtle rounded-xl px-3.5 py-2 text-xs text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent transition-colors disabled:opacity-55"
      />
      <button
        type="submit"
        disabled={!inputValue.trim() || isChatbotLoading}
        className="bg-accent/15 border border-accent/30 hover:bg-accent/25 text-accent font-semibold px-4 py-2 rounded-xl text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        Send
      </button>
    </form>
  );

  if (embedded) {
    return (
      <div className="h-full flex flex-col min-h-0 bg-root/40">
        {/* Embedded Header */}
        <div className="px-4 py-3 bg-elevated border-b border-border-subtle flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            <div>
              <h3 className="text-xs font-bold text-text-primary tracking-wide uppercase">
                CHATBOT
              </h3>
              <p className="text-[9px] text-text-muted truncate max-w-[200px] font-mono">
                Context: {analyzingRepoLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Embedded Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col min-h-0">
          {messagesContent}
        </div>

        {/* Embedded Input Form */}
        {inputForm}
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Chat Window */}
      {isOpen && (
        <div className="w-[360px] sm:w-[400px] h-[500px] bg-surface/90 border border-border-medium rounded-2xl shadow-[0_0_25px_rgba(0,245,255,0.25)] flex flex-col overflow-hidden backdrop-blur-md mb-4 animate-slide-up">
          {/* Header */}
          <div className="px-4 py-3 bg-elevated border-b border-border-subtle flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              <div>
                <h3 className="text-xs font-bold text-text-primary tracking-wide uppercase">
                  CHATBOT
                </h3>
                <p className="text-[9px] text-text-muted truncate max-w-[200px] font-mono">
                  Context: {analyzingRepoLabel}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-text-muted hover:text-text-primary transition-colors cursor-pointer text-sm"
              title="Close chat"
            >
              ✕
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col min-h-0 bg-root/40">
            {messagesContent}
          </div>

          {/* Form */}
          {inputForm}
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-12 h-12 bg-elevated border border-accent/40 text-accent rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(0,245,255,0.3)] hover:bg-accent/10 transition-all hover:scale-105 hover:shadow-[0_0_20px_rgba(0,245,255,0.5)] cursor-pointer"
        title="CHATBOT"
      >
        {isOpen ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
