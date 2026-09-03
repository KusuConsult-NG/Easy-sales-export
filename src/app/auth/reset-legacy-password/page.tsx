"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Lock, Eye, EyeOff, Loader2, ShieldCheck, CheckCircle } from "lucide-react";
import { changePasswordAction } from "@/app/actions/auth";
import { COMPANY_INFO } from "@/lib/constants";
import { useToast } from "@/contexts/ToastContext";

export default function ResetLegacyPasswordPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        
        if (newPassword !== confirmPassword) {
            showToast("Passwords do not match", "error");
            return;
        }

        if (newPassword.length < 6) {
            showToast("New PIN must be at least 6 characters", "error");
            return;
        }

        setIsSubmitting(true);

        try {
            // We use the existing changePasswordAction which updates Auth and verify current
            const result = await changePasswordAction(currentPassword, newPassword);
            
            if (result.success) {
                // The requiresPasswordChange flag is cleared by
                // changePasswordAction itself now.
                //
                // It used to be a second call to clearLegacyPasswordFlagAction,
                // which deleted the flag and verified nothing — so anyone
                // holding the temporary password could call that action
                // directly and skip the change entirely. The flow here was
                // right; the action it depended on was reachable without it.
                setIsSuccess(true);
                // #306 The change now revokes every session, this one included —
                // there is no way to exempt the caller, and leaving the intruder
                // signed in was the defect. So this goes to sign-in rather than
                // to /dashboard, which would have bounced there anyway once the
                // token re-synced, without saying why.
                showToast(
                    result.sessionsRevoked
                        ? "Account secured. Please sign in again with your new password."
                        : "Password changed, but your other devices could not be signed out. Please contact support.",
                    result.sessionsRevoked ? "success" : "error",
                );

                setTimeout(() => {
                    router.push(result.sessionsRevoked ? "/auth/login" : "/dashboard");
                }, 2000);
            } else {
                showToast(result.error || "Failed to update security. Check your default PIN.", "error");
            }
        } catch (error) {
            showToast("An unexpected error occurred", "error");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Password Secured!</h1>
                    <p className="text-slate-600 mb-8">
                        Your account is now secure. Redirecting you to your dashboard...
                    </p>
                    <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-3 mb-4">
                        <Image
                            src="/images/logo.jpg"
                            alt="Logo"
                            width={48}
                            height={48}
                            className="rounded-xl shadow-lg"
                        />
                        <span className="text-xl font-bold text-slate-900">{COMPANY_INFO.name}</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Secure Your Account</h1>
                    <p className="text-slate-600">
                        Please update your temporary password to continue.
                    </p>
                </div>

                <div className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100">
                    <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl mb-8 border border-blue-100">
                        <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0" />
                        <p className="text-sm text-blue-800">
                            You are using a default PIN provided by an administrator.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Current Password */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Default PIN
                            </label>
                            <div className="relative">
                                <input
                                    type={showCurrent ? "text" : "password"}
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    placeholder="Enter the PIN from your email"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrent(!showCurrent)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showCurrent ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <hr className="border-slate-100" />

                        {/* New Password */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                New Password / PIN
                            </label>
                            <div className="relative">
                                <input
                                    type={showNew ? "text" : "password"}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Create a secure password or PIN"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(!showNew)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Minimum 6 characters for security.</p>
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Confirm New Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showConfirm ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Repeat your new password"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(!showConfirm)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Updating Security...
                                </>
                            ) : (
                                "Secure Account & Continue"
                            )}
                        </button>
                    </form>
                </div>

                <p className="text-center text-sm text-slate-500 mt-8">
                    Easy Sales Export Security Protocol
                </p>
            </div>
        </div>
    );
}
