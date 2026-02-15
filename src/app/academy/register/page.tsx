"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import { GraduationCap } from "lucide-react";
import Image from "next/image";

export default function AcademyRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="Academy"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/academy.png"
                        alt="Academy"
                        fill
                        priority
                        className="object-contain"
                    />
                </div>
            }
            description="Master the art of export with comprehensive courses, expert-led training, and certification programs."
            benefits={[
                "Export compliance training",
                "International trade certification",
                "Market analysis workshops",
                "Access to learning resources",
                "Expert mentorship sessions",
            ]}
            loginLink="/academy/login"
            platforms={["academy"]}
            theme={{
                gradient: "from-blue-900 to-slate-900",
                text: "text-blue-600",
                textLight: "text-blue-100",
                button: "bg-linear-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900",
                borderFocus: "focus:ring-blue-500",
                icon: "text-blue-500",
                checkbox: "text-blue-600 focus:ring-blue-500",
                heading: "text-white",
            }}
            brandingText="Join Academy"
            footerText="Implemented by Easy Sales Export"
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl opacity-50" />
                    <div className="absolute top-1/2 -right-32 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl opacity-50" />
                </div>
            }
        />
    );
}
