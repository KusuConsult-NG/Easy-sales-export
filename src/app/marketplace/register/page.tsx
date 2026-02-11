"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, Store, User, ArrowRight, Loader2 } from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const initialState = { error: "", success: false };

function MarketplaceRegisterContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/marketplace";

    const registerWithContext = async (prevState: any, formData: FormData) => {
        formData.append("callbackUrl", callbackUrl);
        formData.append("role", "user"); // Base user role, specific roles added during onboarding
        formData.append("platforms", "marketplace");
        return registerAction(prevState, formData);
    };

    const [state, formAction, isPending] = useActionState(registerWithContext, initialState);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }
    }, [state.error, isPending, showToast]);

    return (
        <div className="min-h-screen bg-violet-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-lg bg-violet-900/50 backdrop-blur-xl border border-violet-800 rounded-3xl p-8 shadow-2xl relative z-10">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-violet-800 rounded-2xl mb-4 shadow-lg border border-violet-700">
                        <Store className="w-8 h-8 text-violet-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Join Marketplace</h1>
                    <p className="text-violet-200">Start buying and selling today</p>
                </div>

                {/* Form */}
                <form action={formAction} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-violet-100 ml-1">First Name</label>
                            <div className="relative group">
                                <User className="absolute left-3 top-3.5 w-5 h-5 text-violet-400 group-focus-within:text-violet-300 transition-colors" />
                                <input
                                    type="text"
                                    name="firstName"
                                    required
                                    placeholder="First name"
                                    className="w-full bg-violet-950/50 border border-violet-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder:text-violet-700"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-violet-100 ml-1">Last Name</label>
                            <div className="relative group">
                                <User className="absolute left-3 top-3.5 w-5 h-5 text-violet-400 group-focus-within:text-violet-300 transition-colors" />
                                <input
                                    type="text"
                                    name="lastName"
                                    required
                                    placeholder="Last name"
                                    className="w-full bg-violet-950/50 border border-violet-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder:text-violet-700"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-violet-100 ml-1">Email Address</label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-3.5 w-5 h-5 text-violet-400 group-focus-within:text-violet-300 transition-colors" />
                            <input
                                type="email"
                                name="email"
                                required
                                placeholder="Enter your email"
                                className="w-full bg-violet-950/50 border border-violet-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder:text-violet-700"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-violet-100 ml-1">Password</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-3.5 w-5 h-5 text-violet-400 group-focus-within:text-violet-300 transition-colors" />
                            <input
                                type="text"
                                name="password"
                                required
                                minLength={8}
                                placeholder="Create a password"
                                className="w-full bg-violet-950/50 border border-violet-800 text-white rounded-xl pl-10 pr-12 py-3 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder:text-violet-700"
                                style={{ WebkitTextSecurity: showPassword ? "none" : "disc" } as React.CSSProperties}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-3.5 text-violet-400 hover:text-violet-300 transition-colors"
                            >
                                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>
                        <p className="text-xs text-violet-300 ml-1">Must be at least 8 characters long</p>
                    </div>

                    {state.error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-red-200">{state.error}</p>
                        </div>
                    )}

                    <LoadingButton
                        loading={isPending}
                        type="submit"
                        loadingText="Creating Account..."
                        className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-violet-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] group"
                    >
                        Create Account
                        <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform inline-block" />
                    </LoadingButton>

                    <p className="text-center text-violet-300 text-sm">
                        Already have an account?{" "}
                        <Link
                            href="/marketplace/login"
                            className="text-violet-400 hover:text-violet-200 font-bold transition-colors"
                        >
                            Sign In
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default function MarketplaceRegisterPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-violet-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
        }>
            <MarketplaceRegisterContent />
        </Suspense>
    );
}
