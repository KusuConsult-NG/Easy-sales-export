
"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { LayoutGrid } from "lucide-react";

export default function UniversalLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Easy Sales Export"
            logo={LayoutGrid}
            redirectDefault="/dashboard"
            registerLink="/auth/get-started"
            registerText="New to the platform?"
            registerButtonText="Get Started"
            theme={{
                logoGradient: "from-slate-800 to-slate-900",
                logoShadow: "shadow-slate-500/20",
                focusRing: "focus:ring-slate-500/50",
                checkboxText: "text-slate-600",
                buttonClass: "bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-900 hover:to-slate-950",
                linkText: "text-slate-600",
                linkHover: "hover:text-slate-900",
                iconGroupFocus: "group-focus-within:text-slate-600",
            }}
        />
    );
}
