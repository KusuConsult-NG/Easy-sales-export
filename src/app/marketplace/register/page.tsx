"use client";

import { useState, useMemo, Suspense } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Mail,
    Lock,
    User,
    Phone,
    AlertCircle,
    Loader2,
    Eye,
    EyeOff,
    CheckCircle,
    Store,
    ArrowRight,
} from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";

const initialState = { error: "", success: false };

function MarketplaceRegisterContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/marketplace/onboarding";

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        phone: "",
        gender: "",
        platforms: ["marketplace"],
        password: "",
        confirmPassword: "",
        acceptTerms: false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(registerAction, initialState);

    // Password Strength Logic
    const passwordStrength = useMemo(() => {
        if (!formData.password) return { score: 0, label: "", color: "" };
        let score = 0;
        const password = formData.password;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        let label = "", color = "";
        if (score <= 1) { label = "Weak"; color = "bg-red-500"; }
        else if (score <= 3) { label = "Fair"; color = "bg-yellow-500"; }
        else if (score <= 4) { label = "Good"; color = "bg-blue-500"; }
        else { label = "Strong"; color = "bg-green-500"; }
        return { score, label, color };
    }, [formData.password]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData({
            ...formData,
            [name]: type === "checkbox" ? checked : value,
        });
        if (errors[name]) {
            const newErrors = { ...errors };
            delete newErrors[name];
            setErrors(newErrors);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
            {/* Background Pattern */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-green-500/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute top-1/2 -right-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl opacity-50" />
            </div>

            <div className="relative w-full max-w-5xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-2">
                {/* Left Side - Information & Branding */}
                <div className="hidden lg:block relative bg-linear-to-br from-green-600 to-emerald-700 p-12 text-white">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

                    <div className="relative z-10 h-full flex flex-col justify-between">
                        <div>
                            <Link href="/" className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full mb-8 hover:bg-white/20 transition-all">
                                <span className="font-bold">Easy Sales Export</span>
                            </Link>
                            <h1 className="text-4xl font-bold mb-6">Join the Marketplace</h1>
                            <p className="text-green-100 text-lg leading-relaxed mb-8">
                                Connect buyers and sellers in a secure, transparent marketplace ecosystem.
                            </p>

                            <div className="space-y-4">
                                {[
                                    "List products for free",
                                    "Reach thousands of buyers",
                                    "Secure escrow payments",
                                    "Seller dashboard & analytics",
                                    "24/7 marketplace support"
                                ].map((benefit, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                            <CheckCircle className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="font-medium text-green-50">{benefit}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-8 pt-8 border-t border-white/20">
                            <p className="text-sm text-green-100/80">
                                &copy; {new Date().getFullYear()} Easy Sales Export. All rights reserved.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Side - Registration Form */}
                <div className="p-8 lg:p-12 overflow-y-auto max-h-[90vh]">
                    <div className="lg:hidden mb-8 text-center">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Join Marketplace</h2>
                        <p className="text-slate-500 dark:text-slate-400">Powered by Easy Sales Export</p>
                    </div>

                    <form action={formAction} className="space-y-5">
                        <input type="hidden" name="callbackUrl" value={callbackUrl} />
                        <input type="hidden" name="platforms[]" value="marketplace" />

                        {state.error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{state.error}</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {/* Full Name */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        name="fullName"
                                        value={formData.fullName}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.fullName ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all`}
                                        placeholder="John Doe"
                                        disabled={isPending}
                                        required
                                    />
                                </div>
                                {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName}</p>}
                            </div>

                            {/* Email */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Email Address <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.email ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all`}
                                        placeholder="your@email.com"
                                        disabled={isPending}
                                        required
                                    />
                                </div>
                                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Phone Number
                                </label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.phone ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all`}
                                        placeholder="+234..."
                                        disabled={isPending}
                                    />
                                </div>
                                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                            </div>

                            {/* Gender */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Gender <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        name="gender"
                                        value={formData.gender}
                                        onChange={handleInputChange}
                                        className={`w-full px-4 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.gender ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all appearance-none cursor-pointer`}
                                        disabled={isPending}
                                        required
                                    >
                                        <option value="">Select Gender</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                    </select>
                                </div>
                                {errors.gender && <p className="text-red-500 text-xs mt-1">{errors.gender}</p>}
                            </div>

                            {/* Password */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="password"
                                        value={formData.password}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-11 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.password ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all`}
                                        placeholder="Min 8 chars"
                                        disabled={isPending}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                {/* Strength Bar */}
                                {formData.password && (
                                    <div className="mt-2 flex gap-1 h-1">
                                        {[1, 2, 3, 4, 5].map((i) => (
                                            <div
                                                key={i}
                                                className={`flex-1 rounded-full bg-slate-200 dark:bg-slate-700 ${i <= passwordStrength.score ? passwordStrength.color : ""
                                                    }`}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Confirm Password */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Confirm Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-11 py-3 bg-slate-50 dark:bg-slate-700 border ${errors.confirmPassword ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-all`}
                                        placeholder="Confirm password"
                                        disabled={isPending}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Terms */}
                        <div className="pt-2">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="acceptTerms"
                                    checked={formData.acceptTerms}
                                    onChange={handleInputChange}
                                    className="mt-1 w-4 h-4 rounded text-green-600 focus:ring-green-500 border-slate-300"
                                />
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    I agree to the <Link href="/terms" className="text-green-600 hover:underline">Terms of Service</Link> and <Link href="/privacy" className="text-green-600 hover:underline">Privacy Policy</Link>.
                                </span>
                            </label>
                            {errors.acceptTerms && <p className="text-red-500 text-xs mt-1 ml-7">{errors.acceptTerms}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full py-4 bg-linear-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Registering...
                                </>
                            ) : (
                                <>
                                    Create Marketplace Account
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>

                        <div className="text-center mt-6">
                            <p className="text-slate-600 dark:text-slate-400 text-sm">
                                Already a member?{" "}
                                <Link href="/marketplace/login" className="text-green-600 font-semibold hover:underline">
                                    Sign In
                                </Link>
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function MarketplaceRegisterPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
        }>
            <MarketplaceRegisterContent />
        </Suspense>
    );
}
