"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import {
    MessageCircle,
    X,
    Send,
    Sparkles,
    Loader2,
    ChevronRight
} from "lucide-react";
import { sendAIMessage, getAIChatHistory, getAISuggestions, type AIChatMessage } from "@/app/actions/ai-actions";

interface AISidebarProps {
    userRole?: string;
}

export function AISidebar({ userRole = 'user' }: AISidebarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<AIChatMessage[]>([]);
    const [inputMessage, setInputMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pathname = usePathname();

    // Load chat history on mount
    useEffect(() => {
        if (isOpen) {
            loadChatHistory();
            loadSuggestions();
        }
    }, [isOpen, pathname]);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    async function loadChatHistory() {
        const result = await getAIChatHistory(20);
        if (result.success) {
            setMessages(result.messages);
        }
    }

    async function loadSuggestions() {
        const result = await getAISuggestions({
            currentPage: pathname,
            userRole,
        });
        if (result.success) {
            setSuggestions(result.suggestions);
        }
    }

    async function handleSendMessage(message?: string) {
        const messageToSend = message || inputMessage.trim();
        if (!messageToSend) return;

        setInputMessage("");
        setLoading(true);

        // Add user message optimistically
        const userMessage: AIChatMessage = {
            id: Date.now().toString(),
            userId: 'current',
            message: messageToSend,
            response: '',
            createdAt: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        const result = await sendAIMessage({
            message: messageToSend,
            context: {
                currentPage: pathname,
                userRole,
            },
        });

        if (result.success && result.response) {
            // Update with AI response
            const aiMessage: AIChatMessage = {
                id: result.chatId || Date.now().toString(),
                userId: 'current',
                message: messageToSend,
                response: result.response,
                createdAt: new Date(),
            };
            setMessages(prev => [...prev.slice(0, -1), aiMessage]);
        } else {
            // Remove optimistic message on error
            setMessages(prev => prev.slice(0, -1));
        }

        setLoading(false);
    }

    function handleSuggestionClick(suggestion: string) {
        handleSendMessage(suggestion);
    }

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-8 right-8 w-16 h-16 bg-linear-to-br from-[#1358ec] to-[#0d47b8] text-white rounded-full shadow-2xl flex items-center justify-center z-50 hover:shadow-[#1358ec]/50 transition-shadow"
                >
                    <Sparkles className="w-7 h-7" />
                </motion.button>
            )}

            {/* Sidebar Drawer */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsOpen(false)}
                            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                        />

                        {/* Drawer */}
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed top-0 right-0 h-full w-full md:w-[480px] bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col"
                        >
                            {/* Header */}
                            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-linear-to-r from-[#1358ec] to-[#0d47b8] text-white">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                        <Sparkles className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold">AI Assistant</h2>
                                        <p className="text-xs text-white/80">Powered by GPT-4</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            {/* Suggestions */}
                            {messages.length === 0 && suggestions.length > 0 && (
                                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Suggested questions:
                                    </p>
                                    <div className="space-y-2">
                                        {suggestions.map((suggestion, i) => (
                                            <motion.button
                                                key={i}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: i * 0.1 }}
                                                onClick={() => handleSuggestionClick(suggestion)}
                                                className="w-full text-left px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-[#1358ec]/10 dark:hover:bg-[#1358ec]/20 transition-colors text-sm text-slate-700 dark:text-slate-300 flex items-center justify-between group"
                                            >
                                                <span>{suggestion}</span>
                                                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </motion.button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                {messages.length === 0 && (
                                    <div className="text-center py-12">
                                        <div className="w-20 h-20 bg-linear-to-br from-[#1358ec]/10 to-[#0d47b8]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <MessageCircle className="w-10 h-10 text-[#1358ec]" />
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                            How can I help you today?
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Ask me anything about Easy Sales Export
                                        </p>
                                    </div>
                                )}

                                {messages.map((msg, index) => (
                                    <div key={msg.id || index} className="space-y-3">
                                        {/* User Message */}
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="flex justify-end"
                                        >
                                            <div className="max-w-[80%] bg-[#1358ec] text-white rounded-2xl rounded-tr-sm px-4 py-3">
                                                <p className="text-sm">{msg.message}</p>
                                            </div>
                                        </motion.div>

                                        {/* AI Response */}
                                        {msg.response && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex justify-start"
                                            >
                                                <div className="max-w-[80%] bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-2xl rounded-tl-sm px-4 py-3">
                                                    <p className="text-sm whitespace-pre-wrap">{msg.response}</p>
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                ))}

                                {loading && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex justify-start"
                                    >
                                        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin text-[#1358ec]" />
                                            <span className="text-sm text-slate-600 dark:text-slate-400">Thinking...</span>
                                        </div>
                                    </motion.div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div className="p-6 border-t border-slate-200 dark:border-slate-700">
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }}
                                    className="flex items-end gap-3"
                                >
                                    <div className="flex-1">
                                        <textarea
                                            value={inputMessage}
                                            onChange={(e) => setInputMessage(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage();
                                                }
                                            }}
                                            placeholder="Ask me anything..."
                                            rows={1}
                                            disabled={loading}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec] focus:border-transparent resize-none disabled:opacity-50"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={!inputMessage.trim() || loading}
                                        className="w-12 h-12 bg-[#1358ec] text-white rounded-xl flex items-center justify-center hover:bg-[#1046c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                                    >
                                        <Send className="w-5 h-5" />
                                    </button>
                                </form>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                                    Press Enter to send, Shift+Enter for new line
                                </p>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
