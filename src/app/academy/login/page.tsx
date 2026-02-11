"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, GraduationCap, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const initialState = { error: "", success: false };

function AcademyLoginContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/academy";

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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-md bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl border border-blue-200 dark:border-blue-800 rounded-3xl p-8 shadow-2xl relative z-10">
                {/* Header */}
                <div className="text-center mb-8">
                    <Link href="/academy" className="inline-flex items-center justify-center mb-4 hover:opacity-90 transition-opacity">
                        <div className="w-16 h-16 bg-blue-600 rounded-2xl shadow-lg flex items-center justify-center">
                            <GraduationCap className="w-8 h-8 text-white" />
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Academy Login</h1>
                    <p className="text-slate-600 dark:text-slate-400">Access your courses and learning materials</p>
                </div>

                {/* Form */}
                <form action={formAction} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-indigo-100 ml-1">Email Address</label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-3.5 w-5 h-5 text-indigo-400 group-focus-within:text-indigo-300 transition-colors" />
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    placeholder="Enter your email"
                                    className="w-full bg-indigo-950/50 border border-indigo-800 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-indigo-700"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-indigo-100 ml-1">Password</label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-3.5 w-5 h-5 text-indigo-400 group-focus-within:text-indigo-300 transition-colors" />
                                <input
                                    type="text" // preventing browser autocomplete popups
                                    name="password"
                                    required
                                    placeholder="Enter your password"
                                    className="w-full bg-indigo-950/50 border border-indigo-800 text-white rounded-xl pl-10 pr-12 py-3 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-indigo-700"
                                    style={{ WebkitTextSecurity: showPassword ? "none" : "disc" } as React.CSSProperties}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-3.5 text-indigo-400 hover:text-indigo-300 transition-colors"
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
                                className="w-4 h-4 rounded-sm border-indigo-700 bg-indigo-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-indigo-900"
                            />
                            <span className="text-indigo-300 group-hover:text-indigo-200 transition-colors">Remember me</span>
                        </label>
                        <Link
                            href="/auth/forgot-password"
                            className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
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
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        Sign In
                    </LoadingButton>

                    <p className="text-center text-indigo-300 text-sm">
                        New to Academy?{" "}
                        <Link
                            href="/academy/register"
                            className="text-indigo-400 hover:text-indigo-200 font-bold transition-colors"
                        >
                            Start Learning
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}

export default function AcademyLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-indigo-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        }>
            <AcademyLoginContent />
        </Suspense>
    );
}
