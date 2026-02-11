"use client";

import { useState, useEffect, Suspense } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, Sprout, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";

const initialState = { error: "", success: false };

function FarmNationLoginContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/farm-nation/onboarding";

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(loginAction, initialState);

    useEffect(() => {
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }
    }, [state.error, isPending, showToast]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: value,
        });
        if (errors[name]) {
            const newErrors = { ...errors };
            delete newErrors[name];
            setErrors(newErrors);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute bottom-0 -right-32 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
            </div>

            <div className="relative w-full max-w-md">
                <div className="text-center mb-8 relative z-10">
                    <Link href="/farm-nation" className="inline-flex items-center justify-center mb-6 hover:opacity-90 transition-opacity">
                        <div className="w-16 h-16 bg-linear-to-br from-teal-600 to-cyan-700 rounded-2xl flex items-center justify-center shadow-xl shadow-teal-500/20 text-white transform rotate-3 hover:rotate-6 transition-transform">
                            <Sprout className="w-8 h-8" />
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Welcome Back</h1>
                    <p className="text-slate-500 dark:text-slate-400">Sign in to your Farm Nation account</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-100 dark:border-slate-700 relative z-10 backdrop-blur-sm">
                    <form action={formAction} className="space-y-6">
                        <input type="hidden" name="redirectTo" value={callbackUrl} />

                        {state.error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{state.error}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label htmlFor="login-email" className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-teal-600 transition-colors" />
                                <input
                                    id="login-email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-900 border ${errors.email ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all`}
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="login-password" className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                                    Password
                                </label>
                                <Link
                                    href="/auth/forgot-password"
                                    className="text-sm text-teal-600 hover:text-teal-700 font-medium transition-colors hover:underline"
                                >
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-teal-600 transition-colors" />
                                <input
                                    id="login-password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="current-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-12 py-3.5 bg-slate-50 dark:bg-slate-900 border ${errors.password ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all`}
                                    placeholder="••••••••"
                                    required
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                    disabled={isPending}
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="peer w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500/50 transition-all active:scale-95"
                                        disabled={isPending}
                                    />
                                    <CheckCircle className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity" />
                                </div>
                                <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors">Remember me</span>
                            </label>
                        </div>

                        <LoadingButton
                            type="submit"
                            variant="secondary"
                            loading={isPending}
                            loadingText="Signing in..."
                            className="w-full py-2.5 bg-linear-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all border-0 flex items-center justify-center gap-2"
                        >
                            Sign In
                            <ArrowRight className="w-5 h-5" />
                        </LoadingButton>
                    </form>

                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700 text-center">
                        <p className="text-slate-600 dark:text-slate-400">
                            New to Farm Nation?{" "}
                            <Link
                                href="/farm-nation/register"
                                className="text-teal-600 font-bold hover:text-teal-700 hover:underline transition-all"
                            >
                                Create Account
                            </Link>
                        </p>
                    </div>
                </div>

                <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400 relative z-10">
                    &copy; {new Date().getFullYear()} Easy Sales Export
                </p>
            </div>
        </div>
    );
}

export default function FarmNationLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
        }>
            <FarmNationLoginContent />
        </Suspense>
    );
}
