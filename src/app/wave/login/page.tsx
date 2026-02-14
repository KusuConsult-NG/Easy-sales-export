"use client";



import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { Sparkles } from "lucide-react";

export default function WaveLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="WAVE"
            logo={Sparkles}
            logoImage="/images/modules/wave.png"
            redirectDefault="/wave/dashboard"
            registerLink="/wave/register"
            theme={{
                logoGradient: "from-emerald-800 to-emerald-900 border-2 border-emerald-400/20",
                logoShadow: "shadow-2xl shadow-emerald-900/50",
                focusRing: "focus:ring-emerald-500",
                checkboxText: "text-emerald-500",
                buttonClass: "bg-linear-to-r from-emerald-600 to-emerald-800 hover:from-emerald-700 hover:to-emerald-900 border-0",
                linkText: "text-white",
                linkHover: "hover:underline",
                iconGroupFocus: "group-focus-within:text-emerald-400",
                textClass: "text-white",
                subTextClass: "text-emerald-200",
                cardClass: "bg-white/5 backdrop-blur-xl border border-emerald-500/20 shadow-2xl shadow-black/20",
                labelClass: "text-emerald-100",
                inputClass: "bg-white/5 border-emerald-500/20 text-white",
                inputIconClass: "text-emerald-400",
                placeholderClass: "placeholder:text-emerald-200/30",
            }}
            backgroundConfig={{
                type: "custom",
                className: "min-h-screen bg-linear-to-br from-stone-900 via-emerald-950 to-stone-900 flex items-center justify-center p-4 relative overflow-hidden"
            }}
        />
    );
}
