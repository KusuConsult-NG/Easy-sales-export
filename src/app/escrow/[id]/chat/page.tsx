"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Send, Loader2, MessageCircle, ArrowLeft, Shield } from "lucide-react";
import { sendEscrowMessageAction, getEscrowMessagesAction, getEscrowTransactionByIdAction, type EscrowTransaction } from "@/app/actions/escrow";
import type { Message } from "@/app/actions/escrow";

interface EscrowChatPageProps {
    params: { id: string };
}

export default function EscrowChatPage({ params }: EscrowChatPageProps) {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [escrowData, setEscrowData] = useState<EscrowTransaction | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const escrowId = params.id;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    // Load escrow data and verify authorization
    useEffect(() => {
        async function checkAuthorization() {
            if (status !== "authenticated" || !session?.user) return;

            const result = await getEscrowTransactionByIdAction(escrowId);
            if (result.success && result.data) {
                const isBuyer = result.data.buyerId === session.user.id;
                const isSeller = result.data.sellerId === session.user.id;

                if (isBuyer || isSeller) {
                    setEscrowData(result.data);
                    setAuthorized(true);
                } else {
                    alert("You are not authorized to view this chat");
                    router.push("/escrow");
                }
            } else {
                alert(result.error || "Escrow transaction not found");
                router.push("/escrow");
            }
        }
        checkAuthorization();
    }, [status, session, escrowId, router]);

    // Load messages on mount and every 3 seconds
    useEffect(() => {
        if (status !== "authenticated") return;

        loadMessages();

        const interval = setInterval(() => {
            loadMessages();
        }, 3000); // Poll every 3 seconds

        return () => clearInterval(interval);
    }, [status, escrowId]);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    async function loadMessages() {
        try {
            const fetchedMessages = await getEscrowMessagesAction(escrowId);
            setMessages(fetchedMessages);
            setLoading(false);
        } catch (error) {
            console.error("Failed to load messages:", error);
            setLoading(false);
        }
    }

    async function handleSendMessage(e: React.FormEvent) {
        e.preventDefault();

        if (!newMessage.trim() || !session?.user) return;

        setSending(true);

        const result = await sendEscrowMessageAction({
            escrowId,
            senderId: session.user.id,
            senderName: session.user.name || session.user.email || "Unknown",
            message: newMessage.trim(),
        });

        if (result.success) {
            setNewMessage("");
            await loadMessages(); // Refresh messages
        } else {
            alert(result.error || "Failed to send message");
        }

        setSending(false);
    }

    function scrollToBottom() {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    function formatTime(timestamp: any): string {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function formatDate(timestamp: any): string {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const today = new Date();
        const messageDate = new Date(date);

        // Check if message is from today
        if (
            messageDate.getDate() === today.getDate() &&
            messageDate.getMonth() === today.getMonth() &&
            messageDate.getFullYear() === today.getFullYear()
        ) {
            return "Today";
        }

        // Check if message is from yesterday
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (
            messageDate.getDate() === yesterday.getDate() &&
            messageDate.getMonth() === yesterday.getMonth() &&
            messageDate.getFullYear() === yesterday.getFullYear()
        ) {
            return "Yesterday";
        }

        return messageDate.toLocaleDateString();
    }

    // Group messages by date
    function groupMessagesByDate(messages: Message[]) {
        const groups: { date: string; messages: Message[] }[] = [];
        let currentDate = "";

        messages.forEach((message) => {
            const messageDate = formatDate(message.timestamp);

            if (messageDate !== currentDate) {
                currentDate = messageDate;
                groups.push({ date: messageDate, messages: [message] });
            } else {
                groups[groups.length - 1].messages.push(message);
            }
        });

        return groups;
    }

    const isMyMessage = (message: Message) => message.senderId === session?.user?.id;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col">
            {/* Header */}
            <div className="bg-white/10 backdrop-blur-xl border-b border-white/20 px-6 py-4">
                <div className="max-w-4xl mx-auto flex items-center space-x-4">
                    <button
                        onClick={() => router.push("/escrow")}
                        className="p-2 hover:bg-white/10 rounded-lg transition"
                    >
                        <ArrowLeft className="w-5 h-5 text-blue-200" />
                    </button>
                    <div className="flex items-center space-x-3 flex-1">
                        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
                            <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-white">Escrow Chat</h1>
                            <p className="text-sm text-blue-200">Transaction #{escrowId.slice(0, 8)}</p>
                        </div>
                    </div>
                    <div className="text-xs text-blue-300 bg-blue-500/20 px-3 py-1 rounded-full">
                        Secure Messaging
                    </div>
                </div>
            </div>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="max-w-4xl mx-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-blue-300 animate-spin" />
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="text-center py-20">
                            <MessageCircle className="w-16 h-16 text-blue-300 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">No messages yet</h3>
                            <p className="text-blue-200">Start the conversation by sending a message below</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {groupMessagesByDate(messages).map((group, groupIndex) => (
                                <div key={groupIndex}>
                                    {/* Date Divider */}
                                    <div className="flex items-center justify-center mb-4">
                                        <div className="bg-white/10 backdrop-blur-sm px-4 py-1 rounded-full">
                                            <span className="text-sm text-blue-200">{group.date}</span>
                                        </div>
                                    </div>

                                    {/* Messages for this date */}
                                    <div className="space-y-4">
                                        {group.messages.map((message) => (
                                            <div
                                                key={message.id}
                                                className={`flex ${isMyMessage(message) ? "justify-end" : "justify-start"
                                                    }`}
                                            >
                                                <div
                                                    className={`max-w-[70%] ${isMyMessage(message)
                                                        ? "bg-blue-500 text-white"
                                                        : "bg-white/10 backdrop-blur-xl border border-white/20 text-white"
                                                        } rounded-2xl px-4 py-3`}
                                                >
                                                    {/* Sender Name (only for other's messages) */}
                                                    {!isMyMessage(message) && (
                                                        <div className="text-xs text-blue-300 mb-1 font-medium">
                                                            {message.senderName}
                                                        </div>
                                                    )}

                                                    {/* Message Text */}
                                                    <p className="text-sm break-words">{message.message}</p>

                                                    {/* Timestamp */}
                                                    <div
                                                        className={`text-xs mt-1 ${isMyMessage(message) ? "text-blue-100" : "text-blue-300"
                                                            }`}
                                                    >
                                                        {formatTime(message.timestamp)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>
            </div>

            {/* Message Input */}
            <div className="bg-white/10 backdrop-blur-xl border-t border-white/20 px-6 py-4">
                <div className="max-w-4xl mx-auto">
                    <form onSubmit={handleSendMessage} className="flex items-center space-x-3">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type your message..."
                            disabled={sending}
                            maxLength={1000}
                            className="flex-1 px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={!newMessage.trim() || sending}
                            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-xl font-medium transition flex items-center space-x-2"
                        >
                            {sending ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <Send className="w-5 h-5" />
                                    <span>Send</span>
                                </>
                            )}
                        </button>
                    </form>
                    <div className="mt-2 text-xs text-blue-300 text-center">
                        Messages are monitored for security. Be professional and respectful.
                    </div>
                </div>
            </div>
        </div>
    );
}
