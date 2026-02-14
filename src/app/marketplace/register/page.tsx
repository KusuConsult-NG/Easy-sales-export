"use client";

import ModuleRegisterPage from "@/components/auth/ModuleRegisterPage";
import { Store } from "lucide-react";
import Image from "next/image";

export default function MarketplaceRegisterPage() {
    return (
        <ModuleRegisterPage
            moduleName="Marketplace"
            logo={
                <div className="w-16 h-16 relative mb-4">
                    <Image
                        src="/images/modules/marketplace.png"
                        alt="Marketplace"
                        fill
                        className="object-contain"
                    />
                </div>
            }
            description="Connect buyers and sellers in a secure, transparent marketplace ecosystem."
            benefits={[
                "List products for free",
                "Reach thousands of buyers",
                "Secure escrow payments",
                "Seller dashboard & analytics",
                "24/7 marketplace support",
            ]}
            loginLink="/marketplace/login"
            platforms={["marketplace"]}
            theme={{
                gradient: "from-green-600 to-emerald-700",
                text: "text-green-600",
                textLight: "text-green-100",
                button: "bg-linear-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800",
                borderFocus: "focus:ring-green-500",
                icon: "text-green-500",
                checkbox: "text-green-600 focus:ring-green-500",
                heading: "text-white",
            }}
            brandingText="Join Marketplace"
            footerText="Implemented by Easy Sales Export"
            backgroundImage={
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-32 -left-32 w-96 h-96 bg-green-500/10 rounded-full blur-3xl opacity-50" />
                    <div className="absolute top-1/2 -right-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl opacity-50" />
                </div>
            }
        />
    );
}
