"use client";

import { useState, useEffect } from "react";
import { Shield, Key, Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import Image from "next/image";
import toast from "react-hot-toast";

export default function MFASetupPage() {
    const [step, setStep] = useState<"setup" | "verify" | "complete">("setup");
    const [qrCode, setQrCode] = useState<string>("");
    const [secret, setSecret] = useState<string>("");
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [verificationCode, setVerificationCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [mfaEnabled, setMfaEnabled] = useState(false);

    useEffect(() => {
        checkMFAStatus();
    }, []);

    const checkMFAStatus = async () => {
        try {
            const response = await fetch("/api/auth/mfa/status");
            const data = await response.json();
            setMfaEnabled(data.enabled || false);
        } catch (error) {
            console.error("Failed to check MFA status:", error);
        }
    };

    const handleSetupMFA = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/auth/mfa/setup", {
                method: "POST",
            });

            const data = await response.json();

            if (data.success) {
                setQrCode(data.qrCode);
                setSecret(data.secret);
                setRecoveryCodes(data.recoveryCodes);
                setStep("verify");
                toast.success("Scan QR code with authenticator app");
            } else {
                toast.error(data.error || "Setup failed");
            }
        } catch (error) {
            toast.error("An error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerify = async () => {
        if (verificationCode.length !== 6) {
            toast.error("Please enter a 6-digit code");
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch("/api/auth/mfa/enable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: verificationCode }),
            });

            const data = await response.json();

            if (data.success) {
                setStep("complete");
                setMfaEnabled(true);
                toast.success("MFA enabled successfully!");
            } else {
                toast.error(data.error || "Verification failed");
            }
        } catch (error) {
            toast.error("Verification failed");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisableMFA = async () => {
        if (!confirm("Are you sure you want to disable MFA? This will reduce your account security.")) {
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch("/api/auth/mfa/disable", {
                method: "POST",
            });

            const data = await response.json();

            if (data.success) {
                setMfaEnabled(false);
                setStep("setup");
                toast.success("MFA disabled");
            } else {
                toast.error(data.error || "Failed to disable");
            }
        } catch (error) {
            toast.error("Failed to disable MFA");
        } finally {
            setIsLoading(false);
        }
    };

    const downloadRecoveryCodes = () => {
        const content = `Easy Sales Export - MFA Recovery Codes\n\nGenerated: ${new Date().toLocaleString()}\n\n${recoveryCodes.join('\n')}\n\nKeep these codes safe. Each can only be used once.`;
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "easy-sales-recovery-codes.txt";
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
            <div className="max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                        <Shield className="w-8 h-8 text-green-600" />
                        Multi-Factor Authentication
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">
                        Add an extra layer of security to your account
                    </p>
                </div>

                {mfaEnabled && step === "setup" ? (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <div className="flex items-center gap-3 text-green-600 mb-4">
                            <CheckCircle className="w-6 h-6" />
                            <h2 className="text-xl font-bold">MFA is Active</h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            Your account is protected with multi-factor authentication.
                        </p>
                        <button
                            onClick={handleDisableMFA}
                            disabled={isLoading}
                            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
                        >
                            {isLoading ? "Disabling..." : "Disable MFA"}
                        </button>
                    </div>
                ) : step === "setup" ? (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                            Enable MFA
                        </h2>
                        <div className="space-y-4 mb-6">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 font-bold flex-shrink-0">
                                    1
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white">Download Authenticator App</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        Install Google Authenticator, Authy, or Microsoft Authenticator
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 font-bold flex-shrink-0">
                                    2
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white">Scan QR Code</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        Use your app to scan the QR code we'll provide
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 font-bold flex-shrink-0">
                                    3
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white">Verify Setup</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        Enter the 6-digit code from your app
                                    </p>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={handleSetupMFA}
                            disabled={isLoading}
                            className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Setting up...
                                </>
                            ) : (
                                <>
                                    <Key className="w-5 h-5" />
                                    Start Setup
                                </>
                            )}
                        </button>
                    </div>
                ) : step === "verify" ? (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Scan QR Code
                        </h2>

                        <div className="flex flex-col items-center mb-6">
                            {qrCode && (
                                <div className="bg-white p-4 rounded-xl border-2 border-slate-200">
                                    <Image
                                        src={qrCode}
                                        alt="MFA QR Code"
                                        width={200}
                                        height={200}
                                    />
                                </div>
                            )}
                            <div className="mt-4 text-center">
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                    Or enter this code manually:
                                </p>
                                <code className="bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded text-sm font-mono">
                                    {secret}
                                </code>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Enter 6-digit code
                            </label>
                            <input
                                type="text"
                                maxLength={6}
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-center text-2xl tracking-widest font-mono"
                                placeholder="000000"
                            />
                        </div>

                        <button
                            onClick={handleVerify}
                            disabled={isLoading || verificationCode.length !== 6}
                            className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
                        >
                            {isLoading ? "Verifying..." : "Verify & Enable"}
                        </button>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
                        <div className="flex items-center justify-center flex-col mb-6">
                            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                MFA Enabled!
                            </h2>
                            <p className="text-slate-600 dark:text-slate-400 mt-2 text-center">
                                Your account is now protected with multi-factor authentication
                            </p>
                        </div>

                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-2">
                                        Save Your Recovery Codes
                                    </h3>
                                    <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-3">
                                        If you lose access to your authenticator app, you can use these codes to access your account. Each code can only be used once.
                                    </p>
                                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 mb-3">
                                        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                                            {recoveryCodes.map((code, i) => (
                                                <div key={i} className="text-slate-700 dark:text-slate-300">
                                                    {code}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <button
                                        onClick={downloadRecoveryCodes}
                                        className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg transition text-sm"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download Recovery Codes
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => window.location.href = "/dashboard"}
                            className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition"
                        >
                            Go to Dashboard
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
