"use client";

import { useState, useEffect, Suspense } from "react";
import { useActionState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle, ArrowRight, Loader2, Home, User, type LucideIcon } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export interface ModuleLoginProps {
    moduleName: string;
    logo: LucideIcon;
    logoImage?: string;
    redirectDefault: string;
    registerLink: string;
    registerText?: string;
    registerButtonText?: string;
    theme: {
        logoGradient: string; // e.g., "from-purple-800 to-indigo-900"
        logoShadow: string;   // e.g., "shadow-purple-500/20"
        focusRing: string;    // e.g., "focus:ring-purple-500/50"
        focusBorder?: string;  // e.g., "focus:border-purple-500"
        checkboxText: string; // e.g., "text-purple-600"
        buttonClass: string; // Full class string for button background/hover
        linkText: string;     // e.g., "text-purple-600"
        linkHover: string;    // e.g., "hover:text-purple-700"
        iconGroupFocus: string; // e.g., "group-focus-within:text-purple-600"
        // New theme props for extensive customization (WAVE)
        textClass?: string; // Default: text-slate-900 dark:text-white
        subTextClass?: string; // Default: text-slate-500 dark:text-slate-400
        cardClass?: string; // Default: bg-white dark:bg-slate-800 ...
        labelClass?: string; // Default: text-slate-900 dark:text-white
        inputClass?: string; // Default: bg-slate-50 dark:bg-slate-900 ...
        inputIconClass?: string; // Default: text-slate-400
        placeholderClass?: string; // Default: placeholder:text-slate-400
    };
    backgroundConfig?: {
        type: "standard" | "custom";
        className?: string; // For custom full page backgrounds like WAVE
        blobs?: {
            top: string; // Class for top blob color e.g. "bg-purple-500/10"
            bottom: string; // Class for bottom blob color
        };
    };
}

const initialState = { error: "", success: false };

