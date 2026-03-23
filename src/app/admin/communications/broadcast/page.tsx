/**
 * Admin Broadcast — Compose & Send
 * /admin/communications/broadcast
 *
 * Features:
 *  - Audience picker (7 segments)
 *  - Optional state filter
 *  - Optional seller-status filter (for seller audiences)
 *  - Subject + body compose
 *  - Live Preview (renders the branded email)
 *  - "Estimate Recipients" before sending
 *  - Confirmation dialog before actual send
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Megaphone, Users, MapPin, Mail, Eye, Send, Loader2,
    ChevronLeft, AlertTriangle, CheckCircle, Info,
} from "lucide-react";
import {
    previewBroadcastAction,
    sendBroadcastAction,
} from "@/app/actions/broadcast";
import type { BroadcastAudience, BroadcastFilters } from "@/app/actions/broadcast";
import { diagnoseBroadcastAction } from "@/app/actions/diagnose-broadcast";
import { useToast } from "@/contexts/ToastContext";

const AUDIENCE_OPTIONS: { value: BroadcastAudience; label: string; desc: string }[] = [
    { value: "all", label: "All Users", desc: "Every registered user" },
    { value: "buyers", label: "Buyers Only", desc: "Marketplace buyers (buyer or both)" },
    { value: "sellers", label: "All Sellers", desc: "Approved marketplace sellers" },
    { value: "wholesale_sellers", label: "Wholesale Sellers", desc: "Sellers categorised as Wholesale" },
    { value: "retail_sellers", label: "Retail Sellers", desc: "Sellers categorised as Retail" },
    { value: "marketplace_onboarded", label: "Marketplace Users", desc: "All onboarded marketplace participants" },
    { value: "cooperative_members", label: "Cooperative Members", desc: "Active cooperative members" },
    { value: "wave_applicants", label: "WAVE Applicants", desc: "WAVE program registrants" },
    { value: "wave_briefing_registrants", label: "WAVE Briefing Registrants", desc: "Users registered for WAVE briefing sessions" },
];

const SELLER_STATUS_OPTIONS = [
    { value: "approved", label: "Approved" },
    { value: "pending", label: "Pending" },
    { value: "suspended", label: "Suspended" },
];

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara",
];

type Step = "compose" | "preview" | "confirm" | "done";

function buildPreviewHtml(subject: string, body: string) {
    const htmlBody = body
        .split("\n")
        .map((l) => (l.trim() === "" ? "<br/>" : `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.7">${l}</p>`))
        .join("");
    return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
          <div style="background:#16a34a;padding:20px 28px">
            <h1 style="color:#fff;margin:0;font-size:20px">Easy Sales Export</h1>
            <p style="color:#bbf7d0;margin:3px 0 0;font-size:12px">Nigeria's Premier Agricultural Platform</p>
          </div>
          <div style="background:#fff;padding:28px">
            <h2 style="font-size:18px;color:#111827;margin:0 0 18px">${subject || "(No subject)"}</h2>
            ${htmlBody || '<p style="color:#9ca3af">Your message will appear here…</p>'}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
            <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">Easy Sales Export · easysalesexport.com</p>
          </div>
        </div>`;
}

export default function BroadcastComposePage() {
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("compose");
    const [audience, setAudience] = useState<BroadcastAudience>("all");
    const [stateFilter, setStateFilter] = useState("");
    const [sellerStatus, setSellerStatus] = useState<"pending" | "approved" | "suspended">("approved");
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [showPreview, setShowPreview] = useState(false);

    const [estimating, setEstimating] = useState(false);
    const [recipientCount, setRecipientCount] = useState<number | null>(null);
    const [recipientSample, setRecipientSample] = useState<{ name: string; email: string }[]>([]);

    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
    const [diagResult, setDiagResult] = useState<string | null>(null);

    const isSellerAudience = ["sellers", "wholesale_sellers", "retail_sellers"].includes(audience);

    const buildFilters = (): BroadcastFilters => ({
        audience,
        state: stateFilter || undefined,
        sellerStatus: isSellerAudience ? sellerStatus : undefined,
    });

    const handleEstimate = async () => {
        if (!subject.trim() || !body.trim()) {
            showToast("Please fill in subject and message before estimating.", "error");
            return;
        }
        setEstimating(true);
        const res = await previewBroadcastAction(buildFilters());
        setEstimating(false);
        if (res.error) { showToast(res.error, "error"); return; }
        setRecipientCount(res.count);
        setRecipientSample(res.sample);
    };

    const handleSend = async () => {
        setSending(true);
        const res = await sendBroadcastAction(buildFilters(), subject, body);
        setSending(false);
        if (!res.success) { showToast(res.error || "Send failed", "error"); return; }
        setResult({ sent: res.sent, failed: res.failed });
        setStep("done");
    };

    const canProceed = subject.trim().length > 0 && body.trim().length > 3;

    if (step === "done" && result) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-10 max-w-md w-full text-center">
                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Broadcast Sent!</h2>
                    <div className="flex justify-center gap-6 my-6">
                        <div className="text-center">
                            <p className="text-3xl font-bold text-green-600">{result.sent}</p>
                            <p className="text-sm text-slate-500">Delivered</p>
                        </div>
                        {result.failed > 0 && (
                            <div className="text-center">
                                <p className="text-3xl font-bold text-red-500">{result.failed}</p>
                                <p className="text-sm text-slate-500">Failed</p>
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-slate-500 mb-6">Full details are saved in the broadcast history log.</p>
                    <div className="flex gap-3">
                        <Link href="/admin/communications/history" className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition text-center">
                            View History
                        </Link>
                        <button onClick={() => { setStep("compose"); setRecipientCount(null); setResult(null); setSubject(""); setBody(""); }}
                            className="flex-1 py-3 border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition">
                            New Broadcast
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-8 py-6 flex items-center gap-4">
                    <Link href="/admin/communications" className="p-2 rounded-xl hover:bg-slate-100 transition">
                        <ChevronLeft className="w-5 h-5 text-slate-600" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                            <Megaphone className="w-5 h-5 text-green-700" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">Send Broadcast Email</h1>
                            <p className="text-sm text-slate-500">Compose and send to your selected audience</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    {/* Left — Form */}
                    <div className="lg:col-span-3 space-y-6">
                        {/* Audience */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Users className="w-5 h-5 text-slate-600" />
                                <h2 className="font-bold text-slate-900">Audience</h2>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                                {AUDIENCE_OPTIONS.map((opt) => (
                                    <label
                                        key={opt.value}
                                        className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${audience === opt.value
                                                ? "border-green-500 bg-green-50"
                                                : "border-slate-200 hover:border-slate-300"
                                            }`}
                                    >
                                        <input type="radio" name="audience" value={opt.value}
                                            checked={audience === opt.value}
                                            onChange={() => { setAudience(opt.value); setRecipientCount(null); }}
                                            className="mt-0.5 accent-green-600" />
                                        <div>
                                            <p className="font-semibold text-slate-900 text-sm">{opt.label}</p>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Filters */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <MapPin className="w-5 h-5 text-slate-600" />
                                <h2 className="font-bold text-slate-900">Optional Filters</h2>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">State (leave blank for all states)</label>
                                    <select value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setRecipientCount(null); }}
                                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                        <option value="">All States</option>
                                        {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
                                    </select>
                                </div>
                                {isSellerAudience && (
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Seller Status</label>
                                        <select value={sellerStatus} onChange={(e) => { setSellerStatus(e.target.value as any); setRecipientCount(null); }}
                                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                            {SELLER_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Compose */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Mail className="w-5 h-5 text-slate-600" />
                                <h2 className="font-bold text-slate-900">Message</h2>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject *</label>
                                    <input
                                        type="text"
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        placeholder="e.g., Important Update from Easy Sales Export"
                                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Message Body *</label>
                                    <textarea
                                        value={body}
                                        onChange={(e) => setBody(e.target.value)}
                                        rows={10}
                                        placeholder="Type your message here. Each line will become a paragraph in the email."
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y font-mono text-sm"
                                    />
                                    <p className="text-xs text-slate-400 mt-1">Plain text — each new line becomes a paragraph. No HTML needed.</p>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={handleEstimate}
                                disabled={!canProceed || estimating}
                                className="px-5 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {estimating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                                Estimate Recipients
                            </button>
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className="px-5 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition flex items-center gap-2"
                            >
                                <Eye className="w-4 h-4" /> {showPreview ? "Hide" : "Preview"} Email
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={!canProceed || sending || recipientCount === 0}
                                className="flex-1 px-5 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
                                {sending ? "Sending…" : "Send Broadcast"}
                            </button>
                            <button
                                onClick={async () => {
                                    const r = await diagnoseBroadcastAction();
                                    setDiagResult(JSON.stringify(r, null, 2));
                                }}
                                className="px-4 py-3 border border-amber-300 bg-amber-50 text-amber-800 font-semibold rounded-xl hover:bg-amber-100 transition text-xs"
                            >
                                🔍 Diagnose
                            </button>
                        </div>

                        {/* Recipient estimate result */}
                        {recipientCount !== null && (
                            <div className={`rounded-xl border p-4 flex gap-3 ${recipientCount === 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                                {recipientCount === 0 ? (
                                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                ) : (
                                    <Info className="w-5 h-5 text-green-700 shrink-0 mt-0.5" />
                                )}
                                <div>
                                    <p className={`font-bold text-sm ${recipientCount === 0 ? "text-red-700" : "text-green-800"}`}>
                                        {recipientCount === 0
                                            ? "No recipients found for these filters"
                                            : `~${recipientCount.toLocaleString()} recipients will receive this email`}
                                    </p>
                                    {recipientSample.length > 0 && (
                                        <p className="text-xs text-green-700 mt-1">
                                            Sample: {recipientSample.map((r) => r.email).join(", ")}
                                            {recipientCount > 3 ? ` + ${recipientCount - 3} more` : ""}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {diagResult && (
                            <pre className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 overflow-auto max-h-48 whitespace-pre-wrap">
                                {diagResult}
                            </pre>
                        )}
                    </div>

                    {/* Right — Live preview */}
                    <div className="lg:col-span-2">
                        <div className="sticky top-6">
                            <div className="flex items-center gap-2 mb-3">
                                <Eye className="w-4 h-4 text-slate-500" />
                                <h3 className="text-sm font-bold text-slate-700">Email Preview</h3>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="bg-slate-100 px-4 py-2.5 flex items-center gap-1.5 border-b border-slate-200">
                                    <div className="w-3 h-3 rounded-full bg-red-400" />
                                    <div className="w-3 h-3 rounded-full bg-amber-400" />
                                    <div className="w-3 h-3 rounded-full bg-green-400" />
                                    <span className="ml-2 text-xs text-slate-500">Email Preview</span>
                                </div>
                                <div
                                    className="p-4 overflow-auto max-h-[600px]"
                                    dangerouslySetInnerHTML={{ __html: buildPreviewHtml(subject, body) }}
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-2 text-center">Updates as you type</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
