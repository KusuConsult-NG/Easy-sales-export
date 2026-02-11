"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, Ship, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const initialState = { error: "", success: false };

function ExportLoginContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/export";

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
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-slate-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative z-10">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-800 rounded-2xl mb-4 shadow-lg border border-slate-700">
                        <Ship className="w-8 h-8 text-slate-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Export Windows</h1>
                    <p className="text-slate-300">Login to manage your export portfolio</p>
                </div>

                {/* Form */}
                <form action={formAction} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-200 ml-1">Email Address</label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-3.5 w-5 h-5 text-slate-400 group-focus-within:text-slate-300 transition-colors" />
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    placeholder="Enter your email"
                                    className="w-full bg-slate-950/50 border border-slate-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-all placeholder:text-slate-600"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-200 ml-1">Password</label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-3.5 w-5 h-5 text-slate-400 group-focus-within:text-slate-300 transition-colors" />
                                <input
                                    type="text" // preventing autocomplete
                                    name="password"
                                    required
                                    placeholder="Enter your password"
                                    className="w-full bg-slate-950/50 border border-slate-800 text-white rounded-xl pl-10 pr-12 py-3 focus:outline-hidden focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-all placeholder:text-slate-600"
                                    style={{ WebkitTextSecurity: showPassword ? "none" : "disc" } as React.CSSProperties}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-300 transition-colors"
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
                                className="w-4 h-4 rounded-sm border-slate-600 bg-slate-800 text-slate-500 focus:ring-slate-500 focus:ring-offset-slate-900"
                            />
                            <span className="text-slate-300 group-hover:text-slate-200 transition-colors">Remember me</span>
                        </label>
                        <Link
                            href="/auth/forgot-password"
                            className="text-slate-400 hover:text-slate-200 transition-colors font-medium"
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
                        className="w-full bg-slate-100 hover:bg-white text-slate-900 font-bold py-3.5 rounded-xl shadow-lg shadow-white/5 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        Sign In
                    </LoadingButton>

                    <p className="text-center text-slate-400 text-sm">
                        New on Export Windows?{" "}
                        <Link
                            href="/export/register"
                            className="text-white hover:text-slate-200 font-bold transition-colors"
                        >
                            Start Investing
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default function ExportLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
            </div>
        }>
            <ExportLoginContent />
        </Suspense>
    );
}
