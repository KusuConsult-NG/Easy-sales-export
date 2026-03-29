"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles, User, Bot, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULE_CONFIGS, type ChatbotModule } from "@/lib/chatbot-knowledge";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

interface AiChatWidgetProps {
    /** Override the module detection. If omitted, module is inferred from pathname. */
    module?: ChatbotModule;
}

function detectModule(pathname: string): ChatbotModule {
    if (pathname.startsWith("/marketplace")) return "marketplace";
    if (pathname.startsWith("/cooperatives")) return "cooperative";
    if (pathname.startsWith("/export")) return "export";
    if (pathname.startsWith("/academy")) return "academy";
    if (pathname.startsWith("/wave")) return "wave";
    if (pathname.startsWith("/farm-nation")) return "farm-nation";
    return "hub";
}

export function AiChatWidget({ module: moduleProp }: AiChatWidgetProps) {
    const pathname = usePathname();
    const module = moduleProp ?? detectModule(pathname ?? "");
    const config = MODULE_CONFIGS[module];

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Hide on admin routes
    const isHidden = pathname?.startsWith("/admin") || pathname?.startsWith("/auth");

    // Initialise greeting on open
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            setMessages([{
                id: "greeting",
                role: "assistant",
                content: config.greeting,
                timestamp: new Date(),
            }]);
        }
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen, config.greeting, messages.length]);

    // Re-greet when module changes and chat is open
    useEffect(() => {
        if (isOpen) {
            setMessages([{
                id: "greeting-" + module,
                role: "assistant",
                content: config.greeting,
                timestamp: new Date(),
            }]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [module]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isOpen]);

    const handleQuickAction = useCallback((action: string) => {
        setInputValue(action);
        setTimeout(() => {
            const form = document.getElementById("chat-form-" + module);
            if (form) (form as HTMLFormElement).requestSubmit();
        }, 50);
    }, [module]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: inputValue.trim(),
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        setIsLoading(true);
        setHasInteracted(true);

        try {
            // Build history for context (exclude greeting)
            const history = messages
                .filter(m => m.id !== "greeting" && !m.id.startsWith("greeting-"))
                .map(m => ({ role: m.role, content: m.content }));

            const response = await fetch("/api/ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: userMessage.content,
                    module,
                    history,
                }),
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error || "Failed to get response");

            const botMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: data.reply || "I'm having trouble connecting right now. Please try again or contact support.",
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, botMessage]);
        } catch (error) {
            console.error("AI Chat error:", error);
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "I'm sorry, I encountered a connection issue. Please try again or contact our support team directly.",
                timestamp: new Date(),
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    if (isHidden) return null;

    const showQuickActions = !hasInteracted && messages.length <= 1;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Chat Window */}
            <div
                className={cn(
                    "mb-4 w-[360px] md:w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden transition-all duration-300 origin-bottom-right",
                    isOpen ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"
                )}
                style={{ maxHeight: "calc(100vh - 120px)" }}
            >
                {/* Header */}
                <div
                    className="p-4 flex items-center justify-between"
                    style={{ background: `linear-gradient(135deg, ${config.gradientFrom}, ${config.gradientTo})` }}
                >
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm leading-tight">{config.name}</h3>
                            <p className="text-xs text-white/80 flex items-center gap-1.5 mt-0.5">
                                <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse inline-block" />
                                {config.tagline}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="text-white/70 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
                    >
                        <ChevronDown className="w-5 h-5" />
                    </button>
                </div>

                {/* Messages Area */}
                <div className="h-[340px] overflow-y-auto p-4 space-y-3 bg-slate-50/80">
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex gap-2.5 max-w-[88%]",
                                msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                            )}
                        >
                            <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                msg.role === "user"
                                    ? "bg-slate-200 text-slate-600"
                                    : "text-white"
                            )}
                            style={msg.role === "assistant" ? { background: config.accentColor } : {}}
                            >
                                {msg.role === "user"
                                    ? <User className="w-3.5 h-3.5" />
                                    : <Bot className="w-3.5 h-3.5" />
                                }
                            </div>

                            <div className={cn(
                                "p-3 rounded-2xl text-sm leading-relaxed",
                                msg.role === "user"
                                    ? "text-white rounded-tr-none shadow-sm"
                                    : "bg-white text-slate-800 border border-slate-200/80 rounded-tl-none shadow-sm"
                            )}
                            style={msg.role === "user" ? { backgroundColor: config.accentColor } : {}}
                            >
                                {msg.content}
                                <span className="text-[10px] opacity-40 block mt-1 text-right">
                                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                            </div>
                        </div>
                    ))}

                    {/* Typing Indicator */}
                    {isLoading && (
                        <div className="flex gap-2.5 mr-auto items-center">
                            <div className="w-7 h-7 rounded-full text-white flex items-center justify-center shrink-0"
                                style={{ background: config.accentColor }}>
                                <Bot className="w-3.5 h-3.5" />
                            </div>
                            <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-200/80 shadow-sm">
                                <div className="flex gap-1 items-center">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Quick Actions */}
                {showQuickActions && (
                    <div className="px-4 pb-3 bg-slate-50/80 border-t border-slate-100">
                        <p className="text-[11px] text-slate-400 mb-2 pt-2 font-medium uppercase tracking-wide">Quick Questions</p>
                        <div className="flex flex-wrap gap-1.5">
                            {config.quickActions.map((action) => (
                                <button
                                    key={action}
                                    onClick={() => handleQuickAction(action)}
                                    className="text-xs px-3 py-1.5 rounded-full border transition-all duration-150 hover:shadow-sm active:scale-95 bg-white border-slate-200 text-slate-600 hover:border-current hover:text-current"
                                    style={{ "--hover-color": config.accentColor } as React.CSSProperties}
                                    onMouseEnter={e => {
                                        (e.currentTarget as HTMLButtonElement).style.borderColor = config.accentColor;
                                        (e.currentTarget as HTMLButtonElement).style.color = config.accentColor;
                                    }}
                                    onMouseLeave={e => {
                                        (e.currentTarget as HTMLButtonElement).style.borderColor = "";
                                        (e.currentTarget as HTMLButtonElement).style.color = "";
                                    }}
                                >
                                    {action}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Input Area */}
                <form
                    id={"chat-form-" + module}
                    onSubmit={handleSubmit}
                    className="p-3 bg-white border-t border-slate-200"
                >
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            placeholder="Type your question..."
                            className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:ring-2 transition-all"
                            style={{ "--ring-color": config.accentColor } as React.CSSProperties}
                            onFocus={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${config.accentColor}40`)}
                            onBlur={e => (e.currentTarget.style.boxShadow = "")}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!inputValue.trim() || isLoading}
                            className="p-2.5 rounded-xl text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                            style={{ backgroundColor: config.accentColor }}
                        >
                            {isLoading
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <Send className="w-5 h-5" />
                            }
                        </button>
                    </div>
                    <p className="text-center text-[10px] text-slate-400 mt-2">
                        Powered by Easy Sales AI · <span className="text-slate-500">Always verify important decisions</span>
                    </p>
                </form>
            </div>

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "relative group flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95",
                    isOpen ? "bg-slate-700 text-white" : "text-white"
                )}
                style={!isOpen ? { background: `linear-gradient(135deg, ${config.gradientFrom}, ${config.gradientTo})` } : {}}
                aria-label={isOpen ? "Close chat" : "Open AI Assistant"}
            >
                {isOpen ? (
                    <X className="w-6 h-6" />
                ) : (
                    <>
                        <MessageCircle className="w-6 h-6" />
                        {/* Pulse ring */}
                        <span
                            className="absolute inset-0 rounded-full animate-ping opacity-20"
                            style={{ backgroundColor: config.accentColor }}
                        />
                        {/* Unread dot */}
                        <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white text-white text-[8px] flex items-center justify-center font-bold">
                            1
                        </span>
                    </>
                )}
            </button>
        </div>
    );
}
