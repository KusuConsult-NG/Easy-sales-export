"use client";

import { useState } from "react";
import { Camera, Upload, CheckCircle, XCircle, Clock, AlertCircle, Loader2 } from "lucide-react";
import { verifyDigitalIDQR, type QRVerificationResult, type DigitalIDPayload } from "@/lib/digital-id";
import { logger } from "@/lib/logger";

export default function VerifyIDPage() {
    const [qrData, setQrData] = useState<string>("");
    const [verifying, setVerifying] = useState(false);
    const [result, setResult] = useState<QRVerificationResult | null>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setVerifying(true);
        setResult(null);

        try {
            // For now, we'll handle manual QR data input
            // In production, use a QR scanner library to read from image
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target?.result as string;
                // This is simplified - in production, use jsQR or similar to decode QR from image
                logger.debug("QR image uploaded");
                setVerifying(false);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            logger.error("Failed to process QR code", error instanceof Error ? error : undefined);
            setVerifying(false);
        }
    };

    const handleManualVerify = () => {
        if (!qrData.trim()) return;

        setVerifying(true);
        setTimeout(() => {
            const verificationResult = verifyDigitalIDQR(qrData);
            setResult(verificationResult);
            setVerifying(false);

            // Log verification attempt (in production, save to Firestore)
            logger.info("Digital ID verification attempt", {
                timestamp: new Date().toISOString(),
                result: verificationResult.valid ? "valid" : "invalid",
                error: verificationResult.error,
            });
        }, 500);
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <CheckCircle className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">
                            Verify Digital ID
                        </h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Scan or upload a QR code to verify membership
                    </p>
                </div>

                {/* Verification Methods */}
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-8 mb-6">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
                        Verification Methods
                    </h2>

                    {/* Upload QR Image */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Upload QR Code Image
                        </label>
                        <div className="flex items-center justify-center w-full">
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <Upload className="w-8 h-8 text-slate-500 mb-2" />
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        <span className="font-semibold">Click to upload</span> or drag and drop
                                    </p>
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                            </label>
                        </div>
                    </div>

                    {/* Manual QR Data Input */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Or Enter QR Data Manually
                        </label>
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                value={qrData}
                                onChange={(e) => setQrData(e.target.value)}
                                placeholder="Paste encrypted QR data..."
                                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white"
                            />
                            <button
                                onClick={handleManualVerify}
                                disabled={verifying || !qrData.trim()}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {verifying ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    "Verify"
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Verification Result */}
                {result && (
                    <div
                        className={`rounded-lg p-6 ${result.valid
                            ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
                            : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                            }`}
                    >
                        <div className="flex items-start space-x-3">
                            {result.valid ? (
                                <CheckCircle className="w-6 h-6 text-emerald-600 mt-1" />
                            ) : (
                                <XCircle className="w-6 h-6 text-red-600 mt-1" />
                            )}
                            <div className="flex-1">
                                <h3
                                    className={`text-lg font-semibold mb-2 ${result.valid
                                        ? "text-emerald-900 dark:text-emerald-100"
                                        : "text-red-900 dark:text-red-100"
                                        }`}
                                >
                                    {result.valid ? "✓ Valid Member ID" : "✗ Invalid QR Code"}
                                </h3>

                                {result.valid && result.payload ? (
                                    <div className="space-y-2 text-sm">
                                        <div>
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                                                Member Number:
                                            </span>{" "}
                                            <span className="text-emerald-700 dark:text-emerald-300 font-mono">
                                                {result.payload.memberNumber}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                                                Name:
                                            </span>{" "}
                                            <span className="text-emerald-700 dark:text-emerald-300">
                                                {result.payload.fullName}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                                                Email:
                                            </span>{" "}
                                            <span className="text-emerald-700 dark:text-emerald-300">
                                                {result.payload.email}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                                                Role:
                                            </span>{" "}
                                            <span className="text-emerald-700 dark:text-emerald-300 capitalize">
                                                {result.payload.role.replace("_", " ")}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                                                Valid Until:
                                            </span>{" "}
                                            <span className="text-emerald-700 dark:text-emerald-300">
                                                {new Date(result.payload.expiresAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-red-700 dark:text-red-300">
                                        {result.error || "Invalid QR code format"}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Info Section */}
                <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                    <div className="flex items-start space-x-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                                Verification Guidelines
                            </h3>
                            <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
                                <li>• All verification attempts are logged for security</li>
                                <li>• QR codes expire after 1 year from issue date</li>
                                <li>• Only authenticated users can access this page</li>
                                <li>• Contact support if you encounter issues</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
