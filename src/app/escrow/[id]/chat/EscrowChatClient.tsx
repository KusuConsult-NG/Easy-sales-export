"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from '@/lib/logger';
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Send, Loader2, MessageCircle, ArrowLeft, Shield } from "lucide-react";
import { sendEscrowMessageAction, getEscrowMessagesAction, getEscrowTransactionByIdAction, type EscrowTransaction } from "@/app/actions/marketplace";
import type { Message } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";
import { startVisibilityAwareInterval } from "@/hooks/usePolling";
import { useServerSeed } from "@/hooks/useServerSeed";

/**
 * What the server read before the page was sent.
 *
 * Both halves of the screen: the escrow row — which is also what decides
 * whether this viewer may see the chat at all — and the first page of messages.
 * The AUTHORISATION is deliberately not decided here; the client compares the
 * row against its own session, exactly as it did.
 */
export type EscrowChatSeed = {
    escrow: Awaited<ReturnType<typeof getEscrowTransactionByIdAction>>;
    messages: Awaited<ReturnType<typeof getEscrowMessagesAction>>;
};

interface EscrowChatClientProps {
    /**
     *   #560 The ID, RESOLVED, not the params promise.
     *
     *   This was `params: Promise<{id}>` unwrapped here with React's `use`,
     *   which is what a client page had to do. The server half now awaits
     *   params itself before rendering, so handing the promise down for this
     *   component to await a second time only made it suspend for no reason.
     */
    escrowId: string;
    initial?: EscrowChatSeed | null;
}

export default function EscrowChatClient({ escrowId, initial = null }: EscrowChatClientProps) {

    //   #560 — the server made both reads. Two take-once seeds, because two
    //   separate effects consume them and the message poll must keep polling.
    const takeEscrow = useServerSeed(initial?.escrow ?? null);
    const takeMessages = useServerSeed(initial?.messages ?? null);

    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [escrowData, setEscrowData] = useState<EscrowTransaction | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    // Load escrow data and verify authorization
    useEffect(() => {
        async function checkAuthorization() {
            if (status !== "authenticated" || !session?.user) return;

            const result = takeEscrow() ?? await getEscrowTransactionByIdAction(escrowId);
            if (result.success) {
                const escrow = result.data;
                const isBuyer = escrow?.buyerId === session.user.id;
                const isSeller = escrow?.sellerId === session.user.id;
                const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

                if (isBuyer || isSeller || isAdminUser) {
                    setEscrowData(escrow);
                    setAuthorized(true);
                } else {
                    showToast("You are not authorized to view this chat", "error");
                    router.push("/escrow");
                }
            } else {
                showToast(result.error || "Escrow transaction not found", "error");
                router.push("/escrow");
            }
        }
        checkAuthorization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session, escrowId, router, takeEscrow]);

    const loadMessages = useCallback(async () => {
        try {
            const result = takeMessages() ?? await getEscrowMessagesAction(escrowId);
            setTimeout(() => {
                if (result.success && result.data) {
                    setMessages(result.data);
                }
                setLoading(false);
            }, 0);
        } catch (error) {
            logger.error("Failed to load messages:", error);
            setTimeout(() => setLoading(false), 0);
        }
    }, [escrowId, takeMessages]);

    function scrollToBottom() {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // Load messages on mount and every 5 seconds
    useEffect(() => {
        if (status !== "authenticated") return;

        /**
         *   THE IMMEDIATE TICK STAYS, AND THAT IS THE POINT.
         *
         *   #558 had to suppress the first tick on /dashboard/notifications,
         *   because there the seed goes into useState and the poller's own
         *   `load` would have fetched anyway — re-asking the server, 0ms after
         *   hydrating, for what it had just sent with the page.
         *
         *   Here the seed goes INTO the loader. So the immediate tick costs
         *   nothing: it consumes the seed and paints, with no round trip, and
         *   the first real read happens five seconds later.
         *
         *   Suppressing it would be the bug — the seed is only consumed when
         *   loadMessages runs, so `immediate: false` would leave a seeded chat
         *   showing a spinner for five seconds.
         *
         *   #545 Paused while the tab is hidden. An escrow chat left open in
         *   a background tab polled every five seconds indefinitely.
         */
        return startVisibilityAwareInterval(loadMessages, 5000);
    }, [status, loadMessages]);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    async function handleSendMessage(e: React.FormEvent) {
        e.preventDefault();

        if (!newMessage.trim() || !session?.user) return;

        setSending(true);

        // #407. setSending(false) sat after the await with no try, so a rejected
        // promise left the send button dead in an escrow dispute conversation —
        // the one channel where a buyer and seller argue about money.
        try {
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
                showToast(result.error || "Failed to send message", "error");
            }
        } catch {
            // The draft is deliberately NOT cleared here: the message may not
            // have been delivered, and clearing it would lose what was typed.
            showToast("Could not send the message. Check your connection and try again.", "error");
        } finally {
            setSending(false);
        }
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

    /**
     * Group messages by date.
     *
     *   #561 ONE MESSAGE WITHOUT A TIMESTAMP TOOK THE WHOLE CHAT DOWN.
     *
     *   `currentDate` started as the empty string, and formatDate RETURNS the
     *   empty string for a missing or unparseable timestamp — its own first
     *   line is `if (!timestamp) return ""`. So for a first message with no
     *   timestamp, `messageDate !== currentDate` was false, the else branch ran
     *   with no group yet created, and `groups[-1].messages` threw. Not a blank
     *   row: a TypeError during render, so the buyer and seller arguing about
     *   money got a blank screen instead of the conversation.
     *
     *   `null` is a starting value no formatDate output can equal, so the first
     *   message always opens a group. Undated messages then group together
     *   under an empty heading, which is what the rest of this function was
     *   already written to do.
     *
     *   Found while writing #560's tests, from a fixture that happened to use
     *   the wrong field name — which is exactly the shape a real row takes when
     *   a writer forgets one.
     */
    function groupMessagesByDate(messages: Message[]) {
        const groups: { date: string; messages: Message[] }[] = [];
        let currentDate: string | null = null;

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
                    {session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin") ? (
                        <div className="text-xs text-red-300 bg-red-500/20 px-3 py-1 rounded-full font-semibold">
                            Admin Mode
                        </div>
                    ) : (
                        <div className="text-xs text-blue-300 bg-blue-500/20 px-3 py-1 rounded-full">
                            Secure Messaging
                        </div>
                    )}
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
                                                    <p className="text-sm wrap-break-word">{message.message}</p>

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
