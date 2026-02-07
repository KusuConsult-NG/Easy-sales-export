"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Mail,
    Bell,
    Megaphone,
    Send,
    Users,
    Filter,
    Clock,
    CheckCircle,
} from "lucide-react";
import { sendBulkEmailAction, createAnnouncementAction } from "@/app/actions/admin-communications";
import { useToast } from "@/contexts/ToastContext";

export default function AdminCommunicationsPage() {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState("email");
    const [emailRecipients, setEmailRecipients] = useState("all");
    const [emailSubject, setEmailSubject] = useState("");
    const [emailBody, setEmailBody] = useState("");
    const [announcementTitle, setAnnouncementTitle] = useState("");
    const [announcementMessage, setAnnouncementMessage] = useState("");
    const [announcementPriority, setAnnouncementPriority] = useState("info");
    const [sending, setSending] = useState(false);

    const handleSendEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);

        const formData = new FormData();
        formData.append('recipients', emailRecipients);
        formData.append('subject', emailSubject);
        formData.append('body', emailBody);

        const result = await sendBulkEmailAction({ success: false }, formData);

        if (result.success) {
            showToast(`Email sent to ${result.recipientCount} recipients!`, 'success');
            setEmailSubject("");
            setEmailBody("");
        } else {
            showToast(result.error || 'Failed to send email', 'error');
        }

        setSending(false);
    };

    const handleCreateAnnouncement = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);

        const formData = new FormData();
        formData.append('title', announcementTitle);
        formData.append('message', announcementMessage);
        formData.append('priority', announcementPriority);

        const result = await createAnnouncementAction({ success: false }, formData);

        if (result.success) {
            showToast('Announcement created successfully!', 'success');
            setAnnouncementTitle("");
            setAnnouncementMessage("");
        } else {
            showToast(result.error || 'Failed to create announcement', 'error');
        }

        setSending(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin"
                        className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Admin Dashboard
                    </Link>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Communications Center
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Send emails, create announcements, and manage notifications
                    </p>
                </div>

                {/* Tabs */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg mb-6">
                    <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setActiveTab("email")}
                            className={`flex items-center justify-center gap-2 py-4 font-semibold transition ${activeTab === "email"
                                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                }`}
                        >
                            <Mail className="w-5 h-5" />
                            Email Composer
                        </button>
                        <button
                            onClick={() => setActiveTab("announcement")}
                            className={`flex items-center justify-center gap-2 py-4 font-semibold transition ${activeTab === "announcement"
                                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                }`}
                        >
                            <Megaphone className="w-5 h-5" />
                            Announcements
                        </button>
                        <button
                            onClick={() => setActiveTab("history")}
                            className={`flex items-center justify-center gap-2 py-4 font-semibold transition ${activeTab === "history"
                                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                }`}
                        >
                            <Clock className="w-5 h-5" />
                            Send History
                        </button>
                    </div>

                    <div className="p-8">
                        {/* Email Tab */}
                        {activeTab === "email" && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Compose Email
                                    </h2>
                                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                                        Send emails to users or specific segments
                                    </p>
                                </div>

                                {/* Recipients */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Recipients
                                    </label>
                                    <select
                                        value={emailRecipients}
                                        onChange={(e) => setEmailRecipients(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                                    >
                                        <option value="all">All Users</option>
                                        <option value="active">Active Users (30 days)</option>
                                        <option value="verified">Verified Users</option>
                                        <option value="cooperative">Cooperative Members</option>
                                        <option value="wave">WAVE Members</option>
                                        <option value="sellers">Marketplace Sellers</option>
                                        <option value="custom">Custom List (CSV)</option>
                                    </select>
                                </div>

                                {/* Subject */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Subject
                                    </label>
                                    <input
                                        type="text"
                                        value={emailSubject}
                                        onChange={(e) => setEmailSubject(e.target.value)}
                                        placeholder="Enter email subject..."
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                                    />
                                </div>

                                {/* Body */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Message
                                    </label>
                                    <textarea
                                        value={emailBody}
                                        onChange={(e) => setEmailBody(e.target.value)}
                                        placeholder="Compose your message..."
                                        rows={10}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600 resize-none"
                                    />
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                        Supports HTML formatting
                                    </p>
                                </div>

                                {/* Send Button */}
                                <div className="flex items-center gap-4">
                                    <button
                                        type="submit"
                                        disabled={!emailSubject || !emailBody || sending}
                                        className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-xl transition"
                                    >
                                        {sending ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                Sending...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="w-5 h-5" />
                                                Send Email
                                            </>
                                        )}
                                    </button>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        <Users className="w-4 h-4 inline mr-1" />
                                        Estimated recipients: ~1,245
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Announcement Tab */}
                        {activeTab === "announcement" && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Create Announcement
                                    </h2>
                                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                                        Display important messages on user dashboards
                                    </p>
                                </div>

                                {/* Title */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Title
                                    </label>
                                    <input
                                        type="text"
                                        value={announcementTitle}
                                        onChange={(e) => setAnnouncementTitle(e.target.value)}
                                        placeholder="Enter announcement title..."
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                                    />
                                </div>

                                {/* Message */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Message
                                    </label>
                                    <textarea
                                        value={announcementMessage}
                                        onChange={(e) => setAnnouncementMessage(e.target.value)}
                                        placeholder="Write your announcement..."
                                        rows={6}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600 resize-none"
                                    />
                                </div>

                                {/* Priority */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Priority
                                    </label>
                                    <select
                                        value={announcementPriority}
                                        onChange={(e) => setAnnouncementPriority(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                                    >
                                        <option value="info">Info (Blue)</option>
                                        <option value="warning">Warning (Yellow)</option>
                                        <option value="important">Important (Red)</option>
                                        <option value="success">Success (Green)</option>
                                    </select>
                                </div>

                                {/* Preview */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Preview
                                    </label>
                                    <div
                                        className={`p-4 rounded-xl border-l-4 ${announcementPriority === "info"
                                            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-600"
                                            : announcementPriority === "warning"
                                                ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-600"
                                                : announcementPriority === "important"
                                                    ? "bg-red-50 dark:bg-red-900/20 border-red-600"
                                                    : "bg-green-50 dark:bg-green-900/20 border-green-600"
                                            }`}
                                    >
                                        <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                            {announcementTitle || "Announcement Title"}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {announcementMessage || "Announcement message will appear here..."}
                                        </p>
                                    </div>
                                </div>

                                {/* Create Button */}
                                <button
                                    onClick={handleCreateAnnouncement}
                                    disabled={!announcementTitle || !announcementMessage || sending}
                                    className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white font-semibold rounded-xl transition"
                                >
                                    {sending ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        <>
                                            <Megaphone className="w-5 h-5" />
                                            Create Announcement
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* History Tab */}
                        {activeTab === "history" && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Communication History
                                    </h2>
                                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                                        View past emails and announcements
                                    </p>
                                </div>

                                {/* Mock History */}
                                <div className="space-y-4">
                                    {[
                                        {
                                            type: "email",
                                            subject: "Platform Maintenance Notice",
                                            recipients: "All Users (1,245)",
                                            date: "Feb 6, 2026",
                                            status: "sent",
                                        },
                                        {
                                            type: "announcement",
                                            subject: "New Feature: Cooperative Loans",
                                            recipients: "Dashboard",
                                            date: "Feb 5, 2026",
                                            status: "active",
                                        },
                                        {
                                            type: "email",
                                            subject: "Welcome to Easy Sales Export",
                                            recipients: "New Users (47)",
                                            date: "Feb 4, 2026",
                                            status: "sent",
                                        },
                                    ].map((item, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700 rounded-xl"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div
                                                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${item.type === "email"
                                                        ? "bg-blue-100 dark:bg-blue-900/30"
                                                        : "bg-purple-100 dark:bg-purple-900/30"
                                                        }`}
                                                >
                                                    {item.type === "email" ? (
                                                        <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                                    ) : (
                                                        <Megaphone className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                                                    )}
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-slate-900 dark:text-white">
                                                        {item.subject}
                                                    </h4>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {item.recipients} • {item.date}
                                                    </p>
                                                </div>
                                            </div>
                                            <span
                                                className={`px-3 py-1 rounded-full text-xs font-semibold ${item.status === "sent"
                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                    : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                                                    }`}
                                            >
                                                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
