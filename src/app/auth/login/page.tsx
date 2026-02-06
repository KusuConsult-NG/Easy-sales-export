"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";
import { loginAction } from "@/app/actions/auth";
import toast from "react-hot-toast";

const initialState = { error: "", success: false };

export default function LoginPage() {
    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(loginAction, initialState);
    const router = useRouter();

    // Handle successful login
    useEffect(() => {
        if (state.success && !isPending) {
            toast.success("Login successful! Redirecting to dashboard...");
            setTimeout(() => {
                router.push("/dashboard");
            }, 1000);
        } else if (state.error && !isPending) {
            toast.error(state.error);
        }
    }, [state.success, state.error, isPending, router]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: value,
        });
        // Clear error when user starts typing
        if (errors[name]) {
            const newErrors = { ...errors };
            delete newErrors[name];
            setErrors(newErrors);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
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
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-blue-200">Sign in to your account</p>
                </div>

                {/* Login Form */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                    <form action={formAction} className="space-y-6">
                        {/* Server error display */}
                        {state.error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-200">{state.error}</p>
                            </div>
                        )}

                        {/* Email Field */}
                        <div>
                            <label className="block text-sm font-semibold text-white mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3 bg-white/10 border ${errors.email ? "border-red-400" : "border-white/20"
                                        } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
                                    placeholder="your.email@example.com"
                                    disabled={isPending}
                                />
                                {errors.email && (
                                    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-red-400" />
                                )}
                            </div>
                            {errors.email && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.email}
                                </p>
                            )}
                        </div>

                        {/* Password Field */}
                        <div>
                            <label className="block text-sm font-semibold text-white mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-12 py-3 bg-white/10 border ${errors.password ? "border-red-400" : "border-white/20"
                                        } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
                                    placeholder="••••••••"
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-200 hover:text-white transition-colors"
                                    disabled={isPending}
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.password}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm text-blue-200 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded accent-blue-500"
                                    disabled={isPending}
                                />
                                Remember me
                            </label>
                            {/* Forgot password temporarily hidden - stub page */}
                            {/* <Link
                                href="/auth/forgot-password"
                                className="text-sm text-blue-300 hover:text-white transition-colors"
                            >
                                Forgot password?
                            </Link> */}
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full px-6 py-4 bg-linear-to-r from-blue-600 to-blue-700 text-white font-bold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all elevation-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                "Sign In"
                            )}
                        </button>
                    </form>

                    {/* Register Link */}
                    <div className="mt-6 text-center">
                        <p className="text-blue-200">
                            Don't have an account?{" "}
                            <Link
                                href="/auth/register"
                                className="text-white font-semibold hover:underline"
                            >
                                Create one
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <p className="mt-8 text-center text-sm text-blue-200/60">
                    {COMPANY_INFO.copyright}
                </p>
            </div>
        </div>
    );
}
