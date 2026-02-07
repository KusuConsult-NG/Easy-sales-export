"use client";

import { useState } from "react";
import { Camera, CheckCircle, XCircle, Loader2, User, Shield } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/library";
import { useToast } from "@/contexts/ToastContext";

interface VerificationResult {
    valid: boolean;
    user?: {
        fullName: string;
        email: string;
        role: string;
        membershipId?: string;
        verified: boolean;
    };
    error?: string;
}

export default function VerifyIDPage() {
    const { showToast } = useToast();
    const [isScanning, setIsScanning] = useState(false);
    const [result, setResult] = useState<VerificationResult | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);

    const startScanning = async () => {
        setIsScanning(true);
        setResult(null);

        try {
            const codeReader = new BrowserQRCodeReader();
            const videoInputDevices = await codeReader.listVideoInputDevices();

            if (videoInputDevices.length === 0) {
                showToast("No camera found", "error");
                setIsScanning(false);
                return;
            }

            // Use the first camera (usually back camera on mobile)
            const selectedDeviceId = videoInputDevices[0].deviceId;

            // Directly decode without storing controls
            codeReader.decodeFromVideoDevice(
                selectedDeviceId,
                'video-preview',
                async (result, error) => {
                    if (result) {
                        // Stop scanning
                        codeReader.reset();
                        setIsScanning(false);

                        // Verify the QR code
                        await verifyQRCode(result.getText());
                    }
                }
            );
        } catch (error) {
            console.error("QR Scanner error:", error);
            showToast("Failed to start camera", "error");
            setIsScanning(false);
        }
    };

    const verifyQRCode = async (qrData: string) => {
        setIsVerifying(true);

        try {
            const response = await fetch("/api/qr/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qrData }),
            });

            const data = await response.json();

            if (data.success) {
                setResult({
                    valid: true,
                    user: data.user,
                });
                showToast("ID verified successfully!", "success");
            } else {
                setResult({
                    valid: false,
                    error: data.error || "Invalid QR code",
                });
                showToast(data.error || "Verification failed", "error");
            }
        } catch (error) {
            setResult({
                valid: false,
                error: "Verification failed. Please try again.",
            });
            showToast("Verification failed", "error");
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
            <div className="max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                        <Shield className="w-8 h-8 text-blue-600" />
                        Verify Digital ID
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">
                        Scan a member's QR code to verify their identity
                    </p>
                </div>

                {/* Scanner Section */}
                {!result && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        {!isScanning ? (
                            <div className="text-center">
                                <div className="w-24 h-24 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Camera className="w-12 h-12 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                    Ready to Scan
                                </h2>
                                <p className="text-slate-600 dark:text-slate-300 mb-6">
                                    Click the button below to activate your camera and scan a Digital ID QR code
                                </p>
                                <button
                                    onClick={startScanning}
                                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center gap-2 mx-auto"
                                >
                                    <Camera className="w-5 h-5" />
                                    Start Scanning
                                </button>
                            </div>
                        ) : (
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 text-center">
                                    Position QR Code in View
                                </h3>
                                <div className="relative">
                                    <video
                                        id="video-preview"
                                        className="w-full rounded-xl bg-black"
                                        style={{ maxHeight: "400px" }}
                                    />
                                    {isVerifying && (
                                        <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                                            <Loader2 className="w-12 h-12 text-white animate-spin" />
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => setIsScanning(false)}
                                    className="w-full mt-4 px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded-xl transition"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Result Section */}
                {result && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        {result.valid ? (
                            <div>
                                <div className="flex items-center justify-center mb-6">
                                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                                        <CheckCircle className="w-10 h-10 text-green-600" />
                                    </div>
                                </div>
                                <h2 className="text-2xl font-bold text-green-600 text-center mb-6">
                                    Valid Digital ID
                                </h2>

                                {result.user && (
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                                            <div className="flex items-center gap-3 mb-3">
                                                <User className="w-5 h-5 text-slate-500" />
                                                <span className="text-sm text-slate-500 dark:text-slate-400">Member Information</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Full Name</p>
                                                    <p className="font-semibold text-slate-900 dark:text-white">{result.user.fullName}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Email</p>
                                                    <p className="font-semibold text-slate-900 dark:text-white">{result.user.email}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Role</p>
                                                    <span className="inline-block mt-1 px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-semibold capitalize">
                                                        {result.user.role}
                                                    </span>
                                                </div>
                                                {result.user.membershipId && (
                                                    <div>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">Membership ID</p>
                                                        <p className="font-mono text-sm text-slate-900 dark:text-white">{result.user.membershipId}</p>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Verification Status</p>
                                                    <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-semibold ${result.user.verified
                                                        ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                                                        : "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
                                                        }`}>
                                                        {result.user.verified ? "Verified" : "Pending"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-center justify-center mb-6">
                                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
                                        <XCircle className="w-10 h-10 text-red-600" />
                                    </div>
                                </div>
                                <h2 className="text-2xl font-bold text-red-600 text-center mb-4">
                                    Invalid QR Code
                                </h2>
                                <p className="text-slate-600 dark:text-slate-300 text-center">
                                    {result.error || "This QR code could not be verified. It may be expired, tampered with, or invalid."}
                                </p>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setResult(null);
                                setIsScanning(false);
                            }}
                            className="w-full mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                        >
                            Scan Another ID
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
