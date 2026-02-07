"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    MessageCircle,
    Send,
    Loader2,
    User,
    Package,
    ShoppingCart,
    Search,
} from "lucide-react";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Conversation, Message } from "@/lib/types/marketplace";
import {
    sendMessageAction,
    markMessagesAsReadAction,
    getConversationsAction,
} from "@/app/actions/messaging";
import { useToast } from "@/contexts/ToastContext";

function MessagesPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const { showToast } = useToast();

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageInput, setMessageInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const userId = session?.user?.id;

    // Auto-select conversation from URL params
    useEffect(() => {
        const conversationId = searchParams.get("conversation");
        if (conversationId && conversations.length > 0) {
            setActiveConversationId(conversationId);
        }
    }, [searchParams, conversations]);

    // Load initial conversations
    useEffect(() => {
        if (!userId) return;
        loadConversations();
    }, [userId]);

    // Real-time listener for conversations
    useEffect(() => {
        if (!userId) return;

        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId),
            orderBy("lastMessageAt", "desc"),
            limit(50)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const convs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                updatedAt: doc.data().updatedAt?.toDate(),
                lastMessageAt: doc.data().lastMessageAt?.toDate(),
            })) as Conversation[];

            setConversations(convs);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [userId]);

    // Real-time listener for messages in active conversation
    useEffect(() => {
        if (!activeConversationId) return;

        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS, activeConversationId, "messages"),
            orderBy("createdAt", "desc"),
            limit(50)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                readAt: doc.data().readAt?.toDate(),
            })) as Message[];

            setMessages(msgs.reverse()); // Oldest first
            scrollToBottom();
        });

        // Mark messages as read when opening conversation
        markMessagesAsReadAction(activeConversationId);

        return () => unsubscribe();
    }, [activeConversationId]);

    async function loadConversations() {
        const result = await getConversationsAction();
        if (result.success) {
            setConversations(result.conversations || []);
        }
        setLoading(false);
    }

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
            if (result.success) {
                setMessageInput("");
                scrollToBottom();
            } else {
                showToast(result.error || "Failed to send message", "error");
            }
        } catch (error) {
            showToast("Failed to send message", "error");
        } finally {
            setSending(false);
        }
    }

    function formatTimestamp(date: Date) {
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

    const activeConversation = conversations.find(c => c.id === activeConversationId);
    const recipientId = activeConversation?.participants.find(id => id !== userId);

    const filteredConversations = conversations.filter(conv =>
        conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!userId) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <p className="text-gray-500">Please sign in to view messages</p>
            </div>
        );
    }

    return (
        <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <MessageCircle className="w-7 h-7 text-primary" />
                    Messages
                </h1>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Conversations Sidebar */}
                <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                    {/* Search */}
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search conversations..."
                                className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>

                    {/* Conversation List */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            </div>
                        ) : filteredConversations.length > 0 ? (
                            filteredConversations.map((conversation) => {
                                const unreadCount = conversation.unreadCount?.[userId] || 0;
                                const isActive = conversation.id === activeConversationId;

                                return (
                                    <button
                                        key={conversation.id}
                                        onClick={() => setActiveConversationId(conversation.id)}
                                        className={`w-full p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition text-left ${isActive ? "bg-primary/5 border-l-4 border-l-primary" : ""
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                <User className="w-5 h-5 text-primary" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="font-semibold text-gray-900 dark:text-white truncate">
                                                        {conversation.productId ? "Product Inquiry" : "Order Support"}
                                                    </p>
                                                    {unreadCount > 0 && (
                                                        <span className="ml-2 px-2 py-0.5 bg-primary text-white text-xs font-bold rounded-full">
                                                            {unreadCount}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-600 dark:text-gray-400 truncate mb-1">
                                                    {conversation.lastMessage || "No messages yet"}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {formatTimestamp(conversation.lastMessageAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 px-4">
                                <MessageCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                                <p className="text-gray-500 text-sm">No conversations yet</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 flex flex-col bg-white dark:bg-gray-800">
                    {activeConversationId ? (
                        <>
                            {/* Conversation Header */}
                            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <h2 className="font-bold text-gray-900 dark:text-white">
                                        {activeConversation?.productId ? "Product Inquiry" : "Order Support"}
                                    </h2>
                                    {activeConversation?.productId && (
                                        <p className="text-sm text-gray-500 flex items-center gap-1">
                                            <Package className="w-3 h-3" />
                                            Product conversation
                                        </p>
                                    )}
                                    {activeConversation?.orderId && (
                                        <p className="text-sm text-gray-500 flex items-center gap-1">
                                            <ShoppingCart className="w-3 h-3" />
                                            Order conversation
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                {messages.map((message) => {
                                    const isOwnMessage = message.senderId === userId;
                                    return (
                                        <div
                                            key={message.id}
                                            className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                                        >
                                            <div
                                                className={`max-w-[70%] rounded-2xl px-4 py-2 ${isOwnMessage
                                                    ? "bg-primary text-white"
                                                    : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                                                    }`}
                                            >
                                                <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                                                <p
                                                    className={`text-xs mt-1 ${isOwnMessage ? "text-primary-100" : "text-gray-500"
                                                        }`}
                                                >
                                                    {formatTimestamp(message.createdAt)}
                                                    {isOwnMessage && message.read && " • Read"}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Message Input */}
                            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="text"
                                        value={messageInput}
                                        onChange={(e) => setMessageInput(e.target.value)}
                                        onKeyPress={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        placeholder="Type a message..."
                                        className="flex-1 px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!messageInput.trim() || sending}
                                        className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {sending ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <Send className="w-5 h-5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500 text-lg">Select a conversation to start messaging</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function MessagesPagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <MessagesPageContent />
        </Suspense>
    );
}
