"use client";

import { useState, useEffect, useRef } from "react";

interface Borrower {
  id: string;
  name: string;
  phone: string;
  totalDebt: number;
  minimumAccept: number;
  status: string;
  agentState?: {
    strategy: string | null;
    lastAction: string | null;
  } | null;
  latestMessage?: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
  messageCount: number;
}

interface Message {
  id: string;
  role: "USER" | "AGENT" | "SYSTEM";
  content: string;
  createdAt: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusColor(lastAction: string | null | undefined): string {
  switch (lastAction) {
    case "RESOLVED":
      return "#22c55e";
    case "OFFER_SENT":
      return "f59e0b";
    case "WAITING_RESPONSE":
      return "3b82f6";
    case "ESCALATE":
      return "ef4444";
    default:
      return "#6b7280";
  }
}

export default function ConversationsPage() {
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentState, setAgentState] = useState<Borrower["agentState"]>(null);
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    fetch("/api/conversations")
      .then((res) => res.json())
      .then(setBorrowers)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setUserScrolledUp(false);
    fetch(`/api/conversations/${selectedId}`)
      .then((res) => res.json())
      .then((data) => {
        setMessages(data.messages || []);
        setAgentState(data.agentState);
        setBorrower(data.borrower);

        const lastMsg = data.messages?.[data.messages.length - 1];
        if (lastMsg?.role === "USER") {
          setThinking(true);
        }
      })
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      fetch(`/api/conversations/${selectedId}`)
        .then((res) => res.json())
        .then((data) => {
          setMessages(data.messages || []);
          setAgentState(data.agentState);
          setBorrower(data.borrower);

          const lastMsg = data.messages?.[data.messages.length - 1];
          if (lastMsg?.role === "AGENT") {
            setThinking(false);
          }
        })
        .catch(console.error);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    if (!userScrolledUp && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, userScrolledUp]);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  };

  const sendMessage = async () => {
    if (!input.trim() || !selectedId || sending) return;

    setSending(true);
    setUserScrolledUp(false);
    const content = input.trim();

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        role: "USER" as const,
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setThinking(true);

    try {
      const res = await fetch(`/api/conversations/${selectedId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to send:", data.error);
      }
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#0f0f0f",
        color: "#e5e5e5",
        fontFamily: "monospace",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          width: 260,
          minWidth: 260,
          backgroundColor: "#141414",
          borderRight: "1px solid #222",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #222",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#666",
          }}
        >
          Conversations
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {borrowers.map((b) => (
            <div
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #1a1a1a",
                cursor: "pointer",
                backgroundColor: selectedId === b.id ? "#1a1a1a" : "transparent",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => {
                if (selectedId !== b.id)
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "#161616";
              }}
              onMouseLeave={(e) => {
                if (selectedId !== b.id)
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 500 }}>{b.name}</span>
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: getStatusColor(b.agentState?.lastAction),
                  }}
                  title={b.agentState?.lastAction || "No status"}
                />
              </div>
              <div style={{ color: "#666", fontSize: "11px", marginBottom: 2 }}>
                {b.phone}
              </div>
              {b.latestMessage && (
                <div
                  style={{
                    color: "#555",
                    fontSize: "11px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.latestMessage.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {!selectedId ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#444",
            }}
          >
            Select a conversation
          </div>
        ) : (
          <>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #222",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ fontWeight: 500 }}>{borrower?.name}</span>
              <span style={{ color: "#666" }}>{borrower?.phone}</span>
              <span style={{ color: "#555" }}>
                {formatCurrency(borrower?.totalDebt || 0)}
              </span>
              {agentState?.strategy && (
                <span
                  style={{
                    fontSize: "10px",
                    padding: "2px 6px",
                    backgroundColor: "#1a1a1a",
                    borderRadius: 2,
                    color: "#888",
                  }}
                >
                  {agentState.strategy}
                </span>
              )}
            </div>

            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              style={{ flex: 1, overflow: "auto", padding: "16px" }}
            >
              {messages.map((msg) => {
                if (msg.role === "SYSTEM") {
                  return (
                    <div
                      key={msg.id}
                      style={{
                        textAlign: "center",
                        color: "#555",
                        fontSize: "11px",
                        fontStyle: "italic",
                        margin: "8px 0",
                      }}
                    >
                      {msg.content}
                    </div>
                  );
                }

                const isUser = msg.role === "USER";
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isUser ? "flex-end" : "flex-start",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "10px",
                        color: "#555",
                        marginBottom: 2,
                      }}
                    >
                      {isUser ? "You" : "Agent"}
                    </div>
                    <div
                      style={{
                        padding: "8px 12px",
                        backgroundColor: isUser ? "#1a2a1a" : "#1e1e1e",
                        color: isUser ? "#8f8" : "#fff",
                        maxWidth: "70%",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.content}
                    </div>
                    <div
                      style={{
                        fontSize: "10px",
                        color: "#444",
                        marginTop: 2,
                      }}
                    >
                      {formatTime(msg.createdAt)}
                    </div>
                  </div>
                );
              })}
              {thinking && messages.length > 0 && messages[messages.length - 1].role === "USER" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "#555",
                    fontSize: "12px",
                    padding: "8px 0",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: "#3b82f6",
                      animation: "pulse 1s infinite",
                    }}
                  />
                  Agent is thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid #222",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type as the customer…"
                disabled={sending}
                style={{
                  flex: 1,
                  backgroundColor: "#141414",
                  border: "1px solid #222",
                  padding: "10px 12px",
                  color: "#e5e5e5",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                style={{
                  padding: "10px 16px",
                  backgroundColor: sending ? "#222" : "#1a2a1a",
                  border: "1px solid #222",
                  color: sending ? "#555" : "#8f8",
                  cursor: sending ? "default" : "pointer",
                  fontFamily: "monospace",
                  fontSize: "12px",
                }}
              >
                {sending ? "..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}