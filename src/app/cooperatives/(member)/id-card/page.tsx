"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft, Download, Loader2, Lock, Clock, CreditCard,
    CheckCircle, IdCard, Shield, Camera, Upload, RefreshCw,
} from "lucide-react";
import { getCooperativeMemberIdCardAction, updatePassportPhotoAction, type MemberIdCardData } from "@/app/actions/cooperative";
import { uploadDocumentAction } from "@/app/actions/upload";
import { useToast } from "@/contexts/ToastContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-NG", { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

function fmtShort(iso: string) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-NG", { year: "numeric", month: "short" }).format(new Date(iso));
}

// ── Passport Upload Widget ────────────────────────────────────────────────────

function PassportUploadWidget({ onUploaded }: { onUploaded: (url: string, name: string) => void }) {
    const { showToast } = useToast();
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const ALLOWED = ["image/jpeg", "image/jpg", "image/png"];

    const handleFile = async (file: File | null) => {
        if (!file) return;
        if (!ALLOWED.includes(file.type)) {
            showToast("Only JPG or PNG images allowed for passport photos.", "error");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast("Photo too large — max 5 MB.", "error");
            return;
        }

        setUploading(true);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error("Failed to read file"));
                reader.readAsDataURL(file);
            });

            const result = await uploadDocumentAction(base64, file.name, file.type, "passportPhoto");
            if (!result.success || !result.url) {
                showToast(result.error || "Upload failed. Please try again.", "error");
                return;
            }

            // Save to Firestore member record
            const save = await updatePassportPhotoAction(result.url, file.name);
            if (!save.success) {
                showToast(save.error || "Failed to save photo.", "error");
                return;
            }

            showToast("Passport photo uploaded successfully! Refreshing your ID card…", "success");
            onUploaded(result.url, file.name);
        } catch {
            showToast("Unexpected error — please try again.", "error");
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                    <Camera className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-amber-900 mb-1">Passport Photo Required</h3>
                    <p className="text-sm text-amber-700 mb-4">
                        Upload a clear, passport-style photograph to appear on your ID card. JPG or PNG only, max 5 MB.
                    </p>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {uploading ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                        ) : (
                            <><Upload className="w-4 h-4" /> Upload Passport Photo</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── ID Card Component ─────────────────────────────────────────────────────────

function IdCardFace({ data }: { data: MemberIdCardData }) {
    const isPremium = data.membershipTier === "premium";

    return (
        <div
            id="cooperative-id-card"
            style={{ fontFamily: "'Arial', sans-serif", width: "380px", minHeight: "220px" }}
            className={`relative overflow-hidden rounded-2xl shadow-2xl select-none
                ${isPremium
                    ? "bg-linear-to-br from-amber-700 via-yellow-600 to-amber-800"
                    : "bg-linear-to-br from-purple-800 via-purple-700 to-indigo-800"
                }`}
        >
            {/* Decorative circles */}
            <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
            <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-white/5" />

            {/* Holographic shimmer strip */}
            <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), rgba(200,180,255,0.4), rgba(255,255,255,0.6), transparent)",
                }}
            />

            {/* Header */}
            <div className="relative px-5 pt-4 pb-2 flex items-center justify-between border-b border-white/20">
                <div className="flex items-center gap-2.5">
                    <div className="bg-white px-2 py-1 rounded-lg shadow flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/images/logo.jpg"
                            alt="Easy Sales Export"
                            className="h-10 w-auto object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>
                    <div>
                        <p className="text-white font-black text-sm tracking-wider uppercase leading-tight">Easy Sales</p>
                        <p className="text-white/70 text-[10px] leading-tight font-semibold uppercase tracking-widest">Cooperative</p>
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    {isPremium && (
                        <div className="px-2 py-0.5 rounded-full text-[10px] tracking-wide font-bold shadow-sm bg-yellow-300 text-yellow-900 mb-1">
                            ★ PREMIUM
                        </div>
                    )}
                    <Shield className="w-5 h-5 text-white/40" />
                </div>
            </div>

            {/* Body */}
            <div className="relative px-5 pt-3 pb-4 flex items-start gap-4">
                {/* Passport photo */}
                <div className="shrink-0">
                    {data.passportPhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={data.passportPhotoUrl}
                            alt="Passport"
                            crossOrigin="anonymous"
                            className="w-20 h-24 object-cover rounded-lg border-2 border-white/40 shadow-lg"
                        />
                    ) : (
                        <div className="w-20 h-24 rounded-lg border-2 border-white/30 bg-white/10 flex items-center justify-center">
                            <IdCard className="w-8 h-8 text-white/40" />
                        </div>
                    )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                    <p className="text-white font-black text-base leading-tight mb-1 truncate">{data.fullName}</p>
                    <p className="text-white/60 text-xs uppercase tracking-widest mb-2">{data.memberNumber}</p>

                    <div className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">Gender</span>
                            <span className="text-white font-semibold capitalize">{data.gender}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">State</span>
                            <span className="text-white font-semibold">{data.stateOfOrigin}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">Issued</span>
                            <span className="text-white font-semibold">{fmtShort(data.joinedAt)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">Valid Until</span>
                            <span className="font-bold text-yellow-300">{fmtShort(data.validUntil)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer — solid dark strip matching mockup */}
            <div className="relative px-5 py-2.5 bg-black/30 flex items-center justify-center">
                <p className="text-white/70 text-xs font-semibold tracking-wider">easysalesexport.com</p>
            </div>
        </div>
    );
}

