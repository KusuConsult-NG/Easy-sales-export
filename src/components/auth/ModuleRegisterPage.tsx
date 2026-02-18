"use client";

import { useState, useMemo, Suspense, useEffect } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
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
    ArrowRight,
    type LucideIcon,
} from "lucide-react";
import { registerAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import { signIn, useSession } from "next-auth/react";

export interface ModuleRegisterProps {
    moduleName: string;
    logo?: React.ReactNode;
    description: string;
    benefits: string[];
    loginLink: string;
    platforms: string[];
    fixedGender?: string; // e.g., "female" for WAVE
    theme: {
        gradient: string; // "from-purple-900 to-indigo-900"
        text: string;     // "text-purple-600"
        textLight: string; // "text-purple-100"
        button: string;   // "bg-linear-to-r from-purple-800 to-indigo-900 hover:from-purple-900..."
        borderFocus: string; // "focus:ring-purple-500"
        icon: string;     // "text-purple-500"
        heading?: string; // Optional custom heading color class
        checkbox?: string; // "text-purple-600 focus:ring-purple-500"
    };
    backgroundImage?: React.ReactNode; // For custom backgrounds like WAVE or blobs
    footerText?: React.ReactNode; // Custom footer text (e.g., "Implemented by...")
    brandingText?: string; // Custom text for the top-left home link (default: "Easy Sales Export")
}

const initialState = { error: "", success: false };

function ModuleRegisterContent({
    moduleName,
    logo,
    description,
    benefits,
    loginLink,
    platforms,
    fixedGender,
    theme,
    backgroundImage,
    footerText,
    brandingText,
}: ModuleRegisterProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    // CRITICAL FIX: Do NOT default to module root (/${platforms[0]})
    // Leaving this empty allows determinePostRegistrationRedirect() in server action
    // to route users to the correct onboarding page instead of the public landing page
    const callbackUrl = searchParams.get("callbackUrl") || "";

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        phone: "",
        gender: fixedGender || "",
        platforms: platforms,
        password: "",
        confirmPassword: "",
        acceptTerms: false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Enhanced initial state for client-side redirect
    const [state, formAction, isPending] = useActionState(registerAction, { error: "", success: false, redirectUrl: "" });

    const { data: session } = useSession();

    // Handle client-side Login & Redirect after successful registration
    // This removes the server-side "Race Condition" by using standard client auth flow
    useEffect(() => {
        const performAutoLogin = async () => {
            if (state.success && state.redirectUrl) {
                showToast("Account created! Securely signing in...", "success");

                try {
                    // Use NextAuth Client SDK to establish session
                    // This is robust and handles cookies correctly
                    const result = await signIn("credentials", {
                        email: formData.email,
                        password: formData.password,
                        redirect: false,
                    });

                    if (result?.error) {
                        console.error("Auto-login failed:", result.error);
                        showToast("Account created, but auto-login failed. Please sign in.", "error");
                        router.push("/auth/login");
                    } else {
                        // Session established successfully
                        showToast("Login successful! Redirecting to setup...", "success");
                        router.push(state.redirectUrl);
                    }
                } catch (error) {
                    console.error("Auto-login error:", error);
                    showToast("Login error. Please sign in manually.", "error");
                    router.push("/auth/login");
                }
            }
        };

        performAutoLogin();
    }, [state, formData.email, formData.password, router, showToast]);

    // CHECK: If user is already logged in, redirect to the appropriate onboarding flow
    // This prevents logged-in users from seeing the registration form
    useEffect(() => {
        if (session) {
            let redirectPath = "/dashboard"; // Default fallback

            // Determine redirect path based on platform/module
            if (platforms.includes("wave")) {
                redirectPath = "/wave/application";
            } else if (platforms.includes("academy")) {
                redirectPath = "/academy/application";
            } else if (platforms.includes("export")) {
                redirectPath = "/export/onboarding";
            } else if (platforms.includes("cooperatives")) {
                redirectPath = "/cooperatives/onboarding";
            } else if (platforms.includes("farm-nation")) {
                redirectPath = "/farm-nation/onboarding";
            } else if (platforms.includes("marketplace")) {
                redirectPath = "/marketplace/onboarding";
            }

            // If callbackUrl exists and is valid, it might prioritize that, 
            // but for "register" page, we usually want to force the module flow if already logged in.
            // However, if they were redirected here with a specific goal, maybe respect it?
            // For now, module flow is safer.

            router.replace(redirectPath);
        }
    }, [session, platforms, router]);

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
        else { label = "Strong"; color = "bg-emerald-500"; }

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

    const passwordRequirements = [
        { label: "At least 8 characters", met: formData.password.length >= 8 },
        { label: "Uppercase & lowercase letters", met: /[a-z]/.test(formData.password) && /[A-Z]/.test(formData.password) },
        { label: "At least one number", met: /\d/.test(formData.password) },
        { label: "Special character (!@#$%^&*)", met: /[^a-zA-Z0-9]/.test(formData.password) },
    ];

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative">
            {/* Background Decoration */}
            {backgroundImage ? backgroundImage : (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {/* Default generic blobs if no custom bg provided */}
                    <div className={`absolute -top-32 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl opacity-50`} />
                    <div className={`absolute top-1/2 -right-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl opacity-50`} />
                </div>
            )}

            <div className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 z-10">
                {/* Left Side - Information & Branding */}
                <div className={`hidden lg:block relative bg-linear-to-br ${theme.gradient} p-12 text-white`}>
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

                    <div className="relative z-10 h-full flex flex-col justify-between">
                        <div>
                            <Link href="/" className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full mb-8 hover:bg-white/20 transition-all border border-white/10 text-white!">
                                <span className="font-bold text-white!">{brandingText || "Easy Sales Export"}</span>
                            </Link>

                            {logo && <div className="mb-6">{logo}</div>}

                            <h1 className={`text-4xl font-bold mb-6 ${theme.heading || ""}`}>Join {moduleName}</h1>
                            <p className={`${theme.textLight} text-lg leading-relaxed mb-8`}>
                                {description}
                            </p>

                            <div className="space-y-4">
                                {benefits.map((benefit, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                            <CheckCircle className="w-4 h-4 text-white" />
                                        </div>
                                        <span className={`font-medium ${theme.textLight} opacity-90`}>{benefit}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-8 pt-8 border-t border-white/20">
                            {footerText ? (
                                <div className={`text-sm ${theme.textLight} opacity-80 uppercase tracking-widest font-semibold`}>{footerText}</div>
                            ) : (
                                <p className={`text-sm ${theme.textLight} opacity-80`}>
                                    &copy; {new Date().getFullYear()} Easy Sales Export (v1.0.4-client-fix). All rights reserved.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Side - Registration Form */}
                <div className="p-8 lg:p-12 overflow-y-auto max-h-[90vh]">
                    <div className="lg:hidden mb-8 text-center">
                        <h2 className="text-2xl font-bold text-slate-900">Join {moduleName}</h2>
                        {footerText ? (
                            <div className="text-slate-500 text-sm mt-1">{footerText}</div>
                        ) : (
                            <p className="text-slate-500">Powered by Easy Sales Export</p>
                        )}
                    </div>

                    <form action={formAction} className="space-y-5">
                        <input type="hidden" name="callbackUrl" value={callbackUrl} />
                        {platforms.map(p => (
                            <input key={p} type="hidden" name="platforms[]" value={p} />
                        ))}
                        {fixedGender && <input type="hidden" name="gender" value={fixedGender} />}

                        {state.error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-600">{state.error}</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {/* Full Name */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.icon || "text-slate-400"}`} />
                                    <input
                                        type="text"
                                        name="fullName"
                                        value={formData.fullName}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.fullName ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all`}
                                        placeholder="John Doe"
                                        disabled={isPending}
                                        required
                                    />
                                </div>
                                {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName}</p>}
                            </div>

                            {/* Email */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Email Address <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.icon || "text-slate-400"}`} />
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.email ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all`}
                                        placeholder="your@email.com"
                                        disabled={isPending}
                                        required
                                    />
                                </div>
                                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                            </div>

                            {/* Phone */}
                            <div className={fixedGender ? "col-span-1" : "col-span-1"}>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Phone Number
                                </label>
                                <div className="relative">
                                    <Phone className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.icon || "text-slate-400"}`} />
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 border ${errors.phone ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all`}
                                        placeholder="+234..."
                                        disabled={isPending}
                                    />
                                </div>
                                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                            </div>

                            {/* Gender */}
                            {!fixedGender ? (
                                <div className="col-span-1">
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Gender <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <select
                                            name="gender"
                                            value={formData.gender}
                                            onChange={handleInputChange}
                                            className={`w-full px-4 py-3 bg-slate-50 border ${errors.gender ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all appearance-none cursor-pointer`}
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
                            ) : (
                                <div className="col-span-1">
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Gender
                                    </label>
                                    <div className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed">
                                        {fixedGender === 'female' ? 'Female' : fixedGender}
                                        <span className="ml-2 text-xs opacity-70">(Fixed)</span>
                                    </div>
                                </div>
                            )}

                            {/* Password */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.icon || "text-slate-400"}`} />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="password"
                                        value={formData.password}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-11 py-3 bg-slate-50 border ${errors.password ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all`}
                                        placeholder="Min 8 chars"
                                        disabled={isPending}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                                                className={`flex-1 rounded-full bg-slate-200 ${i <= passwordStrength.score ? passwordStrength.color : ""
                                                    }`}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Confirm Password */}
                            <div className="col-span-full">
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Confirm Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.icon || "text-slate-400"}`} />
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleInputChange}
                                        className={`w-full pl-11 pr-11 py-3 bg-slate-50 border ${errors.confirmPassword ? "border-red-500" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 ${theme.borderFocus} transition-all`}
                                        placeholder="Confirm password"
                                        disabled={isPending}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                                    className={`mt-1 w-4 h-4 rounded ${theme.checkbox || "text-primary focus:ring-primary"} border-slate-300`}
                                />
                                <span className="text-sm text-slate-600">
                                    I agree to the <Link href="/terms" className={`${theme.text} hover:underline`}>Terms of Service</Link> and <Link href="/privacy" className={`${theme.text} hover:underline`}>Privacy Policy</Link>.
                                </span>
                            </label>
                            {errors.acceptTerms && <p className="text-red-500 text-xs mt-1 ml-7">{errors.acceptTerms}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={isPending}
                            className={`w-full py-4 ${theme.button} text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2`}
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                <>
                                    Create {moduleName} Account
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>

                        <div className="text-center mt-6">
                            <p className="text-slate-600 text-sm">
                                Already a member?{" "}
                                <Link href={loginLink} className={`${theme.text} font-semibold hover:underline`}>
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

export default function ModuleRegisterPage(props: ModuleRegisterProps) {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className={`w-8 h-8 ${props.theme.text} animate-spin`} />
            </div>
        }>
            <ModuleRegisterContent {...props} />
        </Suspense>
    );
}
