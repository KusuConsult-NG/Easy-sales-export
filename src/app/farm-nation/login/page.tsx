"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, Sprout, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const initialState = { error: "", success: false };

function FarmNationLoginContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/farm-nation";

    // Add callbackUrl to the server action payload
    const loginWithCallback = async (prevState: any, formData: FormData) => {
        formData.append("callbackUrl", callbackUrl);
        return loginAction(prevState, formData);
    };

    const [state, formAction, isPending] = useActionState(loginWithCallback, initialState);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }
    }, [state.error, isPending, showToast]);

    return (
        <div className="min-h-screen bg-emerald-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-md bg-emerald-900/50 backdrop-blur-xl border border-emerald-800 rounded-3xl p-8 shadow-2xl relative z-10">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-800 rounded-2xl mb-4 shadow-lg border border-emerald-700">
                        <Sprout className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-emerald-200">Sign in to your Farm Nation account</p>
                </div>

                {/* Form */}
                <form action={formAction} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-emerald-100 ml-1">Email Address</label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-3.5 w-5 h-5 text-emerald-400 group-focus-within:text-emerald-300 transition-colors" />
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    placeholder="Enter your email"
                                    className="w-full bg-emerald-950/50 border border-emerald-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-emerald-700"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-emerald-100 ml-1">Password</label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-3.5 w-5 h-5 text-emerald-400 group-focus-within:text-emerald-300 transition-colors" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    required
                                    placeholder="Enter your password"
                                    className="w-full bg-emerald-950/50 border border-emerald-800 text-white rounded-xl pl-10 pr-12 py-3 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-emerald-700"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-3.5 text-emerald-400 hover:text-emerald-300 transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded-sm border-emerald-700 bg-emerald-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-emerald-900"
                            />
                            <span className="text-emerald-300 group-hover:text-emerald-200 transition-colors">Remember me</span>
                        </label>
                        <Link
                            href="/auth/forgot-password"
                            className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                        >
                            Forgot Password?
                        </Link>
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
                        loadingText="Signing in..."
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        Sign In
                    </LoadingButton>

                    <p className="text-center text-emerald-300 text-sm">
                        Don't have an account?{" "}
                        <Link
                            href="/farm-nation/register"
                            className="text-emerald-400 hover:text-emerald-200 font-bold transition-colors"
                        >
                            Register Now
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default function FarmNationLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-emerald-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        }>
            <FarmNationLoginContent />
        </Suspense>
    );
}
