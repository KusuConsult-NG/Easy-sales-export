"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import Image from "next/image";

export default function CooperativeRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="Cooperative"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/cooperative.png"
                        alt="Cooperative"
                        fill
                        className="object-contain"
                    />
                </div>
            }
            description="Unlock access to shared resources, collective bargaining power, and direct investment opportunities."
            benefits={[
                "Access to low-interest loans",
                "Bulk purchasing power",
                "Direct market linkages",
                "Expert agricultural training",
                "Investment opportunities",
            ]}
            loginLink="/cooperatives/login"
            platforms={["cooperatives"]}
            theme={{
                gradient: "from-purple-900 to-indigo-900",
                text: "text-purple-600",
                textLight: "text-purple-100",
                button: "bg-linear-to-r from-purple-800 to-indigo-900 hover:from-purple-900 hover:to-indigo-950",
                borderFocus: "focus:ring-purple-500",
                icon: "text-purple-400",
                checkbox: "text-purple-600 focus:ring-purple-500",
                heading: "text-white",
            }}
            brandingText="Join Cooperative"
            footerText="Implemented by Easy Sales Export"
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl opacity-50" />
                    <div className="absolute top-1/2 -right-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl opacity-50" />
                </div>
            }
        />
    );
}
