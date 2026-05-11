"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    previewSmsBroadcastAction,
    sendSmsBroadcastAction,
    type SmsAudience,
    type SmsFilters,
} from "@/app/actions/sms-broadcast";
import { toast } from "sonner";

// ── Constants ──────────────────────────────────────────────────────────────

const AUDIENCES: { value: SmsAudience; label: string; description: string }[] = [
    { value: "all", label: "All Users", description: "Every registered user on the platform" },
    { value: "buyers", label: "Buyers", description: "Users with a buyer marketplace account" },
    { value: "sellers", label: "All Sellers", description: "Approved sellers (wholesale + retail)" },
    { value: "wholesale_sellers", label: "Wholesale Sellers", description: "Approved wholesale sellers only" },
    { value: "retail_sellers", label: "Retail Sellers", description: "Approved retail sellers only" },
    { value: "marketplace_onboarded", label: "Marketplace Users", description: "All marketplace-onboarded users (buyers + sellers)" },
    { value: "cooperative_members", label: "Cooperative Members", description: "Active cooperative members" },
    { value: "wave_applicants", label: "WAVE Applicants", description: "Users who applied to the WAVE program" },
    { value: "wave_briefing_registrants", label: "WAVE Briefing Registrants", description: "Users registered for WAVE briefings" },
    { value: "academy_users", label: "Academy Users", description: "All Academy applicants" },
    { value: "export_users", label: "Export Users", description: "All Export onboarding applicants" },
    { value: "farm_nation_users", label: "Farm Nation Users", description: "All Farm Nation inquiries" },
    { value: "unpaid_applicants", label: "Unpaid Applicants", description: "Users who applied but have not completed their required payment" },
    { value: "abandoned_failed_transactions", label: "Abandoned / Failed Transactions", description: "Users with failed or aborted payments" },
    { value: "custom", label: "Custom Recipients", description: "Upload a CSV or manually enter numbers" },
];

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara",
];

const SMS_MAX_LENGTH = 160;

// ── Component ──────────────────────────────────────────────────────────────

