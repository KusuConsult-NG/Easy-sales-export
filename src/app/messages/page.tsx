"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isSessionExpired } from '@/lib/session-expiry-code';
import { MessageSquare, Search, Plus, Send, Loader2 } from "lucide-react";
import { getConversationsAction, getMessagesAction, sendMessageAction, startConversationAction, searchUsersAction, markAsReadAction, startSupportConversationAction } from "@/app/actions/messages";
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { format } from "date-fns";
import { useToast } from "@/contexts/ToastContext";
import { toMillis } from "@/lib/firestore-serialize";

export default function MessagesPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const defaultConv = searchParams.get("conversation");
    
    const userId = session?.user?.id;

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<string | null>(defaultConv);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showNewChat, setShowNewChat] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    /**
     * Why the conversation list needs an error of its own — #310.
     *
     * getConversationsAction returns { error, conversations: [] } when it
     * fails, and the poll below guarded on `if (result.conversations)`, which
     * is TRUE for an empty array. So a failed load replaced whatever the user
     * had with nothing and the screen said "No conversations yet" — the same
     * "a failed list looked like an empty one" shape as #307, on the screen
     * where an unread message from an admin is the thing being hidden.
     *
     * A toast is wrong here: this polls every eight seconds and would stack up
     * one per tick. The list keeps what it has and says why it is stale.
     */
    const [listError, setListError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
    };

    // Load conversations on mount using Polling
    useEffect(() => {
        if (!userId) return;

        let isMounted = true;
        async function fetchConversations() {
            try {
                const result = await getConversationsAction();
                if (!isMounted) return;
                if (result.error) {
                    // Keep the list. See listError above.
                    setListError(result.error);
                    return;
                }
                setListError(null);
                setConversations(result.conversations ?? []);
            } catch (err) {
                console.error("Messages page conversations poll failed:", err);
                if (isMounted) setListError("Could not reach the server.");
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        fetchConversations();
        const interval = setInterval(fetchConversations, 8000); // Poll every 8 seconds

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [userId]);

    // Load messages for selected conversation using Polling
    useEffect(() => {
        if (!selectedConv || !userId) {
            if (!selectedConv) setMessages([]);
            return;
        }

        let isMounted = true;
        async function loadMessages() {
            try {
                const result = await getMessagesAction(selectedConv!);
                if (isMounted && result.messages) {
                    // Sort chronologically
                    const sorted = [...result.messages].sort((a, b) => {
                        // toMillis handles both shapes. This was
                        // new Date(x.timestamp).getTime(), which is NaN when
                        // the value is a Timestamp object rather than the ISO
                        // string serializeDocs produces — and a comparator
                        // returning NaN leaves the order undefined.
                        return toMillis(a.timestamp) - toMillis(b.timestamp);
                    });

                    setMessages(prev => {
                        if (JSON.stringify(prev) !== JSON.stringify(sorted)) {
                            const shouldScroll = prev.length !== sorted.length || 
                                (prev.length > 0 && prev[prev.length - 1].id !== sorted[sorted.length - 1].id);
                            if (shouldScroll) {
                                setTimeout(scrollToBottom, 50);
                            }
                            return sorted;
                        }
                        return prev;
                    });
                }

                // Mark as read. The result was discarded entirely; a refusal
                // left the badge showing unread with nothing anywhere saying
                // why. Not a toast — this runs every three seconds.
                const readResult = await markAsReadAction(selectedConv!);
                if (readResult?.error) {
                    console.error("[messages] the conversation was not marked read:", readResult.error);
                }
            } catch (err) {
                console.error("Messages page messages poll failed:", err);
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        loadMessages();
        const interval = setInterval(loadMessages, 3000); // Poll every 3 seconds for messages

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [selectedConv, userId]);

    // Handle send message
    async function handleSend() {
        if (!newMessage.trim() || !selectedConv || sending) return;

        setSending(true);
        try {
            const result = await sendMessageAction(selectedConv, newMessage);
            if (result && typeof result === 'object' && result.success) {
                setNewMessage("");
                scrollToBottom();
            } else {
                showToast((result as any)?.error || "Failed to send message", "error");
            }
        } catch (error: any) {
            showToast(error.message || "An unexpected error occurred", "error");
        } finally {
            setSending(false);
        }
    };

    // Handle user search
    async function handleSearch(query: string) {
        setSearchQuery(query);
        setSearching(true);
        const result = await searchUsersAction(query);
        if (isSessionExpired(result)) {
            setSearching(false);
            return;
        }
        if (result.error) {
            // Was: `result.users` guarded the write, and a failed search
            // returns users: [], so the panel showed "no matches" for a search
            // that never ran.
            setSearchResults([]);
            showToast(result.error, "error");
        } else {
            setSearchResults(result.users ?? []);
        }
        setSearching(false);
    }

    // Call search with empty query when opening New Chat to load default Admins
    const toggleNewChat = () => {
        const nextState = !showNewChat;
        setShowNewChat(nextState);
        if (nextState) {
            handleSearch("");
        }
    };

    // Start new conversation
    async function handleStartConversation(userUid: string) {
        const result = await startConversationAction(userUid);
        if (isSessionExpired(result)) return;
        if (!result.conversationId) {
            // The reason existed and was thrown away. cooperatives/directory
            // shows it on this same action; this screen did not.
            showToast(result.error || "Failed to start conversation", "error");
            return;
        }

        setSelectedConv(result.conversationId);
        setShowNewChat(false);
        setSearchQuery("");
        setSearchResults([]);

        // Reload conversations. A failure here is not worth a toast — the
        // conversation was created and the eight-second poll will bring it in
        // — but it must not blank the list either.
        const convResult = await getConversationsAction();
        if (!isSessionExpired(convResult) && !convResult.error) {
            setConversations(convResult.conversations ?? []);
        }
    };

    // Start Support conversation
    async function handleStartSupportConversation() {
        setSearching(true);
        const result = await startSupportConversationAction();
        setSearching(false);
        if (isSessionExpired(result)) return;
        if (!result.conversationId) {
            // THE one that matters most. startSupportConversationAction
            // returns "No admin available currently" and "You are the primary
            // admin" — real, specific, actionable answers — and "Contact Admin
            // Support" discarded all of them, so the button did nothing at all
            // and the member clicked it again.
            showToast(result.error || "Failed to contact support", "error");
            return;
        }

        setSelectedConv(result.conversationId);
        setShowNewChat(false);
        setSearchQuery("");
        setSearchResults([]);

        const convResult = await getConversationsAction();
        if (!isSessionExpired(convResult) && !convResult.error) {
            setConversations(convResult.conversations ?? []);
        }
    };

    // Get other participant
    const getOtherParticipant = (conv: Conversation) => {
        const otherUid = conv.participants.find(p => p !== session?.user?.id);
        return otherUid ? conv.participantDetails[otherUid] : null;
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="h-screen flex bg-slate-50">
            {/* Conversations List */}
            <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900">Messages</h2>
                        <button
                            onClick={toggleNewChat}
                            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                            <Plus className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    {showNewChat && (
                        <div className="mb-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    placeholder="Search users..."
                                    className="w-full pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <button
                                onClick={handleStartSupportConversation}
                                className="w-full mt-3 p-3 bg-blue-50 text-blue-700 font-semibold rounded-lg hover:bg-blue-100 transition-colors text-sm text-center"
                            >
                                Contact Admin Support
                            </button>

                            {searching && <div className="mt-2 text-sm text-slate-500">Searching...</div>}

                            {searchResults.length > 0 && (
                                <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
                                    {searchResults.map(user => (
                                        <button
                                            key={user.uid}
                                            onClick={() => handleStartConversation(user.uid)}
                                            className="w-full p-3 rounded-lg hover:bg-slate-100 text-left transition-colors"
                                        >
                                            <div className="font-medium text-slate-900">{user.fullName}</div>
                                            <div className="text-xs text-slate-500">{user.email}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {listError && (
                        <div className="m-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                            This list may be out of date — {listError}
                        </div>
                    )}
                    {conversations.length === 0 && !listError ? (
                        <div className="p-8 text-center text-slate-500 text-sm">
                            No conversations yet. Click + to start chatting.
                        </div>
                    ) : (
                        conversations.map(conv => {
                            const other = getOtherParticipant(conv);
                            const isSelected = selectedConv === conv.id;

                            return (
                                <button
                                    key={conv.id}
                                    onClick={() => setSelectedConv(conv.id)}
                                    className={`w-full p-4 border-b border-slate-100 text-left hover:bg-slate-50 transition-colors ${isSelected ? "bg-blue-50" : ""
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                                            {/* `other?.name.charAt(0) || "U"` — the optional chain
                                                covered `other` and not `name`, so a participant
                                                entry without a name THREW rather than falling back,
                                                and the whole list went with it. The "U" was
                                                unreachable: `.charAt` on undefined raises before
                                                `||` is ever evaluated. The line below has the
                                                guarded form already. */}
                                            {other?.name?.charAt(0).toUpperCase() || "U"}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-slate-900 truncate">
                                                {other?.name || "User"}
                                            </div>
                                            <div className="text-sm text-slate-500 truncate">
                                                {conv.lastMessage?.text || "No messages yet"}
                                            </div>
                                        </div>
                                        {/* ONE UNREADABLE TIMESTAMP TOOK THE WHOLE LIST DOWN.
                                            This was a hand-rolled two-branch shape test whose
                                            else-branch did `format(new Date(timestamp), ...)`.
                                            date-fns `format` THROWS RangeError on an Invalid
                                            Date, so a single conversation with a missing or
                                            unparseable lastMessage.timestamp crashed the render
                                            of every conversation — #130's shape, on a field
                                            #18 and #49 already established this codebase stores
                                            in more than one shape.

                                            toMillis is the canonical normaliser, imported at the
                                            top of this file and used by the message sort at line
                                            107 — it handles Date, number, string, .toDate() and
                                            _seconds/_nanoseconds, and returns 0 for anything it
                                            cannot read. 0 hides the time rather than printing a
                                            confident 01:00 from the epoch. */}
                                        {toMillis(conv.lastMessage?.timestamp) > 0 && (
                                            <div className="text-xs text-slate-400">
                                                {format(new Date(toMillis(conv.lastMessage?.timestamp)), "HH:mm")}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Message Thread */}
            <div className="flex-1 flex flex-col">
                {!selectedConv ? (
                    <div className="flex-1 flex items-center justify-center bg-slate-50">
                        <div className="text-center">
                            <MessageSquare className="w-20 h-20 mx-auto text-slate-300 mb-4" />
                            <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                {conversations.length === 0 ? "Welcome to Messages" : "Select a conversation"}
                            </h3>
                            <p className="text-slate-500">
                                {conversations.length === 0 
                                    ? "Start a new conversation using the + button."
                                    : "Choose a chat from the list or start a new conversation"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-slate-200 bg-white">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                                    {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.name.charAt(0).toUpperCase() || "U"}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">
                                        {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.name || "User"}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.email}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                            {messages.map(msg => {
                                const isOwnMessage = msg.senderId === session?.user?.id;

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                                    >
                                        <div className={`max-w-md px-4 py-2 rounded-2xl ${isOwnMessage
                                            ? "bg-blue-600 text-white"
                                            : "bg-white text-slate-900"
                                            }`}>
                                            {!isOwnMessage && (
                                                <div className="text-xs font-medium mb-1 opacity-70">
                                                    {msg.senderName}
                                                </div>
                                            )}
                                            <div>{msg.text}</div>
                                            <div className={`text-xs mt-1 ${isOwnMessage ? "text-blue-100" : "text-slate-400"}`}>
                                                {msg.timestamp ? (
                                                    typeof (msg.timestamp as any).toDate === 'function' ?
                                                        format((msg.timestamp as any).toDate(), "HH:mm") :
                                                        format(new Date(msg.timestamp as unknown as (string | number)), "HH:mm")
                                                ) : "Now"}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-slate-200 bg-white">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyPress={(e) => e.key === "Enter" && handleSend()}
                                    placeholder="Type a message..."
                                    disabled={sending}
                                    className="flex-1 px-4 py-2 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!newMessage.trim() || sending}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
