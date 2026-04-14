"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isSessionExpired } from '@/lib/session-expiry-code';
import { MessageSquare, Search, Plus, Send, Loader2 } from "lucide-react";
import { getConversationsAction, getMessagesAction, sendMessageAction, startConversationAction, searchUsersAction, markAsReadAction } from "@/app/actions/messages";
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { format } from "date-fns";

export default function MessagesPage() {
    const { data: session } = useSession();
    const searchParams = useSearchParams();
    const defaultConv = searchParams.get("conversation");
    
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

    // Load conversations on mount
    useEffect(() => {
        async function loadConversations() {
            setLoading(true);
            const result = await getConversationsAction();
            if (!isSessionExpired(result) && result.conversations) {
                setConversations(result.conversations as Conversation[]);
                if (defaultConv && !result.conversations.find((c: any) => c.id === defaultConv)) {
                    // Start an additional fetch for the requested conversation if it's new
                }
            }
            setLoading(false);
        }

        if (session?.user) {
            loadConversations();
        }
    }, [session, defaultConv]);

    // Load messages for selected conversation
    useEffect(() => {
        if (!selectedConv) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setMessages([]);
            return;
        }

        async function loadMessages() {
            const result = await getMessagesAction(selectedConv!);
            if (!isSessionExpired(result) && result.messages) {
                setMessages(result.messages);
            }

            // Mark as read
            await markAsReadAction(selectedConv!);
        }

        loadMessages();

        // Set up real-time listener
        const messagesRef = collection(db, `conversations/${selectedConv}/messages`);
        const q = query(messagesRef, orderBy("timestamp", "desc"), limit(50));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newMessages: Message[] = [];
            snapshot.forEach((doc) => {
                newMessages.push({ id: doc.id, ...doc.data() } as Message);
            });
            setMessages(newMessages.reverse());
        });

        return () => unsubscribe();
    }, [selectedConv]);

    // Handle send message
    async function handleSend() {
        if (!newMessage.trim() || !selectedConv || sending) return;

        setSending(true);
        const result = await sendMessageAction(selectedConv, newMessage);
        if (result.success) {
            setNewMessage("");
        }
        setSending(false);
    };

    // Handle user search
    const handleSearch = async (query: string) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        const result = await searchUsersAction(query);
        if (!isSessionExpired(result) && result.users) {
            setSearchResults(result.users);
        }
        setSearching(false);
    };

    // Start new conversation
    const handleStartConversation = async (userUid: string) => {
        const result = await startConversationAction(userUid);
        if (!isSessionExpired(result) && result.conversationId) {
            setSelectedConv(result.conversationId);
            setShowNewChat(false);
            setSearchQuery("");
            setSearchResults([]);

            // Reload conversations
            const convResult = await getConversationsAction();
            if (!isSessionExpired(convResult) && convResult.conversations) {
                setConversations(convResult.conversations);
            }
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
                            onClick={() => setShowNewChat(!showNewChat)}
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
                    {conversations.length === 0 ? (
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
                                            {other?.name.charAt(0).toUpperCase() || "U"}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-slate-900 truncate">
                                                {other?.name || "User"}
                                            </div>
                                            <div className="text-sm text-slate-500 truncate">
                                                {conv.lastMessage?.text || "No messages yet"}
                                            </div>
                                        </div>
                                        {conv.lastMessage && (
                                            <div className="text-xs text-slate-400">
                                                {typeof (conv.lastMessage.timestamp as any)?.toDate === 'function' ?
                                                    format((conv.lastMessage.timestamp as any).toDate(), "HH:mm") :
                                                    format(new Date(conv.lastMessage.timestamp as any), "HH:mm")
                                                }
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
                                                        format(new Date(msg.timestamp), "HH:mm")
                                                ) : "Now"}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
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
