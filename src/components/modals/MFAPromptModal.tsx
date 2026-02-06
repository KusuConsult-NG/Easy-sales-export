"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, AlertCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";

interface MFAPromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    targetUrl: string;
}

export default function MFAPromptModal({
    isOpen,
    onClose,
    targetUrl,
}: MFAPromptModalProps) {
    const router = useRouter();
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [isVerifying, setIsVerifying] = useState(false);

    const handleVerify = async () => {
        if (code.length !== 6) {
            setError("Please enter a 6-digit code");
            return;
        }

        setIsVerifying(true);
        setError("");

        try {
            const response = await fetch("/api/auth/mfa/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });

            const data = await response.json();

            if (data.success) {
                // Redirect to target URL
                router.push(targetUrl);
                onClose();
            } else {
                setError(data.error || "Invalid code. Please try again.");
            }
        } catch (err) {
            setError("Failed to verify. Please try again.");
        } finally {
            setIsVerifying(false);
        }
    };

    const handleSetup = () => {
        router.push("/settings/security/mfa");
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Multi-Factor Authentication Required">
            <div className="space-y-4">
                {/* Info */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                                MFA Required
                            </p>
                            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                This action requires multi-factor authentication. Please enter your 6-digit verification code.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Code Input */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Verification Code
                    </label>
                    <input
                        type="text"
                        value={code}
                        onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                            setCode(value);
                            setError("");
                        }}
                        placeholder="000000"
                        maxLength={6}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-center text-2xl font-mono tracking-widest text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                        disabled={isVerifying}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                        Enter the 6-digit code from your authenticator app
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3 pt-4">
                    <button
                        onClick={handleVerify}
                        disabled={code.length !== 6 || isVerifying}
                        className="w-full px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isVerifying ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Verifying...
                            </>
                        ) : (
                            "Verify & Continue"
                        )}
                    </button>

                    <button
                        onClick={handleSetup}
                        className="w-full px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        Set Up MFA
                    </button>

                    <button
                        onClick={onClose}
                        className="w-full px-6 py-3 text-slate-600 dark:text-slate-400 font-medium hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
}
