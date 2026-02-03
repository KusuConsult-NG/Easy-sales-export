"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";

export default function LoginPage() {
    const [showPassword, setShowPassword] = useState(false);
    const [formData, setFormData] = useState({
        email: "",
        password: "",
        rememberMe: false,
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: Implement authentication logic
        console.log("Login attempt:", formData);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-primary via-blue-600 to-indigo-700 flex items-center justify-center p-4">
            {/* Login Card */}
            <div className="w-full max-w-md">
                {/* Logo & Header */}
                <div className="text-center mb-8 animate-[fadeIn_0.6s_ease-out]">
                    <div className="flex justify-center mb-4">
                        <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 flex items-center justify-center">
                            <Image
                                src="/images/logo.jpg"
                                alt={COMPANY_INFO.name}
                                width={48}
                                height={48}
                                className="w-12 h-12 rounded-xl"
                            />
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">
                        Welcome Back
                    </h1>
                    <p className="text-blue-100">
                        Sign in to access your export dashboard
                    </p>
                </div>

                {/* Login Form */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-3 animate-[slideInUp_0.6s_ease-out]">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email Field */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) =>
                                        setFormData({ ...formData, email: e.target.value })
                                    }
                                    placeholder="you@example.com"
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={(e) =>
                                        setFormData({ ...formData, password: e.target.value })
                                    }
                                    placeholder="••••••••"
                                    className="w-full pl-12 pr-12 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Remember Me & Forgot Password */}
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.rememberMe}
                                    onChange={(e) =>
                                        setFormData({ ...formData, rememberMe: e.target.checked })
                                    }
                                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    Remember me
                                </span>
                            </label>
                            <Link
                                href="/auth/forgot-password"
                                className="text-sm font-semibold text-primary hover:text-primary/80"
                            >
                                Forgot password?
                            </Link>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            className="w-full py-3 bg-gradient-to-r from-primary to-blue-600 text-white font-bold rounded-xl hover:scale-105 transition-transform elevation-2"
                        >
                            Sign In
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-white dark:bg-slate-800 text-slate-500">
                                New to Easy Sales Export?
                            </span>
                        </div>
                    </div>

                    {/* Register Link */}
                    <Link
                        href="/auth/register"
                        className="block w-full py-3 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary/5 transition-colors text-center"
                    >
                        Create Account
                    </Link>
                </div>

                {/* Footer */}
                <p className="text-center text-sm text-blue-100 mt-6">
                    {COMPANY_INFO.copyright}
                </p>
            </div>
        </div>
    );
}
