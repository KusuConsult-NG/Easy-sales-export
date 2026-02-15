"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import { Ship } from "lucide-react";
import Image from "next/image";

export default function ExportRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="Export Windows"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/export.png"
                        alt="Export Windows"
                        fill
                        priority
                        className="object-contain"
                    />
                </div>
            }
            description="Access verified export containers and earn guaranteed returns on your trade investments."
            benefits={[
                "Access verified export containers",
                "Track shipments in real-time",
                "Guaranteed ROI on investments",
                "Expert trade facilitation",
                "Insurance & security",
            ]}
            loginLink="/export/login"
            platforms={["export"]}
            theme={{
                gradient: "from-orange-600 to-amber-700",
                text: "text-orange-600",
                textLight: "text-orange-100",
                button: "bg-linear-to-r from-orange-600 to-amber-700 hover:from-orange-700 hover:to-amber-800",
                borderFocus: "focus:ring-orange-500",
                icon: "text-orange-500",
                checkbox: "text-orange-600 focus:ring-orange-500",
                heading: "text-white",
            }}
            brandingText="Join Export Windows"
            footerText="Implemented by Easy Sales Export"
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl opacity-50" />
                    <div className="absolute top-1/2 -right-32 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl opacity-50" />
                </div>
            }
        />
    );
}
