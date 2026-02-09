"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Send, Paperclip, MoreVertical, Phone, Video, ArrowLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getConversationMessagesAction, sendMessageAction, markMessagesAsReadAction } from "@/app/actions/messaging";
import { useSession } from "next-auth/react";
import Link from "next/link";

type MessageData = {
    id: string;
    senderId: string;
    recipientId: string;
    content: string;
    read: boolean;
    createdAt: Date;
};

export default function ChatPage() {
    const params = useParams();
    const conversationId = params.id as string;
    const { data: session } = useSession();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [newMessage, setNewMessage] = useState("");
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        async function loadMessages() {
            if (!conversationId) return;

            setLoading(true);
            const result = await getConversationMessagesAction(conversationId);

            if (result.success && result.messages) {
                setMessages(result.messages as any[]);
                // Mark as read
                await markMessagesAsReadAction(conversationId);
            }
            setLoading(false);
        }

        loadMessages();
    }, [conversationId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || sending) return;

        setSending(true);
        const result = await sendMessageAction(conversationId, newMessage);

        if (result.success) {
            // Optimistically add message to UI
            const tempMessage: MessageData = {
                id: Date.now().toString(),
                senderId: session?.user?.id || "",
                recipientId: "",
                content: newMessage,
                read: false,
                createdAt: new Date()
            };
            setMessages([...messages, tempMessage]);
            setNewMessage("");

            // Reload messages to get actual data
            setTimeout(async () => {
                const refreshResult = await getConversationMessagesAction(conversationId);
                if (refreshResult.success && refreshResult.messages) {
                    setMessages(refreshResult.messages as any[]);
                }
            }, 500);
        }
        setSending(false);
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 dark:border-white"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
            <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <Link href="/messages" className="md:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                        U
                    </div>
                    <div>
                        <h2 className="font-bold text-slate-900 dark:text-white leading-tight">
                            User
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Online
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-slate-500">
                    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <Phone className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <Video className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <MoreVertical className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50 dark:bg-slate-950"
            >
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-center my-4">
                            <span className="bg-slate-200 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full">
                                Today
                            </span>
                        </div>

                        {messages.map((msg) => {
                            const isMe = msg.senderId === session?.user?.id;

                            return (
                                <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                                    <div className={`
                                        max-w-[75%] md:max-w-[60%] rounded-2xl px-4 py-3 shadow-sm
                                        ${isMe
                                            ? "bg-blue-600 text-white rounded-tr-sm"
                                            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm border border-slate-100 dark:border-slate-700"
                                        }
                                    `}>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                        <div className={`
                                            text-[10px] mt-1 flex items-center justify-end gap-1
                                            ${isMe ? "text-blue-100" : "text-slate-400"}
                                        `}>
                                            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: false })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <form onSubmit={handleSendMessage} className="flex items-end gap-2 max-w-4xl mx-auto">
                    <button
                        type="button"
                        className="p-3 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>

                    <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center px-4 py-2">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder-slate-500"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!newMessage.trim() || sending}
                        className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-full transition-all shadow-lg hover:shadow-xl"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </form>
            </div>
        </div>
    );
}
