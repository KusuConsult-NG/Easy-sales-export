"use client";

import { useState } from "react";
import Link from "next/link";
import {
    previewInAppBroadcastAction,
    sendInAppBroadcastAction,
    type InAppAudience,
    type InAppBroadcastFilters,
    type NotificationType,
} from "@/app/actions/in-app-broadcast";

// ── Constants ──────────────────────────────────────────────────────────────

const AUDIENCES: { value: InAppAudience; label: string; description: string }[] = [
    { value: "all", label: "All Users", description: "Every registered user on the platform" },
    { value: "buyers", label: "Buyers", description: "Users with a buyer marketplace account" },
    { value: "sellers", label: "All Sellers", description: "Approved sellers (wholesale + retail)" },
    { value: "wholesale_sellers", label: "Wholesale Sellers", description: "Approved wholesale sellers only" },
    { value: "retail_sellers", label: "Retail Sellers", description: "Approved retail sellers only" },
    { value: "marketplace_onboarded", label: "Marketplace Users", description: "All marketplace-onboarded users" },
    { value: "cooperative_members", label: "Cooperative Members", description: "Active cooperative members" },
    { value: "wave_applicants", label: "WAVE Applicants", description: "Users who applied to WAVE" },
    { value: "wave_briefing_registrants", label: "WAVE Briefing Registrants", description: "Users registered for WAVE briefings" },
    { value: "academy_users", label: "Academy Users", description: "All Academy applicants" },
    { value: "export_users", label: "Export Users", description: "All Export onboarding applicants" },
    { value: "farm_nation_users", label: "Farm Nation Users", description: "All Farm Nation inquiries" },
    { value: "abandoned_failed_transactions", label: "Abandoned / Failed Transactions", description: "Users with failed or aborted payments" },
];

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara",
];

