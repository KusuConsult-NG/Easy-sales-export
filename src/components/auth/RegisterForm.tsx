"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, User, AlertCircle, Eye, EyeOff, ArrowRight, Loader2, CheckCircle } from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";

const initialState = { error: "", success: false, redirectUrl: "" };

export default function RegisterForm() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
    const { status } = useSession();
    const router = useRouter();

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
        phone: "",
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [state, formAction, isPending] = useActionState(registerAction, initialState);

    // Redirect if already authenticated
    useEffect(() => {
        if (status === "authenticated") {
            router.replace(callbackUrl);
        }
    }, [status, router, callbackUrl]);

    // Handle successful registration
    useEffect(() => {
        if (state.success && !isPending && state.redirectUrl) {
            showToast("Account created successfully! Logging you in...", "success");

            // Sign in the user after registration
            signIn("credentials", {
                email: formData.email,
                password: formData.password,
                redirect: false,
            }).then((result) => {
                if (result?.error) {
                    showToast("Registration successful but automatic login failed. Please log in manually.", "warning");
                    router.push("/auth/login?callbackUrl=" + encodeURIComponent(state.redirectUrl));
                } else {
                    // Successful login, redirect to callback or dashboard
                    // CRITICAL: Use hard redirect to ensure cookies are seen by middleware
                    window.location.href = state.redirectUrl;
                }
            });
        }
    }, [state.success, state.redirectUrl, isPending, formData.email, formData.password, showToast, router]);

    // Show error toasts
    useEffect(() => {
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }
    }, [state.error, isPending, showToast]);

    // Auto-scroll to error message when it appears
    useEffect(() => {
        if (state.error) {
            setTimeout(() => {
                const errorElement = document.getElementById('register-form-message');
                if (errorElement) {
                    errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }, [state.error]);

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
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute bottom-0 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Welcome Section */}
                {/* Logo & Header */}
                <div className="text-center mb-6 md:mb-8 relative z-10">
                    <Link href="/" className="inline-flex items-center justify-center mb-4 md:mb-6 hover:opacity-90 transition-opacity">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-linear-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20 text-white transition-transform hover:scale-105">
                            <User className="w-6 h-6 md:w-8 md:h-8" />
                        </div>
                    </Link>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                        Create Account
                    </h2>
                    <p className="text-sm md:text-base text-slate-500">
                        Join thousands of successful agri-exporters today.
                    </p>
                </div>
                {/* Registration Card */}
                <div className="bg-white border border-slate-100 shadow-2xl backdrop-blur-sm rounded-3xl p-8 relative z-10">
                    <form action={formAction} className="space-y-6">
                        <input type="hidden" name="callbackUrl" value={callbackUrl} />

                        {state.error && (
                            <div id="register-form-message" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{state.error}</p>
                            </div>
                        )}

                        {/* Full Name Field */}
                        <div className="space-y-2">
                            <label htmlFor="fullName" className="block text-sm font-semibold text-slate-900">
                                Full Name
                            </label>
                            <div className="relative group">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                                <input
                                    id="fullName"
                                    type="text"
                                    name="fullName"
                                    autoComplete="name"
                                    value={formData.fullName}
                                    onChange={handleInputChange}
                                    className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all"
                                    placeholder="John Doe"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label htmlFor="email" className="block text-sm font-semibold text-slate-900">
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                                <input
                                    id="email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all"
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        {/* Phone Field */}
                        <div className="space-y-2">
                            <label htmlFor="phone" className="block text-sm font-semibold text-slate-900">
                                Phone Number
                            </label>
                            <input
                                id="phone"
                                type="tel"
                                name="phone"
                                autoComplete="tel"
                                value={formData.phone}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all"
                                placeholder="+234 XXX XXX XXXX"
                                disabled={isPending}
                                required
                            />
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <label htmlFor="password" className="block text-sm font-semibold text-slate-900">
                                Password
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="new-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className="w-full pl-11 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all"
                                    placeholder="••••••••"
                                    required
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                    disabled={isPending}
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>

                            {/* Password Strength Indicator */}
                            {formData.password.length > 0 && (() => {
                                const checks = {
                                    length: formData.password.length >= 8,
                                    uppercase: /[A-Z]/.test(formData.password),
                                    number: /[0-9]/.test(formData.password),
                                    special: /[^A-Za-z0-9]/.test(formData.password),
                                };
                                const passed = Object.values(checks).filter(Boolean).length;
                                const strength = passed <= 1 ? "Weak" : passed <= 2 ? "Fair" : passed <= 3 ? "Good" : "Strong";
                                const color = passed <= 1 ? "bg-red-500" : passed <= 2 ? "bg-yellow-500" : passed <= 3 ? "bg-blue-500" : "bg-green-500";
                                const textColor = passed <= 1 ? "text-red-600" : passed <= 2 ? "text-yellow-600" : passed <= 3 ? "text-blue-600" : "text-green-600";

                                return (
                                    <div className="mt-2 space-y-2">
                                        {/* Strength Bar */}
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-300 ${color}`}
                                                    style={{ width: `${(passed / 4) * 100}%` }}
                                                />
                                            </div>
                                            <span className={`text-xs font-semibold ${textColor}`}>{strength}</span>
                                        </div>
                                        {/* Requirement Checklist */}
                                        <div className="grid grid-cols-2 gap-1">
                                            {[
                                                { label: "8+ characters", met: checks.length },
                                                { label: "Uppercase letter", met: checks.uppercase },
                                                { label: "Number", met: checks.number },
                                                { label: "Special character", met: checks.special },
                                            ].map((req) => (
                                                <div key={req.label} className="flex items-center gap-1.5">
                                                    <div className={`w-3 h-3 rounded-full flex items-center justify-center ${req.met ? "bg-green-500" : "bg-slate-200"}`}>
                                                        {req.met && <CheckCircle className="w-2.5 h-2.5 text-white" />}
                                                    </div>
                                                    <span className={`text-xs ${req.met ? "text-green-700" : "text-slate-400"}`}>{req.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Confirm Password Field */}
                        <div className="space-y-2">
                            <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-900">
                                Confirm Password
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                                <input
                                    id="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    name="confirmPassword"
                                    autoComplete="new-password"
                                    value={formData.confirmPassword}
                                    onChange={handleInputChange}
                                    className="w-full pl-11 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all"
                                    placeholder="••••••••"
                                    required
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                    disabled={isPending}
                                >
                                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <LoadingButton
                            type="submit"
                            variant="secondary"
                            loading={isPending}
                            loadingText="Creating account..."
                            className="w-full py-3.5 bg-linear-to-r from-slate-800 to-slate-900 hover:from-slate-900 hover:to-slate-950 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all border-0 flex items-center justify-center gap-2"
                        >
                            Create Account
                            <ArrowRight className="w-5 h-5" />
                        </LoadingButton>
                    </form>

                    {/* Login Link */}
                    <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                        <p className="text-slate-600">
                            Already have an account?{" "}
                            <Link
                                href={"/auth/login" + (callbackUrl !== "/dashboard" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "")}
                                className="text-slate-600 font-bold hover:text-slate-900 hover:underline transition-all"
                            >
                                Sign In
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center relative z-10 space-y-4">
                    <p className="text-sm text-slate-500">
                        © {new Date().getFullYear()} Easy Sales Export
                    </p>
                    <div className="flex items-center justify-center gap-6 text-sm text-slate-500">
                        <Link href="/privacy" className="hover:underline hover:text-primary transition-colors">
                            Privacy Policy
                        </Link>
                        <Link href="/terms" className="hover:underline hover:text-primary transition-colors">
                            Terms & Conditions
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
