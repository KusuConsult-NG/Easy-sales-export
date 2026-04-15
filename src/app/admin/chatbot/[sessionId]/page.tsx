"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    Bot, User, ArrowLeft, CheckCircle2, AlertTriangle,
    Loader2, Clock, MessageCircle,
} from "lucide-react";
import {
    getChatThreadAction,
    resolveSessionAction,
    type ChatThreadResult,
} from "@/app/actions/chatbot-admin";
import { MODULE_CONFIGS } from "@/lib/chatbot-knowledge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function ChatThreadPage() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const router = useRouter();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState(false);
    const [data, setData] = useState<ChatThreadResult>({ messages: [], session: null });

    useEffect(() => {
        if (!sessionId) return;
        setLoading(true);
        getChatThreadAction(sessionId).then(result => {
            setData(result);
            if (result.error) toast.error(result.error);
        }).finally(() => setLoading(false));
    }, [sessionId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [data.messages]);

    async function handleResolve() {
        if (!sessionId) return;
        setResolving(true);
        try {
            const result = await resolveSessionAction(sessionId);
            if (result.success) {
                toast.success("Session marked as resolved");
                setData(prev => ({
                    ...prev,
                    session: prev.session ? { ...prev.session, resolved: true } : null,
                }));
            } else {
                toast.error(result.error || "Failed to resolve session");
            }
        } finally {
            setResolving(false);
        }
    };

    const { session, messages } = data;
    const config = session ? MODULE_CONFIGS[session.module] : null;

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            {/* Back */}
            <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to sessions
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-10 h-10 animate-spin text-green-600" />
                </div>
            ) : !session ? (
                <div className="text-center py-16 text-slate-400">
                    <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p>Session not found or access denied.</p>
                </div>
            ) : (
                <>
                    {/* Session Metadata Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white"
                                    style={{ background: config?.accentColor }}
                                >
                                    <Bot className="w-6 h-6" />
                                </div>
                                <div>
                                    <h1 className="font-bold text-slate-900">
                                        {config?.name} — Thread
                                    </h1>
                                    <p className="text-sm text-slate-500">{session.userEmail}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {session.escalated && (
                                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-medium">
                                        <AlertTriangle className="w-3.5 h-3.5" /> Escalated
                                    </span>
                                )}
                                {session.resolved ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full font-medium">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
                                    </span>
                                ) : (
                                    <button
                                        onClick={handleResolve}
                                        disabled={resolving}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                        {resolving ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="w-4 h-4" />
                                        )}
                                        Mark Resolved
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100">
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Module</p>
                                <p className="text-sm font-medium text-slate-700 capitalize">{session.module}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Messages</p>
                                <p className="text-sm font-medium text-slate-700">{session.messageCount}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Last Active</p>
                                <p className="text-sm font-medium text-slate-700 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" />
                                    {session.lastMessageAt.toLocaleString("en-NG", {
                                        day: "2-digit", month: "short", year: "numeric",
                                        hour: "2-digit", minute: "2-digit",
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Escalation banner */}
                    {session.escalated && !session.resolved && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-semibold text-amber-800 text-sm">Support Required</p>
                                <p className="text-xs text-amber-700 mt-1">
                                    This user requested human support during the conversation.
                                    Review the thread and contact them at their registered email/phone, then mark as resolved.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Message Thread */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 max-h-[560px] overflow-y-auto">
                        {messages.length === 0 ? (
                            <p className="text-center text-slate-400 text-sm py-8">No messages in this session.</p>
                        ) : messages.map(msg => (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex gap-3 max-w-[85%]",
                                    msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                                )}
                            >
                                <div className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                    msg.role === "user" ? "bg-slate-200 text-slate-600" : "text-white"
                                )}
                                style={msg.role === "assistant" ? { background: config?.accentColor ?? "#16a34a" } : {}}
                                >
                                    {msg.role === "user"
                                        ? <User className="w-3.5 h-3.5" />
                                        : <Bot className="w-3.5 h-3.5" />
                                    }
                                </div>

                                <div className={cn(
                                    "p-3 rounded-2xl text-sm leading-relaxed",
                                    msg.role === "user"
                                        ? "text-white rounded-tr-none"
                                        : "bg-slate-100 text-slate-800 rounded-tl-none",
                                    msg.isEscalation && "ring-2 ring-amber-300"
                                )}
                                style={msg.role === "user" ? { backgroundColor: config?.accentColor ?? "#16a34a" } : {}}
                                >
                                    {msg.content}
                                    <div className="flex items-center gap-2 mt-1 opacity-50">
                                        <span className="text-[10px]">
                                            {msg.timestamp.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                        {msg.isEscalation && (
                                            <span className="text-[10px] text-amber-600 font-medium">⚡ escalation trigger</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                </>
            )}
        </div>
    );
}
