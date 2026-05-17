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
    Megaphone, Users, MapPin, Mail, Eye, Send, Loader2, Upload,
    ChevronLeft, AlertTriangle, CheckCircle, Info, Calendar
} from "lucide-react";
import {
    previewBroadcastAction,
} from "@/app/actions/broadcast";
import type { BroadcastAudience, BroadcastFilters } from "@/app/actions/broadcast";
import { diagnoseBroadcastAction } from "@/app/actions/diagnose-broadcast";
import { useToast } from "@/contexts/ToastContext";

const AUDIENCE_GROUPS: { label: string; options: { value: BroadcastAudience; label: string; desc: string }[] }[] = [
    {
        label: "📋 General",
        options: [
            { value: "all", label: "All Users", desc: "Every registered user" },
            { value: "all_except_approved_coop", label: "All (Exclude Approved Coop)", desc: "Everyone EXCEPT active Cooperative Members" },
            { value: "pending_applicants", label: "All Pending Applicants", desc: "Everyone awaiting review across Cooperative, WAVE, Academy, Farm Nation & Export" },
            { value: "unpaid_applicants", label: "Unpaid Applicants", desc: "Users who applied but have not completed their required payment" },
            { value: "abandoned_failed_transactions", label: "Abandoned / Failed Payments", desc: "Users with failed or aborted payments" },
            { value: "stalled_users", label: "⚠️ Stalled Users", desc: "Started a module but profile is incomplete (missing bank/address)." },
            { value: "ghost_users", label: "👻 Ghost Users", desc: "Registered but never clicked start on any service. Zero platform data." },
            { value: "csv_upload", label: "CSV Upload", desc: "Upload a CSV file containing email addresses" },
        ],
    },
    {
        label: "🛒 Marketplace",
        options: [
            { value: "marketplace_onboarded", label: "All Marketplace Users", desc: "Every onboarded marketplace participant" },
            { value: "buyers", label: "Buyers Only", desc: "Marketplace buyers (buyer or both)" },
            { value: "sellers", label: "All Sellers", desc: "Marketplace sellers (any status)" },
            { value: "wholesale_sellers", label: "Wholesale Sellers", desc: "Sellers categorised as Wholesale" },
            { value: "retail_sellers", label: "Retail Sellers", desc: "Sellers categorised as Retail" },
        ],
    },
    {
        label: "🌾 Modules",
        options: [
            { value: "cooperative_members", label: "Cooperative Members", desc: "Cooperative membership holders" },
            { value: "wave_applicants", label: "WAVE Applicants", desc: "WAVE program registrants" },
            { value: "wave_briefing_registrants", label: "WAVE Briefing Registrants", desc: "Users registered for WAVE briefing sessions" },
            { value: "academy_users", label: "Academy Users", desc: "All Academy applicants" },
            { value: "farm_nation_users", label: "Farm Nation Users", desc: "All Farm Nation registrants" },
            { value: "export_users", label: "Export Users", desc: "All Export onboarding applicants" },
        ],
    },
];

// Flat list for convenience
const AUDIENCE_OPTIONS = AUDIENCE_GROUPS.flatMap(g => g.options);

const MODULE_STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
    cooperative_members: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
        { value: "suspended", label: "Suspended" },
        { value: "unpaid", label: "Unpaid" },
    ],
    wave_applicants: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
    ],
    academy_users: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
        { value: "under_review", label: "Under Review" },
    ],
    farm_nation_users: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
    ],
    export_users: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
    ],
    marketplace_onboarded: [
        { value: "all", label: "All Statuses" },
        { value: "approved", label: "Approved" },
        { value: "not_approved", label: "Not Approved (Pending, etc.)" },
        { value: "pending", label: "Pending" },
        { value: "rejected", label: "Rejected" },
    ],
};

const FARM_NATION_ROLES = [
    { value: "", label: "All Roles" },
    { value: "buyer", label: "Buyers" },
    { value: "seller", label: "Sellers" },
    { value: "both", label: "Buyer & Seller" },
];

