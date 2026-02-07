"use client";

import { useState, useEffect, Suspense } from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle, Loader2 } from "lucide-react";
import { resetPasswordAction, type ResetPasswordState } from "@/app/actions/password-reset";

const initialState: ResetPasswordState = {
    success: false,
    error: undefined
};

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [state, formAction] = useActionState(resetPasswordAction, initialState);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Redirect after successful reset
    useEffect(() => {
        if (state.success) {
            setTimeout(() => {
                router.push('/auth/login');
            }, 3000);
        }
    }, [state.success, router]);

    // Validate token exists
    if (!token) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-900 via-primary to-slate-900 flex items-center justify-center p-4">
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 max-w-md text-center">
                    <h1 className="text-2xl font-bold text-white mb-4">Invalid Reset Link</h1>
                    <p className="text-blue-200 mb-6">
                        This password reset link is invalid or has expired.
                    </p>
                    <Link
                        href="/auth/forgot-password"
                        className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl transition"
                    >
                        Request New Link
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-primary to-slate-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <div className="relative w-full max-w-md">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <Link href="/" className="flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-2xl border-2 border-white/20"
                        />
                        <div className="text-left">
                            <h2 className="text-xl font-bold text-white">{COMPANY_INFO.name}</h2>
                            <p className="text-sm text-blue-300">{COMPANY_INFO.tagline}</p>
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-white mb-2">Create New Password</h1>
                    <p className="text-blue-200">Choose a strong password for your account</p>
                </div>

                {state.success ? (
                    /* Success State */
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-10 h-10 text-green-300" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-4">Password Reset Successful!</h2>
                            <p className="text-blue-100 mb-6">
                                Your password has been updated successfully.
                            </p>
                            <p className="text-sm text-blue-200 mb-6">
                                Redirecting you to login...
                            </p>
                            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                        </div>
                    </div>
                ) : (
                    /* Form State */
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                        <form action={formAction} className="space-y-6">
                            {/* Hidden Token Field */}
                            <input type="hidden" name="token" value={token} />

                            {/* New Password Input */}
                            <div>
                                <label className="block text-sm font-semibold text-blue-100 mb-2">
                                    New Password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter new password"
                                        className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-blue-300/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        required
                                        minLength={8}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white transition"
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                <p className="text-xs text-blue-200 mt-2">Must be at least 8 characters</p>
                            </div>

                            {/* Confirm Password Input */}
                            <div>
                                <label className="block text-sm font-semibold text-blue-100 mb-2">
                                    Confirm Password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        name="confirmPassword"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Confirm new password"
                                        className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-blue-300/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white transition"
                                    >
                                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>

                            {/* Error Message */}
                            {state.error && (
                                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                                    <p className="text-sm text-red-200">{state.error}</p>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                className="w-full px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                            >
                                <Lock className="w-5 h-5" />
                                Reset Password
                            </button>

                            {/* Back Link */}
                            <Link
                                href="/auth/login"
                                className="flex items-center justify-center gap-2 text-blue-200 hover:text-white transition"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back to Login
                            </Link>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-linear-to-br from-slate-900 via-primary to-slate-900 flex items-center justify-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>
            }
        >
            <ResetPasswordContent />
        </Suspense>
    );
}