function ModuleLoginContent({
    moduleName,
    logo: Logo,
    logoImage,
    redirectDefault,
    registerLink,
    registerText,
    registerButtonText = "Create Account",
    theme,
    backgroundConfig = { type: "standard" }
}: ModuleLoginProps) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || redirectDefault;
    const errorParam = searchParams.get("error");
    const { showToast } = useToast();

    // Client-side redirect if already authenticated
    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            router.replace(callbackUrl);
        }
    }, [status, session, router, callbackUrl]);

    // Error handling
    useEffect(() => {
        // Handle URL error parameters (e.g. from middleware redirect)
        const errorParam = searchParams.get("error");
        if (errorParam) {
            // Map error codes to user-friendly messages
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

            // Prevent toast spam by checking if we just showed it (optional, but good UX)
            // For now, just show it
            setTimeout(() => showToast(message, "error"), 500);

            // Optional: Clean URL
            // router.replace(pathname); 
        }
    }, [status, router, callbackUrl, searchParams, showToast]);

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [state, formAction, isPending] = useActionState(loginAction, initialState);

    useEffect(() => {
        if (state.error && !isPending) {
            showToast(state.error, "error");
        }
    }, [state.error, isPending, showToast]);

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

    // Determine container classes based on background config
    const containerClasses = backgroundConfig.type === "custom" && backgroundConfig.className
        ? backgroundConfig.className
        : "min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden";

    const isCustomBg = backgroundConfig.type === "custom";

    // Default register text if not provided
    const defaultRegisterText = `New to ${moduleName}?`;
    const finalRegisterText = registerText || defaultRegisterText;

    return (
        <div className={containerClasses}>
            {/* Back to Hub Navigation */}
            <div className="absolute top-4 left-4 z-50">
                <Link
                    href="/"
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-sm backdrop-blur-sm transition-all hover:scale-105 font-medium text-sm ${backgroundConfig.type === 'custom'
                        ? 'bg-black/20 hover:bg-black/30 text-white border border-white/10'
                        : 'bg-white/80 hover:bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                        }`}
                >
                    <Home className="w-4 h-4" />
                    <span className="hidden sm:inline">Back to Hub</span>
                </Link>
            </div>

            {/* Background Pattern */}
            {backgroundConfig.type === "standard" && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {backgroundConfig.blobs && (
                        <>
                            <div className={`absolute -top-32 -left-32 w-96 h-96 ${backgroundConfig.blobs.top} rounded-full blur-3xl opacity-50`} />
                            <div className={`absolute bottom-0 -right-32 w-96 h-96 ${backgroundConfig.blobs.bottom} rounded-full blur-3xl opacity-50`} />
                        </>
                    )}
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
                </div>
            )}

            {backgroundConfig.type === "custom" && (
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
            )}

            <div className="relative w-full max-w-md">
                {/* Welcome Section */}
                <div className="mb-8 flex flex-col items-center text-center">
                    <Link href="/" className="group">
                        <div className="w-12 h-12 bg-linear-to-br from-blue-600 to-indigo-600 rounded-xl mb-4 flex items-center justify-center shadow-lg transform -rotate-3 group-hover:rotate-0 transition-transform">
                            <User className="w-6 h-6 text-white" />
                        </div>
                    </Link>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                        Welcome Back
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">
                        Sign in to access your dashboard
                    </p>
                </div>{/* Login Card */}
                <div className={`${theme.cardClass || "bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xl backdrop-blur-sm"} rounded-2xl md:rounded-3xl p-6 md:p-8 relative z-10`}>
                    <form action={formAction} className="space-y-5 md:space-y-6">
                        <input type="hidden" name="redirectTo" value={callbackUrl} />

                        {state.error && (
                            <div className={`${isCustomBg ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'} border rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2`}>
                                <AlertCircle className={`w-5 h-5 ${isCustomBg ? 'text-red-300' : 'text-red-500'} shrink-0 mt-0.5`} />
                                <p className={`text-sm ${isCustomBg ? 'text-red-200' : 'text-red-600'}`}>{state.error}</p>
                            </div>
                        )}

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label htmlFor="login-email" className={`block text-sm font-semibold ${theme.labelClass || "text-slate-900 dark:text-white"}`}>
                                Email Address
                            </label>
                            <div className="relative group">
                                <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.inputIconClass || "text-slate-400"} ${theme.iconGroupFocus} transition-colors`} />
                                <input
                                    id="login-email"
                                    type="email"
                                    name="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-4 py-3.5 ${theme.inputClass || "bg-slate-50 dark:bg-slate-900"} border ${errors.email ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl ${theme.textClass || "text-slate-900 dark:text-white"} ${theme.placeholderClass || "placeholder:text-slate-400"} focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition-all`}
                                    placeholder="your.email@example.com"
                                    required
                                    disabled={isPending}
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="login-password" className={`block text-sm font-semibold ${theme.labelClass || "text-slate-900 dark:text-white"}`}>
                                    Password
                                </label>
                                <Link
                                    href="/auth/forgot-password"
                                    className={`text-sm ${theme.linkText} ${theme.linkHover} font-medium transition-colors hover:underline`}
                                >
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="relative group">
                                <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme.inputIconClass || "text-slate-400"} ${theme.iconGroupFocus} transition-colors`} />
                                <input
                                    id="login-password"
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    autoComplete="current-password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className={`w-full pl-11 pr-12 py-3.5 ${theme.inputClass || "bg-slate-50 dark:bg-slate-900"} border ${errors.password ? "border-red-500" : "border-slate-200 dark:border-slate-600"} rounded-xl ${theme.textClass || "text-slate-900 dark:text-white"} ${theme.placeholderClass || "placeholder:text-slate-400"} focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition-all`}
                                    placeholder="••••••••"
                                    required
                                    disabled={isPending}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 ${theme.inputIconClass || "text-slate-400"} hover:text-slate-600 dark:hover:text-slate-200 transition-colors`}
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
                                        className={`peer w-5 h-5 rounded-md border-2 ${isCustomBg ? 'border-white/30 accent-emerald-500' : 'border-slate-300 dark:border-slate-600'} ${theme.checkboxText} focus:ring-2 ${theme.focusRing} transition-all active:scale-95`}
                                        disabled={isPending}
                                    />
                                    {!isCustomBg && (
                                        <CheckCircle className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity" />
                                    )}
                                </div>
                                <span className={`text-sm ${theme.subTextClass || "text-slate-600 dark:text-slate-400"} group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors`}>Remember me</span>
                            </label>
                        </div>

                        {/* Submit Button */}
                        <LoadingButton
                            type="submit"
                            variant={isCustomBg ? "primary" : "secondary"}
                            loading={isPending}
                            loadingText="Signing in..."
                            className={`w-full py-2.5 ${theme.buttonClass} text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all border-0 flex items-center justify-center gap-2`}
                        >
                            Sign In
                            {!isCustomBg && <ArrowRight className="w-5 h-5" />}
                        </LoadingButton>
                    </form>

                    {/* Register Link */}
                    <div className={`mt-8 pt-6 ${theme.cardClass ? 'border-transparent' : 'border-slate-100 dark:border-slate-700'} text-center`}>
                        <p className={`${theme.subTextClass || "text-slate-600 dark:text-slate-400"}`}>
                            {finalRegisterText}{" "}
                            <Link
                                href={registerLink}
                                className={`${isCustomBg ? 'text-white' : theme.linkText} font-bold ${theme.linkHover} hover:underline transition-all`}
                            >
                                {registerButtonText}
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center relative z-10 space-y-4">
                    <p className={`text-sm ${isCustomBg ? 'text-emerald-200/40 uppercase tracking-widest font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                        {isCustomBg ? 'Implemented by Easy Sales Export' : `© ${new Date().getFullYear()} Easy Sales Export`}
                    </p>
                    <div className={`flex items-center justify-center gap-6 text-sm ${isCustomBg ? 'text-emerald-200/60' : 'text-slate-500 dark:text-slate-400'}`}>
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

export default function ModuleLoginPage(props: ModuleLoginProps) {
    return (
        <Suspense fallback={
            <div className={`min-h-screen ${props.backgroundConfig?.type === 'custom' ? 'bg-stone-900' : 'bg-slate-50 dark:bg-slate-900'} flex items-center justify-center`}>
                <Loader2 className={`w-8 h-8 ${props.theme.checkboxText.replace('text-', 'text-')} animate-spin`} />
            </div>
        }>
            <ModuleLoginContent {...props} />
        </Suspense>
    );
}