const SELLER_STATUS_OPTIONS = [
    { value: "all", label: "All Statuses" },
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
    const [sellerStatus, setSellerStatus] = useState<"all" | "pending" | "approved" | "suspended">("all");
    const [moduleStatus, setModuleStatus] = useState("all");
    const [farmNationRole, setFarmNationRole] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [csvEmails, setCsvEmails] = useState<string[]>([]);
    const [csvName, setCsvName] = useState("");

    const [estimating, setEstimating] = useState(false);
    const [recipientCount, setRecipientCount] = useState<number | null>(null);
    const [totalMatches, setTotalMatches] = useState<number | null>(null);
    const [recipientSample, setRecipientSample] = useState<{ name: string; email: string }[]>([]);
    const [moduleStats, setModuleStats] = useState<any>(null);

    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
    const [diagResult, setDiagResult] = useState<string | null>(null);
    const [diagnosing, setDiagnosing] = useState(false);

    const isSellerAudience = ["sellers", "wholesale_sellers", "retail_sellers"].includes(audience);
    const hasModuleStatus = audience in MODULE_STATUS_OPTIONS;
    const isFarmNation = audience === "farm_nation_users";

    const buildFilters = (): BroadcastFilters => ({
        audience,
        state: stateFilter || undefined,
        sellerStatus: isSellerAudience ? sellerStatus : undefined,
        moduleStatus: hasModuleStatus ? moduleStatus : undefined,
        farmNationRole: isFarmNation && farmNationRole ? farmNationRole as any : undefined,
        csvEmails: audience === "csv_upload" ? csvEmails : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
    });

    async function handleEstimate() {
        setEstimating(true);
        try {
            const res = await fetch("/api/admin/broadcast/estimate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildFilters()),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || "Failed to estimate recipients", "error");
                setEstimating(false);
                return;
            }
            setRecipientCount(data.data.count);
            setTotalMatches(data.data.totalMatches);
            setRecipientSample(data.data.sample);
            setModuleStats(data.data.moduleStats || null);
        } catch (err: any) {
            showToast(err.message || "Failed to estimate recipients — potential timeout.", "error");
        }
        setEstimating(false);
    };

    async function handleSend() {
        setSending(true);
        try {
            const res = await fetch("/api/admin/broadcast/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filters: buildFilters(), subject, body }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || "Send failed", "error");
                setSending(false);
                return;
            }
            setResult({ sent: data.sent, failed: data.failed });
            setStep("done");
        } catch (err: any) {
            showToast(err.message || "Network error — the broadcast may still be sending in the background. Check history.", "error");
        }
        setSending(false);
    };

    const canProceed = subject.trim().length > 0 && body.trim().length > 3 && (audience !== "csv_upload" || csvEmails.length > 0);

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
                        {/* Audience — grouped */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Users className="w-5 h-5 text-slate-600" />
                                <h2 className="font-bold text-slate-900">Audience</h2>
                            </div>
                            <div className="space-y-5">
                                {AUDIENCE_GROUPS.map((group) => (
                                    <div key={group.label}>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{group.label}</p>
                                        <div className="grid grid-cols-1 gap-1.5">
                                            {group.options.map((opt) => (
                                                <label
                                                    key={opt.value}
                                                    className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${
                                                        audience === opt.value
                                                            ? "border-green-500 bg-green-50"
                                                            : "border-slate-200 hover:border-slate-300"
                                                    }`}
                                                >
                                                    <input type="radio" name="audience" value={opt.value}
                                                        checked={audience === opt.value}
                                                        onChange={() => {
                                                            setAudience(opt.value);
                                                            setRecipientCount(null);
                                                            // Reset sub-filters when switching audience
                                                            setModuleStatus(MODULE_STATUS_OPTIONS[opt.value]?.[0]?.value || "all");
                                                            setFarmNationRole("");
                                                        }}
                                                        className="mt-0.5 accent-green-600" />
                                                    <div>
                                                        <p className="font-semibold text-slate-900 text-sm">{opt.label}</p>
                                                        <p className="text-xs text-slate-500">{opt.desc}</p>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Filters / CSV Upload */}
                        {audience === "csv_upload" ? (
                            <div className="bg-white border border-slate-200 rounded-2xl p-6">
                                <div className="flex items-center gap-2 mb-4">
                                    <Upload className="w-5 h-5 text-slate-600" />
                                    <h2 className="font-bold text-slate-900">Upload CSV</h2>
                                </div>
                                <div>
                                    <input
                                        type="file"
                                        accept=".csv,.txt"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) { setCsvEmails([]); setCsvName(""); return; }
                                            setCsvName(file.name);
                                            const reader = new FileReader();
                                            reader.onload = (event) => {
                                                const text = event.target?.result as string;
                                                const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
                                                const matches = text.match(emailRegex) || [];
                                                const uniqueEmails = Array.from(new Set(matches.map(m => m.toLowerCase())));
                                                setCsvEmails(uniqueEmails);
                                                setRecipientCount(null);
                                            };
                                            reader.readAsText(file);
                                        }}
                                        className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border file:border-slate-200 file:text-sm file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 cursor-pointer"
                                    />
                                    {csvName && (
                                        <p className="mt-3 text-sm text-slate-600">
                                            Found <span className="font-bold text-green-700">{csvEmails.length}</span> valid email {csvEmails.length === 1 ? "address" : "addresses"}.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white border border-slate-200 rounded-2xl p-6">
                                <div className="flex items-center gap-2 mb-4">
                                    <MapPin className="w-5 h-5 text-slate-600" />
                                    <h2 className="font-bold text-slate-900">Filters</h2>
                                </div>
                                <div className="space-y-4">
                                    {/* State filter — all audiences */}
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">State (optional)</label>
                                        <select value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setRecipientCount(null); }}
                                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                            <option value="">All States</option>
                                            {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
                                        </select>
                                    </div>

                                    {/* Seller status filter */}
                                    {isSellerAudience && (
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Verification Status Filter</label>
                                            <select value={sellerStatus} onChange={(e) => { setSellerStatus(e.target.value as any); setRecipientCount(null); }}
                                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                                {SELLER_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                            </select>
                                        </div>
                                    )}

                                    {/* Module-level status filter (Cooperative, WAVE, Academy, Farm Nation) */}
                                    {hasModuleStatus && (
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                                Registration Status Filter
                                            </label>
                                            <select value={moduleStatus} onChange={(e) => { setModuleStatus(e.target.value); setRecipientCount(null); }}
                                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                                {MODULE_STATUS_OPTIONS[audience].map((s) => (
                                                    <option key={s.value} value={s.value}>{s.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Farm Nation role filter */}
                                    {isFarmNation && (
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Farm Nation Role</label>
                                            <select value={farmNationRole} onChange={(e) => { setFarmNationRole(e.target.value); setRecipientCount(null); }}
                                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                                                {FARM_NATION_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                            </select>
                                        </div>
                                    )}

                                    {/* Date Range Filter */}
                                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 mt-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3" /> Registered From
                                            </label>
                                            <input
                                                type="date"
                                                value={startDate}
                                                onChange={(e) => { setStartDate(e.target.value); setRecipientCount(null); }}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3" /> Registered To
                                            </label>
                                            <input
                                                type="date"
                                                value={endDate}
                                                onChange={(e) => { setEndDate(e.target.value); setRecipientCount(null); }}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

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
                                    if (diagnosing) return;
                                    setDiagnosing(true);
                                    try {
                                        const r = await diagnoseBroadcastAction();
                                        setDiagResult(JSON.stringify(r, null, 2));
                                    } finally {
                                        setDiagnosing(false);
                                    }
                                }}
                                disabled={diagnosing}
                                className="px-4 py-3 border border-amber-300 bg-amber-50 text-amber-800 font-semibold rounded-xl hover:bg-amber-100 transition text-xs flex items-center gap-2"
                            >
                                {diagnosing ? <Loader2 className="w-3 h-3 animate-spin" /> : "🔍"} Diagnose
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
                                    {totalMatches !== null && totalMatches > recipientCount && (
                                        <p className="text-[10px] text-green-600 font-medium opacity-80">
                                            ({totalMatches.toLocaleString()} records matched, merged {totalMatches - recipientCount} duplicates/invalid)
                                        </p>
                                    )}
                                    {recipientSample.length > 0 && (
                                        <p className="text-xs text-green-700 mt-1">
                                            Sample: {recipientSample.map((r) => r.email).join(", ")}
                                            {recipientCount > 3 ? ` + ${recipientCount - 3} more` : ""}
                                        </p>
                                    )}
                                    {moduleStats && moduleStats.total > 0 && (
                                        <div className="mt-3 text-xs bg-white/50 rounded-lg p-3 border border-green-200/50 shadow-sm">
                                            <p className="font-semibold text-slate-800 mb-2 border-b border-green-200/50 pb-1">Module Membership Base (Before Filter):</p>
                                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                                <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-slate-100">
                                                    <span className="text-[10px] uppercase tracking-wider mb-1">Total</span>
                                                    <span className="font-bold text-slate-900 text-sm">{moduleStats.total}</span>
                                                </div>
                                                <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-green-100">
                                                    <span className="text-[10px] uppercase tracking-wider mb-1">Approved</span>
                                                    <span className="font-bold text-green-700 text-sm">{moduleStats.approved}</span>
                                                </div>
                                                <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-amber-100">
                                                    <span className="text-[10px] uppercase tracking-wider mb-1">Pending</span>
                                                    <span className="font-bold text-amber-600 text-sm">{moduleStats.pending}</span>
                                                </div>
                                                {moduleStats.unpaid !== undefined && (
                                                    <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-orange-100">
                                                        <span className="text-[10px] uppercase tracking-wider mb-1">Unpaid</span>
                                                        <span className="font-bold text-orange-600 text-sm">{moduleStats.unpaid}</span>
                                                    </div>
                                                )}
                                                {moduleStats.rejected > 0 && (
                                                    <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-red-100">
                                                        <span className="text-[10px] uppercase tracking-wider mb-1">Rejected</span>
                                                        <span className="font-bold text-red-600 text-sm">{moduleStats.rejected}</span>
                                                    </div>
                                                )}
                                                {moduleStats.suspended > 0 && (
                                                    <div className="text-slate-600 flex flex-col items-center p-1 bg-white rounded shadow-sm border border-slate-100">
                                                        <span className="text-[10px] uppercase tracking-wider mb-1">Suspended</span>
                                                        <span className="font-bold text-slate-900 text-sm">{moduleStats.suspended}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
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
