"use client";

import { useState, useMemo, Suspense } from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
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
    XCircle,
    Sparkles,
} from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";

const initialState = { error: "", success: false };

function WaveRegisterContent() {
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { data: session } = useSession();

    // Default valid callback or dashboard
    const callbackUrl = searchParams.get("callbackUrl") || "/wave/application";

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        phone: "",
        gender: "female", // Hardcoded
        platforms: ["wave"], // Hardcoded
        password: "",
        confirmPassword: "",
        acceptTerms: false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(registerAction, initialState);

    const passwordStrength = useMemo(() => {
        if (!formData.password) {
            return { score: 0, label: "", color: "" };
        }

        let score = 0;
        const password = formData.password;

        // Length check
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;

        // Character type checks
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;

        let label = "";
        let color = "";

        if (score <= 1) {
            label = "Weak";
            color = "bg-red-500";
        } else if (score <= 3) {
            label = "Fair";
            color = "bg-yellow-500";
        } else if (score <= 4) {
            label = "Good";
            color = "bg-blue-500";
        } else {
            label = "Strong";
            color = "bg-emerald-500";
        }

        return { score, label, color };
    }, [formData.password]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData({
            ...formData,
            [name]: type === "checkbox" ? checked : value,
        });
        // Clear error when user starts typing
        if (errors[name]) {
            const newErrors = { ...errors };
            delete newErrors[name];
            setErrors(newErrors);
        }
    };

    const passwordRequirements = [
        { label: "At least 8 characters", met: formData.password.length >= 8 },
        {
            label: "Uppercase & lowercase letters",
            met: /[a-z]/.test(formData.password) && /[A-Z]/.test(formData.password),
        },
        { label: "At least one number", met: /\d/.test(formData.password) },
        {
            label: "Special character (!@#$%^&*)",
            met: /[^a-zA-Z0-9]/.test(formData.password),
        },
    ];

    return (
        <div className="min-h-screen bg-linear-to-br from-stone-900 via-emerald-900 to-stone-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />

            <div className="relative w-full max-w-2xl my-8">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <Link href="/" className="flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <div className="w-16 h-16 bg-emerald-800 rounded-2xl flex items-center justify-center border-2 border-emerald-400/20 shadow-2xl shadow-emerald-900/50">
                            <Sparkles className="w-8 h-8 text-emerald-100" />
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-white mb-2">WAVE Program Registration</h1>
                    <p className="text-emerald-200">Women's Agribusiness Venture Empowerment</p>
                </div>

                {/* Registration Form */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl shadow-black/20">
                    <form action={formAction} className="space-y-6">
                        <input type="hidden" name="callbackUrl" value={callbackUrl} />
                        <input type="hidden" name="platforms[]" value="wave" />
                        <input type="hidden" name="gender" value="female" />

                        {/* Server error display */}
                        {state.error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-200">{state.error}</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Full Name */}
                            <div>
                                <label htmlFor="register-fullname" className="block text-sm font-semibold text-emerald-100 mb-2">
                                    Full Name <span className="text-red-300">*</span>
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                    <input
                                        id="register-fullname"
                                        type="text"
                                        name="fullName"
                                        autoComplete="name"
                                        value={formData.fullName}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-white/5 border ${errors.fullName ? "border-red-400" : "border-white/10"
                                            } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                        placeholder="Jane Doe"
                                        disabled={isPending}
                                        required
                                    />
                                </div>
                                {errors.fullName && (
                                    <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errors.fullName}
                                    </p>
                                )}
                            </div>

                            {/* Phone */}
                            <div>
                                <label htmlFor="register-phone" className="block text-sm font-semibold text-emerald-100 mb-2">
                                    Phone Number
                                </label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                    <input
                                        id="register-phone"
                                        type="tel"
                                        name="phone"
                                        autoComplete="tel"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-white/5 border ${errors.phone ? "border-red-400" : "border-white/10"
                                            } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                        placeholder="+234 XXX XXX XXXX"
                                        disabled={isPending}
                                    />
                                </div>
                                {errors.phone && (
                                    <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errors.phone}
                                    </p>
                                )}
                            </div>

                            {/* Gender (Hidden/Fixed) Info Box */}
                            <div className="col-span-full">
                                <div className="p-4 bg-white/10 border border-white/20 rounded-xl flex items-center gap-4 shadow-lg shadow-black/10 backdrop-blur-sm">
                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0 border border-white/30">
                                        <User className="w-5 h-5 text-white" />
                                    </div>
                                    <div className="text-sm">
                                        <p className="font-bold text-white text-base">Women-Only Program</p>
                                        <p className="text-white/80 leading-relaxed font-medium">This program is exclusively designed to empower women in agriculture.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Email */}
                        <div>
                            <label htmlFor="register-email" className="block text-sm font-semibold text-emerald-100 mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                <input
                                    id="register-email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3 bg-white/5 border ${errors.email ? "border-red-400" : "border-white/10"
                                        } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                    placeholder="your.email@example.com"
                                    disabled={isPending}
                                />
                            </div>
                            {errors.email && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.email}
                                </p>
                            )}
                        </div>

                        {/* Password */}
                        <div>
                            <label htmlFor="register-password" className="block text-sm font-semibold text-emerald-100 mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                <input
                                    id="register-password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="new-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-11 py-3 bg-white/5 border ${errors.password ? "border-red-400" : "border-white/10"
                                        } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                    placeholder="••••••••"
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
                            {errors.password && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.password}
                                </p>
                            )}

                            {/* Password Strength Meter */}
                            {formData.password && (
                                <div className="mt-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-white font-semibold">
                                            Password Strength: {passwordStrength.label}
                                        </span>
                                        <span className="text-xs text-emerald-200">
                                            {passwordStrength.score}/5
                                        </span>
                                    </div>
                                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${passwordStrength.color} transition-all duration-300`}
                                            style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                                        />
                                    </div>

                                    {/* Password Requirements */}
                                    <div className="mt-3 space-y-1">
                                        {passwordRequirements.map((req, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-2 text-xs text-emerald-200"
                                            >
                                                {req.met ? (
                                                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                                                ) : (
                                                    <XCircle className="w-4 h-4 text-emerald-600/50" />
                                                )}
                                                <span className={req.met ? "text-emerald-300" : "opacity-50"}>
                                                    {req.label}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label className="block text-sm font-semibold text-emerald-100 mb-2">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    name="confirmPassword"
                                    value={formData.confirmPassword}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-11 py-3 bg-white/5 border ${errors.confirmPassword ? "border-red-400" : "border-white/10"
                                        } rounded-xl text-white placeholder:text-emerald-200/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                    placeholder="••••••••"
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 hover:text-white transition-colors"
                                    disabled={isPending}
                                >
                                    {showConfirmPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                            {errors.confirmPassword && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.confirmPassword}
                                </p>
                            )}
                        </div>

                        {/* Terms & Conditions */}
                        <div>
                            <label className="flex items-start gap-3 text-sm text-emerald-200 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="acceptTerms"
                                    checked={formData.acceptTerms}
                                    onChange={handleInputChange}
                                    className="mt-0.5 w-4 h-4 rounded accent-emerald-500"
                                    disabled={isPending}
                                />
                                <span>
                                    I agree to the{" "}
                                    <Link
                                        href="/terms"
                                        className="text-emerald-400 underline hover:text-emerald-300"
                                    >
                                        Terms and Conditions
                                    </Link>{" "}
                                    and{" "}
                                    <Link
                                        href="/privacy"
                                        className="text-emerald-400 underline hover:text-emerald-300"
                                    >
                                        Privacy Policy
                                    </Link>
                                </span>
                            </label>
                            {errors.acceptTerms && (
                                <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.acceptTerms}
                                </p>
                            )}
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full px-6 py-4 bg-linear-to-r from-emerald-600 to-emerald-800 text-white font-bold rounded-xl hover:from-emerald-700 hover:to-emerald-900 transition-all shadow-lg hover:shadow-emerald-900/50 flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                "Join WAVE Program"
                            )}
                        </button>
                    </form>

                    {/* Login Link */}
                    <div className="mt-6 text-center">
                        <p className="text-emerald-200/60">
                            Already have an account?{" "}
                            <Link
                                href="/wave/login"
                                className="text-white font-semibold hover:underline"
                            >
                                Sign in
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

export default function WaveRegisterPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-stone-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        }>
            <WaveRegisterContent />
        </Suspense>
    );
}
