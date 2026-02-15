"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import { Sparkles } from "lucide-react";
import Image from "next/image";

export default function WaveRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="WAVE"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/wave.png"
                        alt="WAVE"
                        fill
                        priority
                        className="object-contain"
                    />
                </div>
            }
            description="Women's Agribusiness Venture Empowerment. A program exclusively designed to empower women in agriculture through funding, training, and mentorship."
            benefits={[
                "Access to grants and funding",
                "Business training & mentorship",
                "Network of women entrepreneurs",
                "Market access support",
                "Exclusive workshops",
            ]}
            loginLink="/wave/login"
            platforms={["wave"]}
            fixedGender="female" // Enforce female-only registration
            theme={{
                gradient: "from-stone-900 via-emerald-900 to-stone-900",
                text: "text-emerald-500",
                textLight: "text-emerald-100",
                button: "bg-linear-to-r from-emerald-600 to-emerald-800 hover:from-emerald-700 hover:to-emerald-900",
                borderFocus: "focus:ring-emerald-500",
                icon: "text-emerald-500",
                checkbox: "text-emerald-600 focus:ring-emerald-500",
                heading: "text-emerald-50",
            }}
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none bg-stone-900">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-900/40 rounded-full blur-3xl opacity-50" />
                    <div className="absolute bottom-0 -right-32 w-96 h-96 bg-emerald-800/20 rounded-full blur-3xl opacity-50" />
                </div>
            }
            footerText="Implemented by Easy Sales Export"
            brandingText="Join WAVE"
        />
    );
}
