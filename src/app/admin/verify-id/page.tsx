"use client";

import { useState } from "react";
import { logger } from '@/lib/logger';
import { ScanLine, CheckCircle, XCircle, Loader2, ShieldCheck } from "lucide-react";

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

export default function VerifyIDPage() {
    const [qrData, setQrData] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [result, setResult] = useState<VerificationResult | null>(null);

    const handleVerify = async () => {
        if (!qrData.trim()) return;

        setVerifying(true);
        setResult(null);

        try {
            const response = await fetch("/api/qr/verify", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ qrData }),
            });

            const data = await response.json();
            setResult(data);
        } catch (error) {
            logger.error("Verification failed:", error);
            setResult({
                valid: false,
                error: "Verification failed. Please try again.",
            });
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <ShieldCheck className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900">
                            Verify Digital ID
                        </h1>
                    </div>
                    <p className="text-slate-600">
                        Scan or manually enter QR code data to verify member identity
                    </p>
                </div>

                {/* Verification Form */}
                <div className="bg-white rounded-lg p-8 shadow-lg mb-6">
                    <div className="flex items-center space-x-3 mb-6">
                        <ScanLine className="w-6 h-6 text-blue-600" />
                        <h2 className="text-xl font-semibold text-slate-900">
                            Enter QR Code Data
                        </h2>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label
                                htmlFor="qr-data"
                                className="block text-sm font-medium text-slate-900 mb-2"
                            >
                                QR Code Data (Encrypted String)
                            </label>
                            <textarea
                                id="qr-data"
                                rows={4}
                                value={qrData}
                                onChange={(e) => setQrData(e.target.value)}
                                placeholder="Paste encrypted QR code data here..."
                                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                            />
                        </div>

                        <button
                            onClick={handleVerify}
                            disabled={!qrData.trim() || verifying}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                        >
                            {verifying ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>Verifying...</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-5 h-5" />
                                    <span>Verify Digital ID</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Verification Result */}
                {result && (
                    <div
                        className={`rounded-lg p-8 shadow-lg ${result.valid
                                ? "bg-emerald-50 border border-emerald-200"
                                : "bg-red-50 border border-red-200"
                            }`}
                    >
                        <div className="flex items-center space-x-3 mb-6">
                            {result.valid ? (
                                <CheckCircle className="w-8 h-8 text-emerald-600" />
                            ) : (
                                <XCircle className="w-8 h-8 text-red-600" />
                            )}
                            <h2
                                className={`text-2xl font-bold ${result.valid ? "text-emerald-900" : "text-red-900"
                                    }`}
                            >
                                {result.valid ? "Valid Digital ID" : "Invalid Digital ID"}
                            </h2>
                        </div>

                        {result.valid && result.data ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-emerald-700 mb-1">
                                            Member Number
                                        </p>
                                        <p className="font-mono font-bold text-lg text-emerald-900">
                                            {result.memberNumber}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-emerald-700 mb-1">
                                            Role
                                        </p>
                                        <p className="font-semibold text-lg text-emerald-900 uppercase">
                                            {result.role.replace("_", " ")}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-sm text-emerald-700 mb-1">
                                        Full Name
                                    </p>
                                    <p className="font-semibold text-lg text-emerald-900">
                                        {result.fullName}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm text-emerald-700 mb-1">
                                        Email
                                    </p>
                                    <p className="text-emerald-900">
                                        {result.email}
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-emerald-200">
                                    <p className="text-sm text-emerald-700 mb-1">
                                        Valid Until
                                    </p>
                                    <p className="text-emerald-900">
                                        {new Date(result.expiresAt).toLocaleDateString("en-GB", {
                                            day: "2-digit",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <p className="text-red-800 text-lg">
                                    {result.error || "QR code verification failed"}
                                </p>
                                <p className="text-red-700 text-sm mt-2">
                                    Please ensure the QR code data is correct and try again.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Instructions */}
                {!result && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                        <h3 className="font-semibold text-blue-900 mb-3">
                            How to Verify
                        </h3>
                        <ol className="space-y-2 text-sm text-blue-800">
                            <li className="flex items-start space-x-2">
                                <span className="font-bold">1.</span>
                                <span>Scan the QR code using a QR scanner app</span>
                            </li>
                            <li className="flex items-start space-x-2">
                                <span className="font-bold">2.</span>
                                <span>Copy the encrypted data from the scanner</span>
                            </li>
                            <li className="flex items-start space-x-2">
                                <span className="font-bold">3.</span>
                                <span>Paste the data into the field above</span>
                            </li>
                            <li className="flex items-start space-x-2">
                                <span className="font-bold">4.</span>
                                <span>Click "Verify Digital ID" to validate</span>
                            </li>
                        </ol>
                    </div>
                )}
            </div>
        </div>
    );
}
