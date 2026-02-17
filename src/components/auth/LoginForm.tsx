"use client";

import { useState, useEffect, useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle, ArrowRight, Loader2, Home, User } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSession } from "next-auth/react";

/**
 * Universal Login Form
 * 
 * Simplified, single login interface for the entire platform.
 * Replaces complex ModuleLoginPage with a standard design.
 */
export default function LoginForm() {
    const { data: session, status, update } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();

    // Auth redirect handling
    const redirectDefault = "/dashboard";
    const callbackUrl = searchParams.get("callbackUrl") || redirectDefault;
    const errorParam = searchParams.get("error");

    const { showToast } = useToast();

    // Initial State for Server Action
    const initialState = {
        error: "",
        success: false,
    };

    const [state, formAction, isPending] = useActionState(loginAction, initialState);

    // Handle successful login navigation
    useEffect(() => {
        const handleLoginSuccess = async () => {
            if (state.success) {
                // CRITICAL: Wait for session to update before redirecting
                // This prevents the "stuck on login" race condition where middleware
                // redirects back because it doesn't see the new session yet.
                await update();

                if ((state as any).redirectUrl) {
                    console.log('[Login] Authentication successful - redirecting to:', (state as any).redirectUrl);
                    router.replace((state as any).redirectUrl);
                } else {
                    // Fallback if no specific URL returned
                    router.replace(callbackUrl);
                }
            }
        };

        if (state.success && !isPending) {
            handleLoginSuccess();
        }
    }, [state.success, isPending, router, callbackUrl, state, update]);

    // Client-side session check (Safety Net)
    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            router.replace(callbackUrl);
        }
    }, [status, session, router, callbackUrl]);

    // Error handling
    useEffect(() => {
        // Handle Action State Errors
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }

        // Handle URL error parameters (e.g. from middleware redirect)
        if (errorParam) {
            const errorMap: Record<string, string> = {
                "session_expired": "Your session has expired. Please log in again.",
                "access_denied": "You do not have permission to access that resource.",
                "admin_access_denied": "You do not have administrator privileges.",
                "feature_disabled": "That feature is currently disabled.",
                "unauthorized": "Please log in to access this page.",
                "Configuration": "Server configuration error.",
                "Default": "Authentication failed."
            };
            const message = errorMap[errorParam] || "An authentication error occurred.";
            // Delay slightly to prevent toast spam ensuring component is mounted
            setTimeout(() => showToast(message, "error"), 500);
        }
    }, [state.error, isPending, showToast, errorParam]);

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);

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
            {/* Background Pattern */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute bottom-0 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
            </div>

            {/* Back to Hub Navigation (Top Left) */}
            <div className="absolute top-4 left-4 z-50 md:top-8 md:left-8">
                <Link
                    href="/"
                    className="flex items-center gap-2 p-2 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-full hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm group"
                >
                    <Home className="w-4 h-4Group-hover:scale-110 transition-transform" />
                    <span>Back to Hub</span>
                </Link>
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo & Header */}
                <div className="text-center mb-6 md:mb-8 relative z-10">
                    <Link href="/" className="inline-flex items-center justify-center mb-4 md:mb-6 hover:opacity-90 transition-opacity">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-linear-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20 text-white transition-transform hover:scale-105">
                            {/* Standardized 'User' icon for consistency across auth pages */}
                            <User className="w-6 h-6 md:w-8 md:h-8" />
                        </div>
                    </Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2">Welcome Back</h1>
                    <p className="text-sm md:text-base text-slate-500 dark:text-slate-400">Sign in to your account</p>
                </div>

                {/* Login Card */}
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xl backdrop-blur-sm rounded-2xl md:rounded-3xl p-6 md:p-8 relative z-10">
                    <form action={formAction} className="space-y-5 md:space-y-6">
                        <input type="hidden" name="redirectTo" value={callbackUrl} />

                        {state.error && (
                            <div className="bg-red-50 border-red-200 border rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{state.error}</p>
                            </div>
                        )}

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label htmlFor="login-email" className="block text-sm font-semibold text-slate-900 dark:text-white">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                                <input
                                    id="login-email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-900 border ${errors.email ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all`}
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="login-password" className="block text-sm font-semibold text-slate-900 dark:text-white">
                                    Password
                                </label>
                                <Link
                                    href="/auth/forgot-password"
                                    className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors hover:underline"
                                >
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                                <input
                                    id="login-password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="current-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-12 py-3.5 bg-slate-50 dark:bg-slate-900 border ${errors.password ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all`}
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
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
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
                                        className="peer w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-500/50 transition-all active:scale-95"
                                        disabled={isPending}
                                    />
                                    <CheckCircle className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity" />
                                </div>
                                <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors">Remember me</span>
                            </label>
                        </div>

                        {/* Submit Button */}
                        <LoadingButton
                            type="submit"
                            variant="primary"
                            loading={isPending}
                            loadingText="Signing in..."
                            className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all border-0 flex items-center justify-center gap-2"
                        >
                            Sign In
                            <ArrowRight className="w-5 h-5" />
                        </LoadingButton>
                    </form>

                    {/* Register Link */}
                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700 text-center">
                        <p className="text-slate-600 dark:text-slate-400">
                            New to the platform?{" "}
                            <Link
                                href="/auth/register"
                                className="text-blue-600 font-bold hover:text-blue-700 hover:underline transition-all"
                            >
                                Create Account
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center relative z-10 space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        {`© ${new Date().getFullYear()} Easy Sales Export`}
                    </p>
                    <div className="flex items-center justify-center gap-6 text-sm text-slate-500 dark:text-slate-400">
                        <Link href="/privacy" className="hover:underline hover:text-blue-600 transition-colors">
                            Privacy Policy
                        </Link>
                        <Link href="/terms" className="hover:underline hover:text-blue-600 transition-colors">
                            Terms & Conditions
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
