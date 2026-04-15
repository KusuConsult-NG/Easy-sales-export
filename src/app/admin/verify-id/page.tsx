"use client";

import { useState, useRef } from "react";
import { logger } from '@/lib/logger';
import { ScanLine, CheckCircle, XCircle, Loader2, ShieldCheck, Upload, Search, User, AlertTriangle } from "lucide-react";

interface VerificationResult {
    valid: boolean;
    data?: {
        userId: string;
        memberNumber: string;
        fullName: string;
        email: string;
        role: string;
        timestamp: number;
        expiresAt: number;
    };
    error?: string;
}

interface MemberLookupResult {
    found: boolean;
    member?: {
        id: string;
        fullName: string;
        email: string;
        memberNumber: string;
        role: string;
        status: string;
        paymentStatus?: string;
        membershipTier?: string;
        joinedAt?: string;
    };
    error?: string;
}

type Tab = "upload" | "lookup";

export default function VerifyIDPage() {
    const [activeTab, setActiveTab] = useState<Tab>("upload");

    // QR file upload state
    const [qrFile, setQrFile] = useState<File | null>(null);
    const [qrPreview, setQrPreview] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [result, setResult] = useState<VerificationResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Member lookup state
    const [lookupQuery, setLookupQuery] = useState("");
    const [lookupType, setLookupType] = useState<"memberNumber" | "email">("memberNumber");
    const [looking, setLooking] = useState(false);
    const [lookupResult, setLookupResult] = useState<MemberLookupResult | null>(null);

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            alert("Please select an image file (PNG, JPG, etc.)");
            return;
        }
        setQrFile(file);
        setResult(null);
        const reader = new FileReader();
        reader.onload = () => setQrPreview(reader.result as string);
        reader.readAsDataURL(file);
    };

    async function handleVerifyQR() {
        if (!qrFile) return;
        setVerifying(true);
        setResult(null);

        try {
            // Dynamically import jsQR to decode QR from image canvas
            const jsQR = (await import("jsqr")).default;
            const img = new Image();
            const objectUrl = URL.createObjectURL(qrFile);
            img.src = objectUrl;
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error("Failed to load image"));
            });
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);

            const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
            if (!qrCode) {
                setResult({ valid: false, error: "No QR code detected in this image. Ensure the image is clear and the QR code is fully visible." });
                return;
            }

            // Send decoded data to verify API
            const response = await fetch("/api/qr/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qrData: qrCode.data }),
            });
            const data = await response.json();
            setResult(data);
        } catch (error) {
            logger.error("QR verification failed:", error);
            setResult({ valid: false, error: "Failed to read or verify QR code. Ensure jsqr is installed and the image is clear." });
        } finally {
            setVerifying(false);
        }
    };

    async function handleMemberLookup() {
        if (!lookupQuery.trim()) return;
        setLooking(true);
        setLookupResult(null);

        try {
            const response = await fetch(
                `/api/admin/verify-id/lookup?type=${lookupType}&query=${encodeURIComponent(lookupQuery.trim())}`,
                { method: "GET" }
            );
            const data = await response.json();
            setLookupResult(data);
        } catch (error) {
            logger.error("Member lookup failed:", error);
            setLookupResult({ found: false, error: "Lookup failed. Please try again." });
        } finally {
            setLooking(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <ShieldCheck className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900">Verify Member ID</h1>
                    </div>
                    <p className="text-slate-600">
                        Upload a member&apos;s QR code image or look up by member number / email
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 p-1 mb-6">
                    {([
                        { id: "upload" as Tab, label: "Scan QR Code", icon: Upload },
                        { id: "lookup" as Tab, label: "Member Lookup", icon: Search },
                    ]).map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                                activeTab === id
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "text-slate-600 hover:bg-slate-50"
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            {label}
                        </button>
                    ))}
                </div>

                {/* Tab: QR Upload */}
                {activeTab === "upload" && (
                    <div className="bg-white rounded-2xl p-8 shadow-lg mb-6">
                        <div className="flex items-center space-x-3 mb-6">
                            <ScanLine className="w-6 h-6 text-blue-600" />
                            <h2 className="text-xl font-semibold text-slate-900">Upload QR Code Image</h2>
                        </div>

                        {/* Drop Zone */}
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                                qrFile
                                    ? "border-blue-400 bg-blue-50"
                                    : "border-slate-300 hover:border-blue-400 hover:bg-blue-50"
                            }`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            {qrPreview ? (
                                <div className="flex flex-col items-center gap-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qrPreview} alt="QR preview" className="max-h-48 rounded-lg shadow-sm" />
                                    <p className="text-sm text-blue-600 font-medium">{qrFile?.name}</p>
                                    <p className="text-xs text-slate-500">Click to change image</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3">
                                    <Upload className="w-12 h-12 text-slate-300" />
                                    <div>
                                        <p className="font-semibold text-slate-700">Click to upload QR code image</p>
                                        <p className="text-sm text-slate-500 mt-1">PNG, JPG, or any image format</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-700">
                                <strong>Note:</strong> Requires the <code className="bg-amber-100 px-1 rounded text-xs">jsqr</code> package.
                                Run <code className="bg-amber-100 px-1 rounded text-xs">npm install jsqr</code> if not already installed.
                            </p>
                        </div>

                        <button
                            onClick={handleVerifyQR}
                            disabled={!qrFile || verifying}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                        >
                            {verifying ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /><span>Decoding QR…</span></>
                            ) : (
                                <><ShieldCheck className="w-5 h-5" /><span>Verify QR Code</span></>
                            )}
                        </button>

                        {/* QR Verification Result */}
                        {result && (
                            <div className={`mt-6 rounded-xl p-6 border ${result.valid ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                                <div className="flex items-center gap-3 mb-4">
                                    {result.valid
                                        ? <CheckCircle className="w-7 h-7 text-emerald-600" />
                                        : <XCircle className="w-7 h-7 text-red-600" />
                                    }
                                    <h3 className={`text-xl font-bold ${result.valid ? "text-emerald-900" : "text-red-900"}`}>
                                        {result.valid ? "✓ Valid Member ID" : "✗ Invalid QR Code"}
                                    </h3>
                                </div>
                                {result.valid && result.data ? (
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div><p className="text-emerald-600 text-xs mb-0.5">Member Number</p><p className="font-bold text-emerald-900 font-mono">{result.data.memberNumber}</p></div>
                                        <div><p className="text-emerald-600 text-xs mb-0.5">Role</p><p className="font-bold text-emerald-900 uppercase">{result.data.role.replace("_", " ")}</p></div>
                                        <div className="col-span-2"><p className="text-emerald-600 text-xs mb-0.5">Full Name</p><p className="font-bold text-emerald-900 text-lg">{result.data.fullName}</p></div>
                                        <div><p className="text-emerald-600 text-xs mb-0.5">Email</p><p className="text-emerald-900">{result.data.email}</p></div>
                                        <div><p className="text-emerald-600 text-xs mb-0.5">Valid Until</p>
                                            <p className="text-emerald-900">{new Date(result.data.expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-red-700">{result.error || "QR code verification failed."}</p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab: Member Lookup */}
                {activeTab === "lookup" && (
                    <div className="bg-white rounded-2xl p-8 shadow-lg mb-6">
                        <div className="flex items-center space-x-3 mb-6">
                            <Search className="w-6 h-6 text-blue-600" />
                            <h2 className="text-xl font-semibold text-slate-900">Lookup Member</h2>
                        </div>

                        <div className="space-y-4">
                            <div className="flex gap-2">
                                {([
                                    { value: "memberNumber", label: "Member No." },
                                    { value: "email", label: "Email" },
                                ] as const).map(({ value, label }) => (
                                    <button
                                        key={value}
                                        onClick={() => setLookupType(value)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                                            lookupType === value
                                                ? "bg-blue-600 text-white"
                                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={lookupQuery}
                                    onChange={(e) => setLookupQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleMemberLookup()}
                                    placeholder={lookupType === "memberNumber" ? "e.g. AWSL-00123" : "e.g. user@example.com"}
                                    className="flex-1 px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                                <button
                                    onClick={handleMemberLookup}
                                    disabled={!lookupQuery.trim() || looking}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {looking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                                    {looking ? "Searching…" : "Search"}
                                </button>
                            </div>

                            {lookupResult && (
                                <div className={`mt-4 rounded-xl p-6 border ${lookupResult.found ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                                    {lookupResult.found && lookupResult.member ? (
                                        <>
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                                                    <User className="w-6 h-6 text-blue-600" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-900 text-lg">{lookupResult.member.fullName}</p>
                                                    <p className="text-sm text-slate-500 font-mono">{lookupResult.member.memberNumber}</p>
                                                </div>
                                                <span className={`ml-auto px-3 py-1 rounded-full text-xs font-bold capitalize ${
                                                    lookupResult.member.status === "approved" || lookupResult.member.status === "active"
                                                        ? "bg-green-100 text-green-700"
                                                        : lookupResult.member.status === "pending"
                                                        ? "bg-yellow-100 text-yellow-700"
                                                        : "bg-red-100 text-red-700"
                                                }`}>{lookupResult.member.status}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 text-sm">
                                                <div><p className="text-xs text-slate-400 mb-0.5">Email</p><p className="font-medium">{lookupResult.member.email}</p></div>
                                                <div><p className="text-xs text-slate-400 mb-0.5">Role</p><p className="font-medium capitalize">{lookupResult.member.role?.replace(/_/g, " ")}</p></div>
                                                {lookupResult.member.membershipTier && (
                                                    <div><p className="text-xs text-slate-400 mb-0.5">Tier</p><p className="font-medium capitalize">{lookupResult.member.membershipTier}</p></div>
                                                )}
                                                {lookupResult.member.paymentStatus && (
                                                    <div><p className="text-xs text-slate-400 mb-0.5">Payment</p><p className="font-medium capitalize">{lookupResult.member.paymentStatus}</p></div>
                                                )}
                                                {lookupResult.member.joinedAt && (
                                                    <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">Joined</p><p className="font-medium">{new Date(lookupResult.member.joinedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</p></div>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <XCircle className="w-6 h-6 text-red-500 shrink-0" />
                                            <p className="text-red-700">{lookupResult.error || "No member found with that details."}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Instructions */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                    <h3 className="font-semibold text-blue-900 mb-3">How to Verify</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm text-blue-800">
                        <div>
                            <p className="font-semibold mb-1">📷 QR Code (Scan tab)</p>
                            <ol className="space-y-1 list-decimal list-inside text-xs">
                                <li>Member downloads their QR code from the app</li>
                                <li>Member shares the image file (WhatsApp, email, etc.)</li>
                                <li>Admin uploads the image here</li>
                                <li>System decodes and verifies automatically</li>
                            </ol>
                        </div>
                        <div>
                            <p className="font-semibold mb-1">🔍 Member Lookup</p>
                            <ol className="space-y-1 list-decimal list-inside text-xs">
                                <li>Enter the member&apos;s number or email</li>
                                <li>Click Search to pull live profile</li>
                                <li>Verify name, status, and payment</li>
                                <li>No QR code needed for quick verification</li>
                            </ol>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
