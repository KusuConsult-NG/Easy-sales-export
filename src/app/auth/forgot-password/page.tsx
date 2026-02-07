"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";
import { ArrowLeft, Mail, Loader2, CheckCircle } from "lucide-react";
import { sendResetEmailAction, type SendResetEmailState } from "@/app/actions/password-reset";

const initialState: SendResetEmailState = {
    success: false,
    error: undefined
};

export default function ForgotPasswordPage() {
    const [state, formAction] = useActionState(sendResetEmailAction, initialState);
    const [email, setEmail] = useState("");

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
                    <h1 className="text-3xl font-bold text-white mb-2">Reset Password</h1>
                    <p className="text-blue-200">Enter your email to receive a reset link</p>
                </div>

                {state.success ? (
                    /* Success State */
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-10 h-10 text-green-300" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-4">Check Your Email</h2>
                            <p className="text-blue-100 mb-6">
                                If an account exists for {email}, we've sent password reset instructions to your email.
                            </p>
                            <p className="text-sm text-blue-200 mb-6">
                                Didn't receive it? Check your spam folder or try again.
                            </p>
                            <div className="space-y-3">
                                <Link
                                    href="/auth/login"
                                    className="block w-full px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition text-center"
                                >
                                    Return to Login
                                </Link>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Form State */
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                        <form action={formAction} className="space-y-6">
                            {/* Email Input */}
                            <div>
                                <label className="block text-sm font-semibold text-blue-100 mb-2">
                                    Email Address
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                    <input
                                        type="email"
                                        name="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="your.email@example.com"
                                        className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-blue-300/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        required
                                    />
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
                                <Mail className="w-5 h-5" />
                                Send Reset Link
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

                        {/* Contact Support */}
                        <div className="mt-6 pt-6 border-t border-white/10">
                            <p className="text-sm text-center text-blue-200">
                                Need help?{" "}
                                <a
                                    href={`mailto:${COMPANY_INFO.email}`}
                                    className="text-white underline hover:text-blue-300"
                                >
                                    Contact Support
                                </a>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
