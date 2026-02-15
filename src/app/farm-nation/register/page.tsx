"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import { Sprout } from "lucide-react";
import Image from "next/image";

export default function FarmNationRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="Farm Nation"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/farm-nation.png"
                        alt="Farm Nation"
                        fill
                        priority
                        className="object-contain"
                    />
                </div>
            }
            description="Own farmland with minimal capital and earn from verified agricultural investments."
            benefits={[
                "Own farmland with low capital",
                "Verified agricultural properties",
                "Transparent profit sharing",
                "Expert farm management",
                "Harvest guarantees"
            ]}
            loginLink="/farm-nation/login"
            platforms={["farm-nation"]}
            theme={{
                gradient: "from-teal-600 to-cyan-700",
                text: "text-teal-600",
                textLight: "text-teal-100",
                button: "bg-linear-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800",
                borderFocus: "focus:ring-teal-500",
                icon: "text-teal-500",
                checkbox: "text-teal-600 focus:ring-teal-500",
                heading: "text-white",
            }}
            brandingText="Join Farm Nation"
            footerText="Implemented by Easy Sales Export"
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl opacity-50" />
                    <div className="absolute top-1/2 -right-32 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl opacity-50" />
                </div>
            }
        />
    );
}
