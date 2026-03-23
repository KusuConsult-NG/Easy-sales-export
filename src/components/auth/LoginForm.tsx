"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle, ArrowRight, Loader2, Home, User } from "lucide-react";
import { getPostLoginRedirect } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";

/**
 * Universal Login Form
 * 
 * Simplified, single login interface for the entire platform.
 * Replaces complex ModuleLoginPage with a standard design.
 * 
 * FIX: Uses client-side signIn() to guarantee session cookies are set before redirecting.
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

    // Client-side state
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        try {
            // 1. Client-side Sign In (Guarantees Cookie Set)
            // redirect: false prevents NextAuth from automatically redirecting,
            // allowing us to control the flow and wait for the cookie.
            const result = await signIn("credentials", {
                email: formData.email,
                password: formData.password,
                redirect: false,
            });

            if (result?.error) {
                // NextAuth wraps the thrown error message in result.error for credentials provider.
                // Show the real message from authorize() — covers suspended accounts,
                // config errors, rate-limit messages, etc.
                // Fall back to generic message only if error string is the opaque NextAuth code.
                const rawError = result.error;
                const isOpaqueCode = rawError === "CredentialsSignin" || rawError === "CallbackRouteError";
                setError(isOpaqueCode ? "Invalid email or password." : rawError);
                setIsLoading(false);
                return;
            }

            // 2. Success! Cookie is set. Now get redirect URL from server.
            console.log("Client-side login success, fetching redirect...");

            // Force session update to be absolutely sure client state matches server
            showToast("Login successful!", "success");

            // After login success: determine where to redirect
            // IMPORTANT: Never use an error URL as the callback destination.
            // If the current URL has ?error=... (e.g. MissingCSRF from a previous
            // failed attempt), we ignore it and fall through to smart redirect.
            const currentParams = new URLSearchParams(window.location.search);
            const rawCallback = currentParams.get('callbackUrl');

            // Only honour callback if it's an internal path with no error param
            const isValidCallback = rawCallback &&
                rawCallback.startsWith('/') &&
                !rawCallback.includes('error=');

            if (isValidCallback) {
                console.log("Using explicit callback URL:", rawCallback);
                router.push(rawCallback);
            } else {
                // No valid callback — use smart redirect based on user's roles
                const redirectResult = await getPostLoginRedirect(formData.email);

                if (redirectResult.success && redirectResult.redirectUrl) {
                    console.log("Using smart redirect:", redirectResult.redirectUrl);
                    router.push(redirectResult.redirectUrl);
                } else {
                    router.push("/auth/get-started");
                }
            }

        } catch (err: any) {
            console.error("Login error:", err);
            setError("An unexpected error occurred");
            setIsLoading(false);
        }
    };

    // Handle error params from redirects
    useEffect(() => {
        if (errorParam) {
            const errorMap: Record<string, string> = {
                "CredentialsSignin": "Invalid email or password",
                "MissingCSRF": "Session expired — please refresh the page and try again.",
                "session_expired": "Your session has expired. Please log in again.",
                "access_denied": "You do not have permission to access that resource.",
                "Default": "Authentication failed."
            };
            const message = errorMap[errorParam] || errorMap["Default"];
            if (errorParam !== "CredentialsSignin") {
                setTimeout(() => showToast(message, "error"), 500);
            } else {
                setError(message);
            }
        }
    }, [errorParam, showToast]);

    // Auto-scroll to error message when it appears
    useEffect(() => {
        if (error) {
            setTimeout(() => {
                const errorElement = document.getElementById('login-form-message');
                if (errorElement) {
                    errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }, [error]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[name];
                return newErrors;
            });
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute bottom-0 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
            </div>

            {/* Back to Hub Navigation */}
            <div className="absolute top-4 left-4 z-50 md:top-8 md:left-8">
                <Link
                    href="/"
                    className="flex items-center gap-2 p-2 px-4 text-sm font-medium text-slate-600 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-full hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm group"
                >
                    <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>Back to Hub</span>
                </Link>
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo & Header */}
                <div className="text-center mb-6 md:mb-8 relative z-10">
                    <Link href="/" className="inline-flex items-center justify-center mb-4 md:mb-6 hover:opacity-90 transition-opacity">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-linear-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20 text-white transition-transform hover:scale-105">
                            <User className="w-6 h-6 md:w-8 md:h-8" />
                        </div>
                    </Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">Welcome Back</h1>
                    <p className="text-sm md:text-base text-slate-500">Sign in to your account</p>
                </div>

                {/* Login Card */}
                <div className="bg-white border border-slate-100 shadow-2xl backdrop-blur-sm rounded-2xl md:rounded-3xl p-6 md:p-8 relative z-10">
                    <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
                        <input type="hidden" name="redirectTo" value={callbackUrl} />

                        {error && (
                            <div id="login-form-message" className="bg-red-50 border-red-200 border rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{error}</p>
                            </div>
                        )}

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label htmlFor="login-email" className="block text-sm font-semibold text-slate-900">
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
                                    className={`w-full pl-11 pr-4 py-3.5 bg-slate-50 border ${errors.email ? "border-red-500" : "border-slate-200"} rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all`}
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="login-password" className="block text-sm font-semibold text-slate-900">
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
                                    className={`w-full pl-11 pr-12 py-3.5 bg-slate-50 border ${errors.password ? "border-red-500" : "border-slate-200"} rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all`}
                                    placeholder="••••••••"
                                    required
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                    disabled={isLoading}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                Minimum 8 characters, including uppercase, number, and special character
                            </p>
                        </div>

                        <div className="flex items-center">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="peer w-5 h-5 rounded-md border-2 border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/50 transition-all active:scale-95"
                                        disabled={isLoading}
                                    />
                                    <CheckCircle className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity" />
                                </div>
                                <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Remember me</span>
                            </label>
                        </div>

                        {/* Submit Button */}
                        <LoadingButton
                            type="submit"
                            variant="primary"
                            loading={isLoading}
                            loadingText="Signing in..."
                            className="w-full py-2.5 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all border-0 flex items-center justify-center gap-2"
                        >
                            <span>Sign In</span>
                            <ArrowRight className="w-5 h-5" />
                        </LoadingButton>
                    </form>

                    {/* Register Link */}
                    <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                        <p className="text-slate-600">
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
                    <p className="text-sm text-slate-500">
                        {`© ${new Date().getFullYear()} Easy Sales Export`}
                    </p>
                    <div className="flex items-center justify-center gap-6 text-sm text-slate-500">
                        <Link href="/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
                        <Link href="/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
