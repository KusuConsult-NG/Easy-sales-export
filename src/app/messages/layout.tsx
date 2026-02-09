"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Search, Plus, Filter, MessageSquare
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getConversationsAction } from "@/app/actions/messaging";
import { useSession } from "next-auth/react";

type ConversationData = {
    id: string;
    participants: string[];
    lastMessage: string;
    lastMessageAt: Date;
    unreadCount: Record<string, number>;
    productId?: string;
    orderId?: string;
};

export default function MessagesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [searchQuery, setSearchQuery] = useState("");
    const [conversations, setConversations] = useState<ConversationData[]>([]);
    const [loading, setLoading] = useState(true);

    const isConversationOpen = pathname !== "/messages" && pathname.startsWith("/messages/");

    useEffect(() => {
        async function loadConversations() {
            setLoading(true);
            const result = await getConversationsAction();

            if (result.success && result.conversations) {
                setConversations(result.conversations as any[]);
            }
            setLoading(false);
        }

        loadConversations();
    }, []);

    return (
        <div className="h-[calc(100vh-64px)] bg-white dark:bg-slate-950 flex overflow-hidden">
            <div className={`
                w-full md:w-80 lg:w-96 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900
                ${isConversationOpen ? 'hidden md:flex' : 'flex'}
            `}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">Messages</h1>
                    <div className="flex gap-2">
                        <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                            <Filter className="w-5 h-5" />
                        </button>
                        <button className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-colors shadow-sm">
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-4">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search messages..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
                            <MessageSquare className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="text-sm">No conversations yet</p>
                            <p className="text-xs mt-1">Start chatting with buyers and sellers</p>
                        </div>
                    ) : (
                        conversations.map((conversation) => {
                            const isActive = pathname === `/messages/${conversation.id}`;
                            const unreadCount = conversation.unreadCount?.[session?.user?.id || ""] || 0;

                            return (
                                <Link
                                    key={conversation.id}
                                    href={`/messages/${conversation.id}`}
                                    className={`
                                        flex items-start gap-3 p-4 border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer
                                        ${isActive ? 'bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'}
                                    `}
                                >
                                    <div className="relative shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                                            U
                                        </div>
                                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-slate-900 rounded-full"></div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-baseline mb-1">
                                            <h3 className={`font-semibold truncate pr-2 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-900 dark:text-white'}`}>
                                                User
                                            </h3>
                                            {conversation.lastMessageAt && (
                                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                                    {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: false }).replace('about ', '')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <p className={`text-sm truncate pr-2 ${unreadCount > 0 ? 'font-semibold text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
                                                {conversation.lastMessage || "No messages yet"}
                                            </p>
                                            {unreadCount > 0 && (
                                                <span className="shrink-0 w-5 h-5 bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full">
                                                    {unreadCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </Link>
                            );
                        })
                    )}
                </div>
            </div>

            <div className={`flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col ${!isConversationOpen ? 'hidden md:flex' : 'flex'}`}>
                {children}
            </div>
        </div>
    );
}
