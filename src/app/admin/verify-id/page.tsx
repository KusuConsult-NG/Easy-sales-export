"use client";

import { useState } from "react";
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
            console.error("Verification failed:", error);
            setResult({
                valid: false,
                error: "Verification failed. Please try again.",
            });
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <ShieldCheck className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">
                            Verify Digital ID
                        </h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Scan or manually enter QR code data to verify member identity
                    </p>
                </div>

                {/* Verification Form */}
                <div className="bg-white dark:bg-slate-800 rounded-lg p-8 shadow-lg mb-6">
                    <div className="flex items-center space-x-3 mb-6">
                        <ScanLine className="w-6 h-6 text-blue-600" />
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Enter QR Code Data
                        </h2>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label
                                htmlFor="qr-data"
                                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
                            >
                                QR Code Data (Encrypted String)
                            </label>
                            <textarea
                                id="qr-data"
                                rows={4}
                                value={qrData}
                                onChange={(e) => setQrData(e.target.value)}
                                placeholder="Paste encrypted QR code data here..."
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white font-mono text-sm"
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
                                ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
                                : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                            }`}
                    >
                        <div className="flex items-center space-x-3 mb-6">
                            {result.valid ? (
                                <CheckCircle className="w-8 h-8 text-emerald-600" />
                            ) : (
                                <XCircle className="w-8 h-8 text-red-600" />
                            )}
                            <h2
                                className={`text-2xl font-bold ${result.valid ? "text-emerald-900 dark:text-emerald-100" : "text-red-900 dark:text-red-100"
                                    }`}
                            >
                                {result.valid ? "Valid Digital ID" : "Invalid Digital ID"}
                            </h2>
                        </div>

                        {result.valid && result.data ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">
                                            Member Number
                                        </p>
                                        <p className="font-mono font-bold text-lg text-emerald-900 dark:text-emerald-100">
                                            {result.data.memberNumber}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">
                                            Role
                                        </p>
                                        <p className="font-semibold text-lg text-emerald-900 dark:text-emerald-100 uppercase">
                                            {result.data.role.replace("_", " ")}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">
                                        Full Name
                                    </p>
                                    <p className="font-semibold text-lg text-emerald-900 dark:text-emerald-100">
                                        {result.data.fullName}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">
                                        Email
                                    </p>
                                    <p className="text-emerald-900 dark:text-emerald-100">
                                        {result.data.email}
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-emerald-200 dark:border-emerald-800">
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">
                                        Valid Until
                                    </p>
                                    <p className="text-emerald-900 dark:text-emerald-100">
                                        {new Date(result.data.expiresAt).toLocaleDateString("en-GB", {
                                            day: "2-digit",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <p className="text-red-800 dark:text-red-200 text-lg">
                                    {result.error || "QR code verification failed"}
                                </p>
                                <p className="text-red-700 dark:text-red-300 text-sm mt-2">
                                    Please ensure the QR code data is correct and try again.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Instructions */}
                {!result && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">
                            How to Verify
                        </h3>
                        <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
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
