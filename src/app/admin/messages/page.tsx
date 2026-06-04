"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import {
    MessageCircle,
    Send,
    Loader2,
    User,
    Search,
    Inbox,
    Clock,
    CheckCheck,
    ChevronLeft,
    HeadphonesIcon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    where
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { sendMessageAction, getAllConversationsAdminAction } from "@/app/actions/messages";
import { useToast } from "@/contexts/ToastContext";
import type { Conversation, Message } from "@/lib/types/messages";
import { useFirebaseAuthed } from "@/hooks/useFirebaseAuthed";

export default function AdminMessagesPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const adminId = session?.user?.id;
    const isAuthed = useFirebaseAuthed(adminId);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageInput, setMessageInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [showMobileList, setShowMobileList] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Real-time listener for conversations
    useEffect(() => {
        if (!adminId || !isAuthed) return;
        
        const roles: string[] = (session?.user as any)?.roles || [];
        const isFullAdmin = roles.includes("admin") || roles.includes("super_admin");

        setLoading(true);
        let q;
        if (isFullAdmin) {
            // Full admins see all global conversations
            q = query(
                collection(db, COLLECTIONS.CONVERSATIONS),
                orderBy("updatedAt", "desc"),
                limit(50)
            );
        } else {
            // Module admins only see conversations explicitly mapped/assigned to them
            q = query(
                collection(db, COLLECTIONS.CONVERSATIONS),
                where("participants", "array-contains", adminId),
                orderBy("updatedAt", "desc"),
                limit(50)
            );
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const convs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Conversation[];
            setConversations(convs);
            setLoading(false);
        }, (error) => {
            console.error("Admin support conversations listener failed:", error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [adminId, isAuthed, session]);

    // Initial load for messages using server action to guarantee delivery
    useEffect(() => {
        if (!activeConversationId) {
            setMessages([]);
            return;
        }

        async function loadMessages() {
            try {
                // Fetch using admin SDK action to bypass client-side listener limitations
                const { getMessagesAction } = await import("@/app/actions/messages");
                const result = await getMessagesAction(activeConversationId!, 100);
                if (result && result.messages) {
                    setMessages(result.messages);
                    scrollToBottom();
                }
            } catch (error) {
                console.error("Failed to fetch historical messages", error);
            }
        }

        loadMessages();
    }, [activeConversationId]);

    // Real-time listener for messages in active conversation
    useEffect(() => {
        if (!activeConversationId || !adminId || !isAuthed) return;

        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS, activeConversationId, "messages"),
            orderBy("timestamp", "desc"),
            limit(100)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate(),
            })) as Message[];
            setMessages(msgs.reverse());
            scrollToBottom();
        }, (error) => {
            console.error(`Admin support messages listener failed for conversation ${activeConversationId}:`, error);
        });

        return () => unsubscribe();
    }, [activeConversationId, adminId, isAuthed]);

    function scrollToBottom() {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
    }

    async function handleSendMessage() {
        if (!messageInput.trim() || !activeConversationId) return;

        setSending(true);
        try {
            const result = await sendMessageAction(activeConversationId, messageInput.trim());
            if (result && "success" in result && result.success) {
                setMessageInput("");
                scrollToBottom();
            } else {
                showToast((result as any)?.error || "Failed to send message", "error");
            }
        } catch {
            showToast("Failed to send message", "error");
        } finally {
            setSending(false);
        }
    }

    function formatTimestamp(date: Date | null | undefined) {
        if (!date) return "";
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days === 1) return "Yesterday";
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    }

    function getConversationLabel(conv: Conversation) {
        const details = conv.participantDetails;
        if (!details) return "User Conversation";
        return Object.values(details)
            .filter((p) => p.uid !== adminId)
            .map((p) => p.name || p.email || "Unknown User")
            .join(", ") || "Support Conversation";
    }

    function getLastMessageText(conv: Conversation): string {
        if (!conv.lastMessage) return "No messages yet";
        if (typeof conv.lastMessage === "string") return conv.lastMessage;
        if (typeof conv.lastMessage === "object" && "text" in conv.lastMessage) {
            return (conv.lastMessage as any).text || "No messages yet";
        }
        return "No messages yet";
    }

    function getLastMessageTime(conv: Conversation): Date | null {
        if (!conv.updatedAt) return null;
        if (conv.updatedAt instanceof Date) return conv.updatedAt;
        if ((conv.updatedAt as any)?.toDate) return (conv.updatedAt as any).toDate();
        return null;
    }

    const filtered = conversations.filter(conv => {
        const label = getConversationLabel(conv).toLowerCase();
        const lastMsg = getLastMessageText(conv).toLowerCase();
        return label.includes(searchQuery.toLowerCase()) || lastMsg.includes(searchQuery.toLowerCase());
    });

    const activeConversation = conversations.find(c => c.id === activeConversationId);

    return (
        <div className="h-screen flex flex-col bg-slate-950 text-white">
            {/* Top bar */}
            <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center gap-3 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                    <HeadphonesIcon size={18} className="text-blue-400" />
                </div>
                <div>
                    <h1 className="text-lg font-bold text-white">Support Inbox</h1>
                    <p className="text-xs text-slate-400">Live user conversations — respond in real time</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="px-3 py-1 bg-emerald-500/15 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/25">
                        {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* ── Conversation List ──────────────────────────────────────── */}
                <div className={`
                    w-80 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col
                    ${activeConversationId ? "hidden lg:flex" : "flex"}
                `}>
                    {/* Search */}
                    <div className="p-4 border-b border-slate-800">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search conversations..."
                                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 size={24} className="animate-spin text-blue-400" />
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-center py-12 px-4">
                                <Inbox size={40} className="text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-500 text-sm">No conversations yet</p>
                                <p className="text-slate-600 text-xs mt-1">User messages will appear here</p>
                            </div>
                        ) : (
                            filtered.map(conv => {
                                const isActive = conv.id === activeConversationId;
                                const label = getConversationLabel(conv);
                                const lastMsg = getLastMessageText(conv);
                                const lastTime = getLastMessageTime(conv);
                                return (
                                    <button
                                        key={conv.id}
                                        onClick={() => {
                                            setActiveConversationId(conv.id!);
                                            setShowMobileList(false);
                                        }}
                                        className={`w-full p-4 border-b border-slate-800/60 text-left transition-all duration-150
                                            ${isActive
                                                ? "bg-blue-600/10 border-l-2 border-l-blue-500"
                                                : "hover:bg-slate-800/50"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-9 h-9 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                                                <User size={14} className="text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <p className="font-semibold text-sm text-white truncate">{label}</p>
                                                    {lastTime && (
                                                        <span className="text-xs text-slate-500 shrink-0 ml-2">
                                                            {formatTimestamp(lastTime)}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-400 truncate">{lastMsg}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── Message Area ───────────────────────────────────────────── */}
                <div className={`
                    flex-1 flex flex-col bg-slate-950
                    ${!activeConversationId ? "hidden lg:flex" : "flex"}
                `}>
                    {activeConversationId ? (
                        <>
                            {/* Conversation Header */}
                            <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center gap-3">
                                <button
                                    className="lg:hidden text-slate-400 hover:text-white mr-1"
                                    onClick={() => setActiveConversationId(null)}
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <div className="w-9 h-9 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                                    <User size={14} className="text-white" />
                                </div>
                                <div className="flex-1">
                                    <h2 className="font-bold text-white text-sm">
                                        {activeConversation ? getConversationLabel(activeConversation) : "Conversation"}
                                    </h2>
                                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                                        Live — replies are instant
                                    </p>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                {messages.length === 0 ? (
                                    <div className="text-center py-12">
                                        <MessageCircle size={40} className="text-slate-700 mx-auto mb-3" />
                                        <p className="text-slate-500 text-sm">No messages yet in this conversation</p>
                                    </div>
                                ) : (
                                    messages.map(msg => {
                                        const isAdmin = msg.senderId === adminId;
                                        let ts: Date | null = null;
                                        if (msg.timestamp instanceof Date) {
                                            ts = msg.timestamp;
                                        } else if (typeof (msg.timestamp as any)?.toDate === 'function') {
                                            ts = (msg.timestamp as any).toDate();
                                        } else if (typeof msg.timestamp === 'string') {
                                            ts = new Date(msg.timestamp);
                                        }
                                        return (
                                            <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                                                {!isAdmin && (
                                                    <div className="w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center mr-2 shrink-0 mt-1">
                                                        <User size={12} className="text-white" />
                                                    </div>
                                                )}
                                                <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${isAdmin
                                                    ? "bg-blue-600 text-white rounded-br-sm"
                                                    : "bg-slate-800 text-slate-100 rounded-bl-sm"
                                                    }`}
                                                >
                                                    {!isAdmin && msg.senderName && (
                                                        <p className="text-xs font-semibold text-blue-400 mb-1">{msg.senderName}</p>
                                                    )}
                                                    <p className="text-sm whitespace-pre-wrap wrap-break-word leading-relaxed">{msg.text}</p>
                                                    <div className={`flex items-center gap-1 mt-1 ${isAdmin ? "justify-end" : ""}`}>
                                                        <Clock size={10} className={isAdmin ? "text-blue-200" : "text-slate-500"} />
                                                        <span className={`text-[10px] ${isAdmin ? "text-blue-200" : "text-slate-500"}`}>
                                                            {ts ? formatTimestamp(ts) : ""}
                                                        </span>
                                                        {isAdmin && msg.read && (
                                                            <CheckCheck size={12} className="text-blue-200 ml-1" />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div className="bg-slate-900 border-t border-slate-800 p-4">
                                <div className="flex items-end gap-3">
                                    <textarea
                                        rows={1}
                                        value={messageInput}
                                        onChange={e => setMessageInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        placeholder="Type your reply… (Enter to send, Shift+Enter for new line)"
                                        className="flex-1 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                        style={{ minHeight: "46px", maxHeight: "120px" }}
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!messageInput.trim() || sending}
                                        className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                    >
                                        {sending ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Send size={16} />
                                        )}
                                        <span className="hidden sm:inline">Reply</span>
                                    </button>
                                </div>
                                <p className="text-xs text-slate-600 mt-2 text-center">
                                    You are replying as <span className="text-blue-400 font-semibold">Admin Support</span> — the user sees your name
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <HeadphonesIcon size={64} className="text-slate-800 mx-auto mb-4" />
                                <p className="text-slate-400 font-semibold text-lg">Select a conversation</p>
                                <p className="text-slate-600 text-sm mt-1">Choose a user conversation from the left to respond</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
