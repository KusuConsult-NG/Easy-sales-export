"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";
import { registerAction } from "@/app/actions/auth";
import toast from "react-hot-toast";

const initialState = { error: null, success: false };

export default function RegisterPage() {
    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        phone: "",
        gender: "",
        role: "",
        password: "",
        confirmPassword: "",
        acceptTerms: false,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(registerAction, initialState);
    const router = useRouter();
    const [passwordStrength, setPasswordStrength] = useState({
        score: 0,
        label: "",
        color: "",
    });

    // Handle successful registration
    useEffect(() => {
        if (state.success && !isPending) {
            toast.success("Registration successful! Redirecting to dashboard...");
            setTimeout(() => {
                router.push("/dashboard");
            }, 1000);
        } else if (state.error && !isPending) {
            toast.error(state.error);
        }
    }, [state.success, state.error, isPending, router]);

    // Calculate password strength
    useEffect(() => {
        if (!formData.password) {
            setPasswordStrength({ score: 0, label: "", color: "" });
            return;
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
            color = "bg-green-500";
        }

        setPasswordStrength({ score, label, color });
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
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-primary to-slate-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <div className="relative w-full max-w-2xl my-8">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-3 mb-4">
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
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
                    <p className="text-blue-200">Join Nigeria's leading ag-export platform</p>
                </div>

                {/* Registration Form */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                    <form action={formAction} className="space-y-6">
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
                                <label className="block text-sm font-semibold text-white mb-2">
                                    Full Name
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                    <input
                                        type="text"
                                        name="fullName"
                                        value={formData.fullName}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-white/10 border ${errors.fullName ? "border-red-400" : "border-white/20"
                                            } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
                                        placeholder="John Doe"
                                        disabled={isPending}
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
                                <label className="block text-sm font-semibold text-white mb-2">
                                    Phone Number
                                </label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-white/10 border ${errors.phone ? "border-red-400" : "border-white/20"
                                            } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
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

                            {/* Gender */}
                            <div>
                                <label className="block text-sm font-semibold text-white mb-2">
                                    Gender <span className="text-red-300">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        name="gender"
                                        value={formData.gender}
                                        onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                        className={`w-full px-4 py-3 bg-white/10 border ${errors.gender ? "border-red-400" : "border-white/20"
                                            } rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all appearance-none cursor-pointer`}
                                        disabled={isPending}
                                        required
                                    >
                                        <option value="" className="bg-slate-800">Select Gender</option>
                                        <option value="female" className="bg-slate-800">Female</option>
                                        <option value="male" className="bg-slate-800">Male</option>
                                    </select>
                                </div>
                                {errors.gender && (
                                    <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errors.gender}
                                    </p>
                                )}
                            </div>

                            {/* Role */}
                            <div>
                                <label className="block text-sm font-semibold text-white mb-2">
                                    Account Type <span className="text-red-300">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        name="role"
                                        value={formData.role}
                                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                        className={`w-full px-4 py-3 bg-white/10 border ${errors.role ? "border-red-400" : "border-white/20"
                                            } rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all appearance-none cursor-pointer`}
                                        disabled={isPending}
                                        required
                                    >
                                        <option value="" className="bg-slate-800">Select Account Type</option>
                                        <option value="member" className="bg-slate-800">Member - Join cooperatives and access loans</option>
                                        <option value="exporter" className="bg-slate-800">Exporter - Submit export applications</option>
                                        <option value="vendor" className="bg-slate-800">Vendor - Sell agricultural products</option>
                                    </select>
                                </div>
                                {errors.role && (
                                    <p className="mt-1 text-sm text-red-300 flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errors.role}
                                    </p>
                                )}
                                <p className="mt-2 text-xs text-blue-200/70">
                                    Choose the account type that best describes your needs. You can request role changes later.
                                </p>
                            </div>
                        </div>

                        {/* Email */}
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
                                    className={`w-full pl-11 pr-11 py-3 bg-white/10 border ${errors.password ? "border-red-400" : "border-white/20"
                                        } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
                                    placeholder="••••••••"
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white transition-colors"
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
                                        <span className="text-xs text-blue-200">
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
                                                className="flex items-center gap-2 text-xs text-blue-200"
                                            >
                                                {req.met ? (
                                                    <CheckCircle className="w-4 h-4 text-green-400" />
                                                ) : (
                                                    <XCircle className="w-4 h-4 text-blue-400" />
                                                )}
                                                <span className={req.met ? "text-green-300" : ""}>
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
                            <label className="block text-sm font-semibold text-white mb-2">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300" />
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    name="confirmPassword"
                                    value={formData.confirmPassword}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-11 py-3 bg-white/10 border ${errors.confirmPassword ? "border-red-400" : "border-white/20"
                                        } rounded-xl text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all`}
                                    placeholder="••••••••"
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white transition-colors"
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
                            <label className="flex items-start gap-3 text-sm text-blue-200 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="acceptTerms"
                                    checked={formData.acceptTerms}
                                    onChange={handleInputChange}
                                    className="mt-0.5 w-4 h-4 rounded accent-blue-500"
                                    disabled={isPending}
                                />
                                <span>
                                    I agree to the{" "}
                                    <Link
                                        href="/terms"
                                        className="text-white underline hover:text-blue-300"
                                    >
                                        Terms and Conditions
                                    </Link>{" "}
                                    and{" "}
                                    <Link
                                        href="/privacy"
                                        className="text-white underline hover:text-blue-300"
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
                            className="w-full px-6 py-4 bg-linear-to-r from-primary to-blue-700 text-white font-bold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all elevation-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                "Create Account"
                            )}
                        </button>
                    </form>

                    {/* Login Link */}
                    <div className="mt-6 text-center">
                        <p className="text-blue-200">
                            Already have an account?{" "}
                            <Link
                                href="/auth/login"
                                className="text-white font-semibold hover:underline"
                            >
                                Sign in
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
