"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, User, AlertCircle, Eye, EyeOff, ArrowRight } from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import PasswordStrengthIndicator from "@/components/auth/PasswordStrengthIndicator";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

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
        gender: "",
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

    /**
     * REGISTRATION NO LONGER SIGNS ANYONE IN, AND THAT IS THE POINT.
     *
     * This used to call signIn() with the credentials just typed, and branch:
     *
     *     result.error  → "Registration successful but automatic login failed."
     *     otherwise     → straight into the app
     *
     * which published the answer registerAction had stopped giving. Submitting
     * the form with somebody else's address now returns exactly what a real
     * signup returns — but a real signup could log in and a probe could not, so
     * the outcome of THIS call still said whether the address was taken. A
     * generic error message upstream cannot close an oracle that the client
     * re-opens one line later.
     *
     * Everyone goes to the login page instead. The cost is one extra password
     * entry for a new user; the gain is that the two cases are genuinely
     * indistinguishable rather than only similarly worded.
     */
    useEffect(() => {
        if (state.success && !isPending && state.redirectUrl) {
            showToast("Account created. Please log in to continue.", "success");
            router.push("/auth/login?callbackUrl=" + encodeURIComponent(state.redirectUrl));
        }
    }, [state.success, state.redirectUrl, isPending, showToast, router]);

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

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
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
                                <span className="block text-xs font-normal text-amber-600 mt-1 mb-1">
                                    Ensure this perfectly matches your NIN/BVN to prevent KYC verification failure.
                                </span>
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

                        {/* Gender Field */}
                        <div className="space-y-2">
                            <label htmlFor="gender" className="block text-sm font-semibold text-slate-900">
                                Gender
                            </label>
                            <select
                                id="gender"
                                name="gender"
                                value={formData.gender}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all cursor-pointer"
                                disabled={isPending}
                                required
                            >
                                <option value="" disabled>Select Gender</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                            </select>
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

                            {/*
                              * THE CHECKLIST HERE OMITTED LOWERCASE — #330.
                              *
                              * It was a hand-rolled copy of the policy with four
                              * checks: length, uppercase, number, special. The
                              * server enforces five. So `PASSWORD1!` satisfied
                              * 4 of 4, filled the bar to 100%, printed "Strong"
                              * in green with four green ticks — and was refused:
                              * "Password must contain at least one lowercase
                              * letter." The screen told the user they had met
                              * every requirement.
                              *
                              * PasswordStrengthIndicator existed, listed all
                              * five correctly, and was imported by nothing. It
                              * renders PASSWORD_RULES now — the same array
                              * passwordPolicySchema validates against — so this
                              * cannot drift again.
                              */}
                            <PasswordStrengthIndicator password={formData.password} compact />

                            {/* Confirmation, checked here as well as on the server. */}
                            {formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword && (
                                <p className="mt-2 text-xs font-medium text-red-600">
                                    Passwords don&apos;t match
                                </p>
                            )}
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
