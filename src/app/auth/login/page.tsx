
"use client";

import ModuleLoginPage, { ModuleLoginProps } from "@/components/auth/ModuleLoginPage";
import { LayoutGrid, ShoppingBag, Users, Globe, Sprout, Waves, GraduationCap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function UniversalLoginContent() {
    const searchParams = useSearchParams();
    const moduleParam = searchParams.get("module");

    // Default Configuration (Platform Generic)
    let moduleConfig: ModuleLoginProps = {
        moduleName: "Easy Sales Export",
        logo: LayoutGrid,
        redirectDefault: "/dashboard",
        registerLink: "/auth/register",
        registerText: "New to the platform?",
        registerButtonText: "Get Started",
        theme: {
            logoGradient: "from-slate-800 to-slate-900",
            logoShadow: "shadow-slate-500/20",
            focusRing: "focus:ring-slate-500/50",
            checkboxText: "text-slate-600",
            buttonClass: "bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-900 hover:to-slate-950",
            linkText: "text-slate-600",
            linkHover: "hover:text-slate-900",
            iconGroupFocus: "group-focus-within:text-slate-600",
        }
    };

    // Override based on module param
    switch (moduleParam) {
        case "marketplace":
            moduleConfig = {
                moduleName: "Marketplace",
                logo: ShoppingBag,
                redirectDefault: "/marketplace/buyer",
                registerLink: "/auth/register?module=marketplace",
                registerText: "Want to buy or sell?",
                registerButtonText: "Join Marketplace",
                theme: {
                    logoGradient: "from-violet-600 to-indigo-600",
                    logoShadow: "shadow-violet-500/20",
                    focusRing: "focus:ring-violet-500/50",
                    checkboxText: "text-violet-600",
                    buttonClass: "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700",
                    linkText: "text-violet-600",
                    linkHover: "hover:text-violet-700",
                    iconGroupFocus: "group-focus-within:text-violet-600",
                }
            };
            break;
        case "cooperatives":
            moduleConfig = {
                moduleName: "Cooperative",
                logo: Users,
                redirectDefault: "/cooperatives/dashboard",
                registerLink: "/auth/register?module=cooperatives",
                registerText: "Start a cooperative?",
                registerButtonText: "Register Cooperative",
                theme: {
                    logoGradient: "from-purple-600 to-fuchsia-600",
                    logoShadow: "shadow-purple-500/20",
                    focusRing: "focus:ring-purple-500/50",
                    checkboxText: "text-purple-600",
                    buttonClass: "bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700",
                    linkText: "text-purple-600",
                    linkHover: "hover:text-purple-700",
                    iconGroupFocus: "group-focus-within:text-purple-600",
                }
            };
            break;
        case "export":
            moduleConfig = {
                moduleName: "Export Portal",
                logo: Globe,
                redirectDefault: "/export/dashboard",
                registerLink: "/auth/register?module=export",
                registerText: "Become an exporter?",
                registerButtonText: "Apply Now",
                theme: {
                    logoGradient: "from-blue-600 to-cyan-600",
                    logoShadow: "shadow-blue-500/20",
                    focusRing: "focus:ring-blue-500/50",
                    checkboxText: "text-blue-600",
                    buttonClass: "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700",
                    linkText: "text-blue-600",
                    linkHover: "hover:text-blue-700",
                    iconGroupFocus: "group-focus-within:text-blue-600",
                }
            };
            break;
        case "farm-nation":
            moduleConfig = {
                moduleName: "Farm Nation",
                logo: Sprout,
                redirectDefault: "/farm-nation/dashboard",
                registerLink: "/auth/register?module=farm-nation",
                registerText: "Join the revolution?",
                registerButtonText: "Join Farm Nation",
                theme: {
                    logoGradient: "from-emerald-600 to-green-600",
                    logoShadow: "shadow-emerald-500/20",
                    focusRing: "focus:ring-emerald-500/50",
                    checkboxText: "text-emerald-600",
                    buttonClass: "bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700",
                    linkText: "text-emerald-600",
                    linkHover: "hover:text-emerald-700",
                    iconGroupFocus: "group-focus-within:text-emerald-600",
                }
            };
            break;
        case "wave":
            moduleConfig = {
                moduleName: "WAVE",
                logo: Waves,
                redirectDefault: "/wave/dashboard",
                registerLink: "/auth/register?module=wave",
                registerText: "Empowering women?",
                registerButtonText: "Join WAVE",
                theme: {
                    logoGradient: "from-pink-500 to-rose-500",
                    logoShadow: "shadow-pink-500/20",
                    focusRing: "focus:ring-pink-500/50",
                    checkboxText: "text-pink-600",
                    buttonClass: "bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600",
                    linkText: "text-pink-600",
                    linkHover: "hover:text-pink-700",
                    iconGroupFocus: "group-focus-within:text-pink-600",
                }
            };
            break;
        case "academy":
            moduleConfig = {
                moduleName: "Academy",
                logo: GraduationCap,
                redirectDefault: "/academy/dashboard",
                registerLink: "/auth/register?module=academy",
                registerText: "Ready to learn?",
                registerButtonText: "Start Learning",
                theme: {
                    logoGradient: "from-amber-500 to-orange-600",
                    logoShadow: "shadow-amber-500/20",
                    focusRing: "focus:ring-amber-500/50",
                    checkboxText: "text-amber-600",
                    buttonClass: "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700",
                    linkText: "text-amber-600",
                    linkHover: "hover:text-amber-700",
                    iconGroupFocus: "group-focus-within:text-amber-600",
                }
            };
            break;
    }

    return (
        <ModuleLoginPage {...moduleConfig} />
    );
}

export default function UniversalLoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
            <UniversalLoginContent />
        </Suspense>
    );
}
