"use client";

import { useState, useEffect, Suspense } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, AlertCircle, Eye, EyeOff, Sparkles, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams } from "next/navigation";

const initialState = { error: "", success: false };

function WaveLoginContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/wave/dashboard";

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);

    // Wrap loginAction to inject callbackUrl if needed, or rely on hidden input
    // But loginAction likely handles redirectTo from formData or just does its thing. 
    // Actually loginAction takes formData. We need to ensure it redirects to WAVE after.
    // The server action handles "redirectTo". We should pass it as a hidden input if supported, 
    // or the action determines it.
    // Looking at auth.ts, loginAction tries to redirect to "redirectTo" from formData or defaults.

    const [state, formAction, isPending] = useActionState(loginAction, initialState);

    // Initial Error/Success Handling
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
        // Theme: Forest Green (Emerald)
        <div className="min-h-screen bg-linear-to-br from-stone-900 via-emerald-950 to-stone-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />

            <div className="relative w-full max-w-md">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <Link href="/wave/landing" className="flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <div className="w-16 h-16 bg-emerald-800 rounded-2xl flex items-center justify-center border-2 border-emerald-400/20 shadow-2xl shadow-emerald-900/50">
                            <Sparkles className="w-8 h-8 text-emerald-100" />
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-emerald-200">Sign in to WAVE Program</p>
                </div>

                {/* Login Form */}
                <div className="bg-white/5 backdrop-blur-xl border border-emerald-500/20 rounded-3xl p-8 shadow-2xl shadow-black/20">
                    <form action={formAction} className="space-y-6">
                        <input type="hidden" name="redirectTo" value={callbackUrl} />

                        {/* Server error display */}
                        {state.error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-200">{state.error}</p>
                            </div>
                        )}

                        {/* Email Field */}
                        <div>
                            <label htmlFor="login-email" className="block text-sm font-semibold text-emerald-100 mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                <input
                                    id="login-email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3 bg-white/5 border ${errors.email ? "border-red-400" : "border-emerald-500/20"
                                        } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div>
                            <label htmlFor="login-password" className="block text-sm font-semibold text-emerald-100 mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                <input
                                    id="login-password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="current-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-12 py-3 bg-white/5 border ${errors.password ? "border-red-400" : "border-emerald-500/20"
                                        } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                    placeholder="••••••••"
                                    required
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 hover:text-white transition-colors"
                                    disabled={isPending}
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm text-emerald-200 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded accent-emerald-500"
                                    disabled={isPending}
                                />
                                Remember me
                            </label>
                            <Link
                                href="/auth/forgot-password"
                                className="text-sm text-emerald-400 hover:text-white transition-colors"
                            >
                                Forgot password?
                            </Link>
                        </div>

                        {/* Submit Button */}
                        <LoadingButton
                            type="submit"
                            loading={isPending}
                            loadingText="Signing in..."
                            className="w-full bg-linear-to-r from-emerald-600 to-emerald-800 hover:from-emerald-700 hover:to-emerald-900 border-0"
                        >
                            Sign In
                        </LoadingButton>
                    </form>

                    {/* Register Link */}
                    <div className="mt-6 text-center">
                        <p className="text-emerald-200/60">
                            Don't have an account?{" "}
                            <Link
                                href="/wave/application"
                                className="text-white font-semibold hover:underline"
                            >
                                Apply to WAVE
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <p className="mt-8 text-center text-sm text-emerald-200/40 uppercase tracking-widest font-semibold">
                    Implemented by Easy Sales Export
                </p>
            </div>
        </div>
    );
}

export default function WaveLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-stone-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        }>
            <WaveLoginContent />
        </Suspense>
    );
}