// ── Gate States ───────────────────────────────────────────────────────────────

function PaymentRequiredGate() {
    return (
        <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center text-center max-w-sm w-full">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                <CreditCard className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Payment Required</h2>
            <p className="text-slate-500 text-sm mb-6">
                Your membership ID card is generated after your ₦10,000 membership fee is verified on Paystack.
            </p>
            <Link
                href="/cooperatives/onboarding"
                className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition"
            >
                Complete Payment
            </Link>
        </div>
    );
}

function PendingApprovalGate({ data, onPhotoUploaded }: { data?: MemberIdCardData; onPhotoUploaded: (url: string, name: string) => void }) {
    const hasPhoto = !!data?.passportPhotoUrl;
    return (
        <div className="w-full max-w-lg space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <Clock className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Awaiting Admin Approval</h2>
                {data?.fullName && (
                    <p className="text-slate-700 font-semibold mb-1">{data.fullName}</p>
                )}
                <p className="text-slate-500 text-sm mb-2">
                    Your payment has been verified ✅. Your ID card will be ready once an admin approves your membership.
                </p>
                <p className="text-xs text-slate-400">This usually takes 1–2 business days.</p>
            </div>
            {!hasPhoto && (
                <PassportUploadWidget onUploaded={onPhotoUploaded} />
            )}
            {hasPhoto && (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    <p className="text-sm text-green-700 font-medium">Passport photo uploaded ✓ — your ID will be ready after approval.</p>
                </div>
            )}
        </div>
    );
}