const NOTIFICATION_TYPES: { value: NotificationType; label: string; color: string }[] = [
    { value: "info", label: "ℹ️ Info", color: "blue" },
    { value: "success", label: "✅ Success", color: "green" },
    { value: "warning", label: "⚠️ Warning", color: "amber" },
    { value: "event", label: "📅 Event", color: "purple" },
    { value: "system", label: "🔧 System", color: "gray" },
    { value: "general", label: "📢 General", color: "teal" },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function InAppBroadcastPage() {
    const [audience, setAudience] = useState<InAppAudience>("all");
    const [state, setState] = useState("");
    const [sellerStatus, setSellerStatus] = useState<"approved" | "pending" | "suspended">("approved");
    const [notifType, setNotifType] = useState<NotificationType>("info");
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [link, setLink] = useState("");
    const [linkText, setLinkText] = useState("");

    const [preview, setPreview] = useState<{ count: number; sample: { name: string; userId: string }[] } | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ success: boolean; delivered: number; error?: string } | null>(null);

    const isSellerAudience = ["sellers", "wholesale_sellers", "retail_sellers"].includes(audience);

    const buildFilters = (): InAppBroadcastFilters => ({
        audience,
        state: state || undefined,
        sellerStatus: isSellerAudience ? sellerStatus : undefined,
    });

    async function handlePreview() {
        setLoadingPreview(true);
        setPreview(null);
        setResult(null);
        const res = await previewInAppBroadcastAction(buildFilters());
        setPreview(res);
        setLoadingPreview(false);
    };

    async function handleSend() {
        if (!title.trim() || !message.trim()) {
            alert("Please fill in both the title and message.");
            return;
        }
        if (!preview || preview.count === 0) {
            alert("Please run a preview first and ensure there are recipients.");
            return;
        }
        const confirmed = confirm(
            `You are about to send an in-app notification to ${preview.count.toLocaleString()} users. They will see this the next time they open the platform (or immediately if they're online). Continue?`
        );
        if (!confirmed) return;

        setSending(true);
        setResult(null);
        const res = await sendInAppBroadcastAction(
            buildFilters(),
            title.trim(),
            message.trim(),
            notifType,
            link.trim() || undefined,
            linkText.trim() || undefined
        );
        setResult(res);
        setSending(false);
    };

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-primary, #0f1117)" }}>
            {/* Header */}
            <div className="border-b border-white/10" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-4">
                    <Link href="/admin/communications" className="text-sm text-white/50 hover:text-white transition-colors">
                        ← Communications
                    </Link>
                    <span className="text-white/20">/</span>
                    <h1 className="text-lg font-semibold text-white">In-App Notification Broadcast</h1>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

                {/* Offline Delivery Banner */}
                <div className="px-4 py-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 text-sm flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">📡</span>
                    <p>
                        <strong>Offline delivery supported.</strong> Notifications are stored in Firestore — users who are
                        not currently online will still see this message the next time they log in or open the platform.
                    </p>
                </div>

                {/* Audience Picker */}
                <div className="rounded-2xl border border-white/10 p-6" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <h2 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">1</span>
                        Select Audience
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {AUDIENCES.map((a) => (
                            <button
                                key={a.value}
                                onClick={() => { setAudience(a.value); setPreview(null); }}
                                className={`text-left p-3 rounded-xl border transition-all ${
                                    audience === a.value
                                        ? "border-emerald-500 bg-emerald-500/10"
                                        : "border-white/10 hover:border-white/20"
                                }`}
                            >
                                <p className={`font-medium text-sm ${audience === a.value ? "text-emerald-400" : "text-white"}`}>
                                    {a.label}
                                </p>
                                <p className="text-white/50 text-xs mt-0.5 leading-snug">{a.description}</p>
                            </button>
                        ))}
                    </div>

                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-white/60 text-xs font-medium mb-1.5">Filter by State (Optional)</label>
                            <select
                                value={state}
                                onChange={(e) => { setState(e.target.value); setPreview(null); }}
                                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:border-emerald-500"
                            >
                                <option value="">All States</option>
                                {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        {isSellerAudience && (
                            <div>
                                <label className="block text-white/60 text-xs font-medium mb-1.5">Seller Status</label>
                                <select
                                    value={sellerStatus}
                                    onChange={(e) => { setSellerStatus(e.target.value as any); setPreview(null); }}
                                    className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:border-emerald-500"
                                >
                                    <option value="approved">Approved</option>
                                    <option value="pending">Pending</option>
                                    <option value="suspended">Suspended</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notification Composer */}
                <div className="rounded-2xl border border-white/10 p-6" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <h2 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">2</span>
                        Compose Notification
                    </h2>

                    {/* Type selector */}
                    <label className="block text-white/60 text-xs font-medium mb-2">Notification Type</label>
                    <div className="flex flex-wrap gap-2 mb-5">
                        {NOTIFICATION_TYPES.map((t) => (
                            <button
                                key={t.value}
                                onClick={() => setNotifType(t.value)}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                    notifType === t.value
                                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                                        : "border-white/10 text-white/60 hover:border-white/20"
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-white/60 text-xs font-medium mb-1.5">Title *</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. New Feature Available!"
                                maxLength={80}
                                className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-white/60 text-xs font-medium mb-1.5">Message *</label>
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Your notification message..."
                                rows={4}
                                maxLength={500}
                                className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500 resize-none"
                            />
                            <p className="text-white/30 text-xs mt-1 text-right">{message.length}/500</p>
                        </div>

                        {/* CTA Link (Optional) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-white/60 text-xs font-medium mb-1.5">Action Link (Optional)</label>
                                <input
                                    type="text"
                                    value={link}
                                    onChange={(e) => setLink(e.target.value)}
                                    placeholder="/dashboard or /academy"
                                    className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500"
                                />
                            </div>
                            <div>
                                <label className="block text-white/60 text-xs font-medium mb-1.5">Button Label (Optional)</label>
                                <input
                                    type="text"
                                    value={linkText}
                                    onChange={(e) => setLinkText(e.target.value)}
                                    placeholder="e.g. Learn More"
                                    className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Live Preview */}
                    {(title || message) && (
                        <div className="mt-5 p-4 rounded-xl border border-white/10 bg-black/20">
                            <p className="text-white/40 text-xs font-medium mb-3">NOTIFICATION PREVIEW</p>
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                                    <span className="text-emerald-400 text-lg">
                                        {notifType === "info" ? "ℹ️" : notifType === "success" ? "✅" : notifType === "warning" ? "⚠️" : notifType === "event" ? "📅" : notifType === "system" ? "🔧" : "📢"}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-white text-sm font-semibold">{title || "Notification Title"}</p>
                                    <p className="text-white/60 text-xs mt-0.5 leading-relaxed">{message || "Your message will appear here."}</p>
                                    {linkText && (
                                        <button className="mt-2 text-xs text-emerald-400 font-medium hover:underline">{linkText} →</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Preview & Send */}
                <div className="rounded-2xl border border-white/10 p-6" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <h2 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">3</span>
                        Preview &amp; Send
                    </h2>

                    <button
                        onClick={handlePreview}
                        disabled={loadingPreview || sending}
                        className="px-5 py-2.5 rounded-xl border border-white/20 text-white text-sm font-medium hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {loadingPreview ? "Estimating..." : "Estimate Recipients"}
                    </button>

                    {preview && (
                        <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
                            <p className="text-white font-semibold text-sm">
                                {preview.count.toLocaleString()} users will receive this notification
                            </p>
                            {preview.sample.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {preview.sample.map((r, i) => (
                                        <p key={i} className="text-white/50 text-xs">{r.name}</p>
                                    ))}
                                    {preview.count > 3 && (
                                        <p className="text-white/30 text-xs">...and {preview.count - 3} more</p>
                                    )}
                                </div>
                            )}
                            {preview.count === 0 && (
                                <p className="text-amber-400 text-xs mt-1">No users found for this filter combination.</p>
                            )}
                        </div>
                    )}

                    {preview && preview.count > 0 && (
                        <button
                            onClick={handleSend}
                            disabled={sending || !title.trim() || !message.trim()}
                            className="mt-4 px-6 py-2.5 rounded-xl font-medium text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                        >
                            {sending
                                ? `Sending to ${preview.count.toLocaleString()} users...`
                                : `Deliver Notification to ${preview.count.toLocaleString()} Users`}
                        </button>
                    )}

                    {result && (
                        <div className={`mt-4 p-4 rounded-xl border ${result.success ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                            {result.success ? (
                                <div>
                                    <p className="text-emerald-400 font-semibold text-sm">✅ Notifications Delivered</p>
                                    <p className="text-white/60 text-xs mt-1">
                                        {result.delivered.toLocaleString()} notification documents created in Firestore.
                                        Online users will see them instantly. Offline users will see them on next login.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-red-400 font-semibold text-sm">❌ Delivery Failed</p>
                                    <p className="text-white/60 text-xs mt-1">{result.error}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
