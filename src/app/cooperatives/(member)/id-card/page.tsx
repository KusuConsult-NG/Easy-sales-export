"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
    ArrowLeft, Download, Loader2, Lock, Clock, CreditCard,
    CheckCircle, IdCard, Shield, Camera, Upload, RefreshCw, AlertTriangle,
} from "lucide-react";
import { getCooperativeMemberIdCardAction, updatePassportPhotoAction, updateMemberProfileDetailsAction, type MemberIdCardData } from "@/app/actions/cooperative";
import { useToast } from "@/contexts/ToastContext";
import { COOPERATIVE_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";

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

    async function handleFile(file: File | null) {
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
            const formData = new FormData();
            formData.append("file", file);
            formData.append("folder", "id-cards");
            formData.append("documentType", "passportPhoto");

            const res = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await res.json();
            
            if (!res.ok || !result.success || !result.url) {
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
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [isLoadingImage, setIsLoadingImage] = useState<boolean>(!!data.passportPhotoUrl);

    useEffect(() => {
        if (!data.passportPhotoUrl) {
            setImgSrc(null);
            setIsLoadingImage(false);
            return;
        }

        setIsLoadingImage(true);
        let isMounted = true;

        // Fetch through our server-side proxy — the server fetches from Cloudinary
        // with no browser CORS restrictions, then returns a base64 data URI.
        // This is the only reliable approach on mobile browsers.
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(data.passportPhotoUrl)}`;

        fetch(proxyUrl)
            .then(res => {
                if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
                return res.json();
            })
            .then(({ dataUri }: { dataUri: string }) => {
                if (isMounted) {
                    setImgSrc(dataUri);
                    setIsLoadingImage(false);
                }
            })
            .catch(err => {
                console.error("[IdCardFace] proxy fetch failed:", err);
                if (isMounted) {
                    // Do NOT fall back to the raw Cloudinary URL — it will taint
                    // the canvas on mobile and break the PDF download.
                    // Instead show the no-photo placeholder; user can still download.
                    setImgSrc(null);
                    setIsLoadingImage(false);
                }
            });

        return () => { isMounted = false; };
    }, [data.passportPhotoUrl]);

    return (
        <div
            id="cooperative-id-card"
            style={{ 
                fontFamily: "'Arial', sans-serif", 
                width: "338px", 
                height: "213px",
                background: "linear-gradient(to bottom right, #6b21a8, #7e22ce, #3730a3)"
            }}
            className="relative overflow-hidden rounded-2xl shadow-2xl select-none"
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
                <div>
                    <p className="text-white font-black text-sm tracking-wider uppercase">Easy Sales Export LTD</p>
                    <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest leading-tight">Cooperative Membership</p>
                </div>
                <div className="flex flex-col items-end shrink-0 pl-2">
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-300 text-purple-900`}>
                        {(data.membershipTier || "Member").replace(" Member", "").toUpperCase()}
                    </div>
                    <Shield className="w-5 h-5 text-white/40 mt-1" />
                </div>
            </div>

            {/* Body */}
            <div className="relative px-5 pt-3 pb-4 flex items-start gap-4">
                {/* Passport photo */}
                <div className="shrink-0">
                    {isLoadingImage ? (
                        <div className="w-20 h-24 rounded-lg border-2 border-white/30 bg-white/10 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-white/60 animate-spin" />
                        </div>
                    ) : imgSrc ? (
                        <div className="relative w-20 h-24 rounded-lg border-2 border-white/40 shadow-lg overflow-hidden bg-white/10 flex items-center justify-center">
                            {/* base64 imgSrc from server proxy — avoids CORS on mobile browsers.
                                next/image cannot render raw base64 data URIs, so native <img> is required. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={imgSrc}
                                alt="Passport"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    ) : (
                        <div className="w-20 h-24 rounded-lg border-2 border-white/30 bg-white/10 flex items-center justify-center">
                            <IdCard className="w-8 h-8 text-white/40" />
                        </div>
                    )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-white font-black text-base leading-tight mb-1 truncate">{data.fullName}</p>
                    <p className="text-white/60 text-xs uppercase tracking-widest mb-2">{data.memberNumber}</p>

                    <div className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">Gender</span>
                            <span className="text-white font-semibold capitalize">{data.gender || "—"}</span>
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
                            <span className={`font-bold text-white`}>{fmtShort(data.validUntil)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="relative px-5 py-2 border-t border-white/20 flex items-center justify-between">
                <div className="flex gap-0.5">
                    {Array.from({ length: 20 }).map((_, i) => (
                        <div key={i} className="w-1 h-1 rounded-full bg-white/20" />
                    ))}
                </div>
                <p className="text-white/40 text-[10px] tracking-wider">easysalesexport.com</p>
            </div>
        </div>
    );
}

function IdCardBack({ data }: { data: MemberIdCardData }) {
    return (
        <div
            style={{ 
                fontFamily: "'Arial', sans-serif", 
                width: "338px", 
                height: "213px",
                background: "linear-gradient(to bottom right, #1e293b, #0f172a)"
            }}
            className="relative overflow-hidden rounded-2xl shadow-2xl select-none text-white flex flex-col justify-between"
        >
            {/* Magnetic stripe */}
            <div className="w-full h-8 bg-black mt-4" />

            {/* Signature box placeholder */}
            <div className="px-5 mt-2 flex items-center justify-between">
                <div className="w-[180px] h-8 bg-white/10 rounded border border-white/20 flex items-center pl-2">
                    <span className="text-[8px] italic text-white/40">Authorized Signature</span>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-[8px] font-black tracking-wider uppercase text-purple-300">EASY SALES COOP</span>
                </div>
            </div>

            {/* Terms and Conditions */}
            <div className="px-5 text-center my-auto">
                <p className="text-[8px] text-white/80 font-bold mb-1 uppercase tracking-wider">Terms of Use</p>
                <p className="text-[7px] text-white/60 leading-relaxed max-w-[280px] mx-auto">
                    This card is the property of Easy Sales Export Ltd. If found, please return to info@easysalesexport.com or the nearest authority.
                </p>
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-white/10 flex items-center justify-between text-[8px] text-white/50">
                <span>Issued: {fmtShort(data.joinedAt)}</span>
                <span>Valid: {fmtShort(data.validUntil)}</span>
                <span className="font-bold">RC: 763845</span>
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
                Your membership ID card is generated after your {CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()} membership fee is verified on Paystack.
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

    const [isEditing, setIsEditing] = useState(false);
    const [editGender, setEditGender] = useState("");
    const [editState, setEditState] = useState("");
    const [saving, setSaving] = useState(false);

    const fetchData = () => {
        setLoading(true);
        getCooperativeMemberIdCardAction().then((res) => {
            setResult(res);
            if (res.success && res.data) {
                setEditGender(res.data.gender || "");
                setEditState(res.data.stateOfOrigin || "");
                if (!res.data.gender || !res.data.stateOfOrigin) {
                    setIsEditing(true);
                }
            }
            setLoading(false);
        });
    };

    useEffect(() => { fetchData(); }, []);

    async function handleSaveDetails() {
        if (!editGender || !editState) {
            showToast("Please fill in both Gender and State of Origin.", "error");
            return;
        }

        setSaving(true);
        try {
            const res = await updateMemberProfileDetailsAction(editGender, editState);
            if (res.success) {
                showToast("Profile details updated successfully!", "success");
                setIsEditing(false);
                fetchData();
            } else {
                showToast(res.error || "Failed to update details.", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("An unexpected error occurred.", "error");
        } finally {
            setSaving(false);
        }
    }

    // Called after a successful passport upload — refresh card data
    function handlePhotoUploaded(_url: string, _name: string) {
        fetchData();
    };

    async function handleDownload() {
        if (!result?.data) return;
        setDownloading(true);
        try {
            // ── Server-side ID card generation (PNG via SVG + sharp) ─────────────
            // Generates a high-resolution 900×567px PNG of the ID card.
            // PNG downloads directly to files/gallery on Android and iOS with
            // no PDF viewer chrome, no black borders, no scaling issues.
            const res = await fetch("/api/id-card/pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(result.data),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Server returned ${res.status}`);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ESE-CoopID-${result.data.memberNumber || "card"}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast("ID card downloaded!", "success");
        } catch (e) {
            console.error("[handleDownload] ID card generation failed:", e);
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

                {/* Generic failure fallback */}
                {result?.success === false && !["not_member", "payment_required", "pending_approval"].includes(result?.reason || "") && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center max-w-sm mx-auto">
                        <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-3" />
                        <h2 className="text-lg font-bold text-red-900 mb-1">Failed to Load ID Card</h2>
                        <p className="text-sm text-red-700 mb-4">{result.error || "An unexpected error occurred. Please try again."}</p>
                        <button
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition"
                        >
                            <RefreshCw className="w-4 h-4 animate-spin-hover" /> Try Again
                        </button>
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

                        {/* Missing details banner */}
                        {(!result.data.gender || !result.data.stateOfOrigin) && (
                            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-semibold text-amber-800">Missing ID Card Details</p>
                                    <p className="text-sm text-amber-700">
                                        Your ID card is missing key details (Gender, State of Origin). Please select them in the form below and click <strong>Save Details</strong> to complete your ID card.
                                    </p>
                                </div>
                            </div>
                        )}

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
                                        setResult((prev) => prev ? { ...prev, data: prev.data ? { ...prev.data, passportPhotoUrl: "" as any } : prev.data } : prev);
                                    }}
                                    className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-semibold transition"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Replace photo
                                </button>
                            </div>
                        )}

                        {/* Card preview */}
                        <div className="flex flex-col md:flex-row items-center justify-center gap-6">
                            <div>
                                <p className="text-xs text-slate-400 mb-2 text-center font-semibold">Front Side</p>
                                <div ref={cardRef}>
                                    <IdCardFace data={result.data} />
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 mb-2 text-center font-semibold">Back Side</p>
                                <IdCardBack data={result.data} />
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
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="font-bold text-slate-900 text-lg">Member Details</h2>
                                {!isEditing && (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="text-sm font-semibold text-purple-600 hover:text-purple-800 transition"
                                    >
                                        Edit Details
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Full Name</p>
                                    <p className="font-semibold text-slate-900 capitalize">{result.data.fullName}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Member No.</p>
                                    <p className="font-semibold text-slate-900 uppercase">{result.data.memberNumber}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Tier</p>
                                    <p className="font-semibold text-slate-900 capitalize">{result.data.membershipTier || "Member"}</p>
                                </div>

                                {isEditing ? (
                                    <>
                                        <div>
                                            <label htmlFor="edit-gender" className="text-slate-500 text-xs uppercase tracking-wide block mb-1">Gender *</label>
                                            <select
                                                id="edit-gender"
                                                value={editGender}
                                                onChange={(e) => setEditGender(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                            >
                                                <option value="">Select Gender</option>
                                                <option value="Male">Male</option>
                                                <option value="Female">Female</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="edit-state" className="text-slate-500 text-xs uppercase tracking-wide block mb-1">State of Origin *</label>
                                            <select
                                                id="edit-state"
                                                value={editState}
                                                onChange={(e) => setEditState(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                            >
                                                <option value="">Select State</option>
                                                {Object.keys(NIGERIAN_LOCATIONS).sort().map((state) => (
                                                    <option key={state} value={state}>{state}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <p className="text-slate-500 text-xs uppercase tracking-wide">Gender</p>
                                            <p className="font-semibold text-slate-900 capitalize">{result.data.gender || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-500 text-xs uppercase tracking-wide">State of Origin</p>
                                            <p className="font-semibold text-slate-900 capitalize">{result.data.stateOfOrigin || "—"}</p>
                                        </div>
                                    </>
                                )}

                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Issue Date</p>
                                    <p className="font-semibold text-slate-900">{fmt(result.data.joinedAt)}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Valid Until</p>
                                    <p className="font-semibold text-slate-900">{fmt(result.data.validUntil)}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs uppercase tracking-wide">Status</p>
                                    <p className="font-semibold text-slate-900">Active ✅</p>
                                </div>
                            </div>

                            {isEditing && (
                                <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                                    {(result.data.gender && result.data.stateOfOrigin) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditGender(result.data.gender || "");
                                                setEditState(result.data.stateOfOrigin || "");
                                                setIsEditing(false);
                                            }}
                                            disabled={saving}
                                            className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl text-sm transition disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleSaveDetails}
                                        disabled={saving}
                                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-sm transition disabled:opacity-75 disabled:cursor-not-allowed"
                                    >
                                        {saving ? (
                                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                                        ) : (
                                            "Save Details"
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