function NotMemberGate() {
    return (
        <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center text-center max-w-sm w-full">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-slate-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Not a Member Yet</h2>
            <p className="text-slate-500 text-sm mb-6">Join the cooperative to receive your official membership ID card.</p>
            <Link
                href="/cooperatives/onboarding"
                className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition"
            >
                Join Cooperative
            </Link>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CooperativeIdCardPage() {
    const router = useRouter();
    const cardRef = useRef<HTMLDivElement>(null);
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [result, setResult] = useState<Awaited<ReturnType<typeof getCooperativeMemberIdCardAction>> | null>(null);

    const fetchData = () => {
        setLoading(true);
        getCooperativeMemberIdCardAction().then((res) => {
            setResult(res);
            setLoading(false);
        });
    };

    useEffect(() => { fetchData(); }, []);

    // Called after a successful passport upload — refresh card data
    const handlePhotoUploaded = (_url: string, _name: string) => {
        fetchData();
    };

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const html2canvas = (await import("html2canvas")).default;
            const jsPDF = (await import("jspdf")).jsPDF;

            const el = document.getElementById("cooperative-id-card");
            if (!el) return;

            const canvas = await html2canvas(el, {
                scale: 3,
                useCORS: true,
                backgroundColor: null,
                logging: false,
            });

            const imgData = canvas.toDataURL("image/png");

            // CR80 card: 86mm × 54mm — landscape
            const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [86, 54] });
            pdf.addImage(imgData, "PNG", 0, 0, 86, 54);

            const fileName = `ESE-CoopID-${result?.data?.memberNumber || "card"}.pdf`;
            pdf.save(fileName);
            showToast("ID card downloaded!", "success");
        } catch (e) {
            console.error("Download failed:", e);
            showToast("Download failed — please try again.", "error");
        } finally {
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-10 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Back */}
                <Link
                    href="/cooperatives/dashboard"
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 mb-8 text-sm font-medium transition"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>

                <h1 className="text-3xl font-black text-slate-900 mb-1">Membership ID Card</h1>
                <p className="text-slate-500 mb-8">Your official Easy Sales Export Cooperative ID</p>

                {/* Gate checks */}
                {result?.reason === "not_member" && (
                    <div className="flex justify-center"><NotMemberGate /></div>
                )}
                {result?.reason === "payment_required" && (
                    <div className="flex justify-center"><PaymentRequiredGate /></div>
                )}
                {result?.reason === "pending_approval" && (
                    <div className="flex justify-center">
                        <PendingApprovalGate data={result.data} onPhotoUploaded={handlePhotoUploaded} />
                    </div>
                )}

                {/* Active member — show card */}
                {result?.success && result.data && (
                    <div className="space-y-8">
                        {/* Status banner */}
                        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                            <div>
                                <p className="font-semibold text-green-800">Active Member</p>
                                <p className="text-sm text-green-700">
                                    Your card is valid until <strong>{fmt(result.data.validUntil)}</strong>
                                </p>
                            </div>
                        </div>

                        {/* Passport upload prompt if missing */}
                        {!result.data.passportPhotoUrl && (
                            <PassportUploadWidget onUploaded={handlePhotoUploaded} />
                        )}

                        {/* Replace photo option if they have one */}
                        {result.data.passportPhotoUrl && (
                            <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl">
                                <p className="text-sm text-slate-600 font-medium">Passport photo on file ✓</p>
                                <button
                                    onClick={() => {
                                        setResult((prev) => prev ? { ...prev, data: prev.data ? { ...prev.data, passportPhotoUrl: null } : prev.data } : prev);
                                    }}
                                    className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-semibold transition"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Replace photo
                                </button>
                            </div>
                        )}

                        {/* Card preview */}
                        <div className="flex flex-col items-center gap-6">
                            <div ref={cardRef}>
                                <IdCardFace data={result.data} />
                            </div>

                            {/* Card back info */}
                            <div className="w-full max-w-[340px] bg-slate-800 rounded-2xl px-5 py-4 text-white text-xs space-y-2">
                                <div className="h-8 bg-black rounded" />
                                <p className="text-slate-400 text-center leading-relaxed mt-2">
                                    This card is the property of Easy Sales Export Ltd. If found, please return to{" "}
                                    <span className="text-purple-300">support@easysalesexport.com</span>
                                </p>
                                <div className="flex justify-between pt-1 border-t border-white/10 text-slate-500">
                                    <span>Issued: {fmtShort(result.data.joinedAt)}</span>
                                    <span>Valid: {fmtShort(result.data.validUntil)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Download button */}
                        <div className="flex flex-col items-center gap-3">
                            <button
                                onClick={handleDownload}
                                disabled={downloading}
                                className="inline-flex items-center gap-3 px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-2xl shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {downloading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Generating PDF...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-5 h-5" />
                                        Download for Printing
                                    </>
                                )}
                            </button>
                            <p className="text-xs text-slate-400">
                                Downloads as a high-resolution PDF (CR80 card size · 86×54mm)
                            </p>
                        </div>

                        {/* Member details table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <h2 className="font-bold text-slate-900 mb-4 text-lg">Member Details</h2>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                                {[
                                    ["Full Name", result.data.fullName],
                                    ["Member No.", result.data.memberNumber],
                                    ["Tier", result.data.membershipTier === "premium" ? "★ Premium" : "Basic"],
                                    ["Gender", result.data.gender],
                                    ["State of Origin", result.data.stateOfOrigin],
                                    ["Issue Date", fmt(result.data.joinedAt)],
                                    ["Valid Until", fmt(result.data.validUntil)],
                                    ["Status", "Active ✅"],
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <p className="text-slate-500 text-xs uppercase tracking-wide">{label}</p>
                                        <p className="font-semibold text-slate-900 capitalize">{value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