export default function SmsBroadcastPage() {
    const router = useRouter();

    const [audience, setAudience] = useState<SmsAudience>("all");
    const [state, setState] = useState("");
    const [sellerStatus, setSellerStatus] = useState<"all" | "approved" | "pending" | "suspended">("all");
    const [customPhonesText, setCustomPhonesText] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [message, setMessage] = useState("");

    const [preview, setPreview] = useState<{ count: number; sample: { name: string; phone: string }[] } | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ success: boolean; sent: number; failed: number; skipped: number; error?: string } | null>(null);

    const isSellerAudience = ["sellers", "wholesale_sellers", "retail_sellers"].includes(audience);
    const charCount = message.length;
    const smsCount = Math.ceil(charCount / SMS_MAX_LENGTH) || 1;

    const parseCustomPhones = (text: string): string[] => {
        const matches = text.match(/\d{10,}/g) || [];
        return Array.from(new Set(matches));
    };

    const buildFilters = (): SmsFilters => ({
        audience,
        state: state || undefined,
        sellerStatus: isSellerAudience ? sellerStatus : undefined,
        customRecipients: audience === "custom" ? parseCustomPhones(customPhonesText) : undefined,
    });

    function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            // Merge with existing text
            const newText = customPhonesText ? customPhonesText + "\n" + text : text;
            setCustomPhonesText(newText);
            setPreview(null);
            
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        };
        reader.readAsText(file);
    };

    async function handlePreview() {
        if (audience === "custom" && customPhonesText.trim() === "") {
            toast.error("Please enter or upload at least one phone number.");
            return;
        }

        setLoadingPreview(true);
        setPreview(null);
        setResult(null);
        toast.loading("Finding recipients...", { id: "sms-preview" });
        try {
            const res = await previewSmsBroadcastAction(buildFilters());
            if (res.success) {
                setPreview(res.data);
                if (res.data.count === 0) {
                    toast.error("No valid recipients found.", { id: "sms-preview" });
                } else {
                    toast.success(`Found ${res.data.count} recipients.`, { id: "sms-preview" });
                }
            } else {
                toast.error(res.error || "Failed to estimate recipients.", { id: "sms-preview" });
            }
        } catch (e: any) {
            toast.error(e.message || "Failed to estimate recipients.", { id: "sms-preview" });
        } finally {
            setLoadingPreview(false);
        }
    };

    async function handleSend() {
        if (!message.trim()) return;
        if (!preview || preview.count === 0) {
            toast.error("Please run a preview first and ensure there are recipients.");
            return;
        }
        const confirmed = confirm(
            `You are about to send an SMS to ${preview.count.toLocaleString()} recipients. This cannot be undone. Continue?`
        );
        if (!confirmed) return;

        setSending(true);
        setResult(null);
        toast.loading(`Sending SMS to ${preview.count} users...`, { id: "sms-send", duration: 100000 });
        try {
            const res = await sendSmsBroadcastAction(buildFilters(), message.trim());
            if (res.success) {
                const resultData = { success: true, ...res.data };
                setResult(resultData);
                toast.success(`Complete: Sent ${res.data.sent}, Failed ${res.data.failed}`, { id: "sms-send", duration: 5000 });
            } else {
                setResult({ success: false, error: res.error, sent: 0, failed: 0, skipped: 0 });
                toast.error(`Broadcast Error: ${res.error}`, { id: "sms-send", duration: 8000 });
            }
        } catch (e: any) {
            toast.error(e.message || "A critical error occurred while sending.", { id: "sms-send" });
        } finally {
            setSending(false);
        }
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
                    <h1 className="text-lg font-semibold text-white">SMS Broadcast</h1>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

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

                    {/* Optional Filters or Custom Recipients UI */}
                    {audience === "custom" ? (
                        <div className="mt-5">
                            <label className="text-white/60 text-xs font-medium mb-1.5 flex justify-between items-center">
                                <span>Phone Numbers (comma separated or line by line)</span>
                                <span className="text-emerald-400 font-semibold">{parseCustomPhones(customPhonesText).length} valid numbers</span>
                            </label>
                            <textarea
                                value={customPhonesText}
                                onChange={(e) => { setCustomPhonesText(e.target.value); setPreview(null); }}
                                placeholder="e.g. 08012345678, +2349012345678&#10;Or paste a whole column of numbers..."
                                className="w-full px-3 py-3 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:border-emerald-500 h-32 resize-y"
                            />
                            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                                <span className="text-white/40 text-xs">You can also upload a CSV or TXT file to extract numbers.</span>
                                <div>
                                    <input 
                                        type="file" 
                                        accept=".csv,.txt" 
                                        ref={fileInputRef} 
                                        onChange={handleFileUpload} 
                                        className="hidden" 
                                        id="csv-upload" 
                                    />
                                    <label 
                                        htmlFor="csv-upload" 
                                        className="cursor-pointer px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition-colors inline-block"
                                    >
                                        Upload File
                                    </label>
                                </div>
                            </div>
                        </div>
                    ) : (
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
                                    <label className="block text-white/60 text-xs font-medium mb-1.5">Verification Status Filter</label>
                                    <select
                                        value={sellerStatus}
                                        onChange={(e) => { setSellerStatus(e.target.value as any); setPreview(null); }}
                                        className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="all">All Statuses</option>
                                        <option value="approved">Approved</option>
                                        <option value="pending">Pending</option>
                                        <option value="suspended">Suspended</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Message Composer */}
                <div className="rounded-2xl border border-white/10 p-6" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <h2 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">2</span>
                        Compose Message
                    </h2>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Type your SMS message here... Keep it concise and clear."
                        rows={5}
                        maxLength={160}
                        className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500 resize-none"
                    />
                    <div className="flex items-center justify-between mt-2">
                        <p className="text-white/40 text-xs">
                            {charCount} characters (Maximum 160)
                        </p>
                        <p className={`text-xs font-medium ${charCount >= 160 ? "text-amber-400" : "text-white/40"}`}>
                            {charCount}/160
                        </p>
                    </div>
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
                                ~{preview.count.toLocaleString()} recipients with phone numbers
                            </p>
                            {preview.sample.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {preview.sample.map((r, i) => (
                                        <p key={i} className="text-white/50 text-xs">
                                            {r.name} · +{r.phone}
                                        </p>
                                    ))}
                                    {preview.count > 3 && (
                                        <p className="text-white/30 text-xs">...and {preview.count - 3} more</p>
                                    )}
                                </div>
                            )}
                            {preview.count === 0 && (
                                <p className="text-amber-400 text-xs mt-1">No users with valid phone numbers found for this filter.</p>
                            )}
                        </div>
                    )}

                    {preview && preview.count > 0 && (
                        <button
                            onClick={handleSend}
                            disabled={sending || !message.trim()}
                            className="mt-4 px-6 py-2.5 rounded-xl font-medium text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                        >
                            {sending ? `Sending to ${preview.count.toLocaleString()} recipients...` : `Send SMS to ${preview.count.toLocaleString()} Recipients`}
                        </button>
                    )}

                    {result && (
                        <div className={`mt-4 p-4 rounded-xl border ${result.success ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                            {result.success ? (
                                <div>
                                    <p className="text-emerald-400 font-semibold text-sm">✅ Broadcast Complete</p>
                                    <p className="text-white/60 text-xs mt-1">
                                        Sent: {result.sent.toLocaleString()} · Failed: {result.failed.toLocaleString()} · Skipped: {result.skipped.toLocaleString()}
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-red-400 font-semibold text-sm">❌ Broadcast Failed</p>
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
