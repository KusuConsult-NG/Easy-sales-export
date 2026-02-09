"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { MessageSquare, Search, Plus, Send, Loader2 } from "lucide-react";
import { getConversationsAction, getMessagesAction, sendMessageAction, startConversationAction, searchUsersAction, markAsReadAction } from "@/app/actions/messages";
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, limit, onSnapshot, doc } from "firebase/firestore";
import { format } from "date-fns";

export default function MessagesPage() {
    const { data: session } = useSession();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<string | null>(null);
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
            if (result.conversations) {
                setConversations(result.conversations);
            }
            setLoading(false);
        }

        if (session?.user) {
            loadConversations();
        }
    }, [session]);

    // Load messages for selected conversation
    useEffect(() => {
        if (!selectedConv) {
            setMessages([]);
            return;
        }

        async function loadMessages() {
            const result = await getMessagesAction(selectedConv!);
            if (result.messages) {
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
    const handleSend = async () => {
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
        if (result.users) {
            setSearchResults(result.users);
        }
        setSearching(false);
    };

    // Start new conversation
    const handleStartConversation = async (userUid: string) => {
        const result = await startConversationAction(userUid);
        if (result.conversationId) {
            setSelectedConv(result.conversationId);
            setShowNewChat(false);
            setSearchQuery("");
            setSearchResults([]);

            // Reload conversations
            const convResult = await getConversationsAction();
            if (convResult.conversations) {
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
        <div className="h-screen flex bg-slate-50 dark:bg-slate-950">
            {/* Conversations List */}
            <div className="w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Messages</h2>
                        <button
                            onClick={() => setShowNewChat(!showNewChat)}
                            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <Plus className="w-5 h-5 text-slate-600 dark:text-slate-400" />
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
                                    className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            {searching && <div className="mt-2 text-sm text-slate-500">Searching...</div>}

                            {searchResults.length > 0 && (
                                <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
                                    {searchResults.map(user => (
                                        <button
                                            key={user.uid}
                                            onClick={() => handleStartConversation(user.uid)}
                                            className="w-full p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors"
                                        >
                                            <div className="font-medium text-slate-900 dark:text-white">{user.fullName}</div>
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
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
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
                                    className={`w-full p-4 border-b border-slate-100 dark:border-slate-800 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                                            {other?.name.charAt(0).toUpperCase() || "U"}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-slate-900 dark:text-white truncate">
                                                {other?.name || "User"}
                                            </div>
                                            <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                                                {conv.lastMessage?.text || "No messages yet"}
                                            </div>
                                        </div>
                                        {conv.lastMessage && (
                                            <div className="text-xs text-slate-400">
                                                {format(conv.lastMessage.timestamp.toDate(), "HH:mm")}
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
                    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                        <div className="text-center">
                            <MessageSquare className="w-20 h-20 mx-auto text-slate-300 dark:text-slate-700 mb-4" />
                            <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Select a conversation
                            </h3>
                            <p className="text-slate-500 dark:text-slate-400">
                                Choose a chat from the list or start a new conversation
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                                    {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.name.charAt(0).toUpperCase() || "U"}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white">
                                        {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.name || "User"}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        {getOtherParticipant(conversations.find(c => c.id === selectedConv)!)?.email}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950">
                            {messages.map(msg => {
                                const isOwnMessage = msg.senderId === session?.user?.id;

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                                    >
                                        <div className={`max-w-md px-4 py-2 rounded-2xl ${isOwnMessage
                                                ? "bg-blue-600 text-white"
                                                : "bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                            }`}>
                                            {!isOwnMessage && (
                                                <div className="text-xs font-medium mb-1 opacity-70">
                                                    {msg.senderName}
                                                </div>
                                            )}
                                            <div>{msg.text}</div>
                                            <div className={`text-xs mt-1 ${isOwnMessage ? "text-blue-100" : "text-slate-400"}`}>
                                                {format(msg.timestamp.toDate(), "HH:mm")}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyPress={(e) => e.key === "Enter" && handleSend()}
                                    placeholder="Type a message..."
                                    disabled={sending}
                                    className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
