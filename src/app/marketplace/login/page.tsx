"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { Store } from "lucide-react";

export default function MarketplaceLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Marketplace"
            logo={Store}
            redirectDefault="/marketplace/onboarding"
            registerLink="/marketplace/register"
            registerText="New to the Marketplace?"
            theme={{
                logoGradient: "from-green-600 to-emerald-700",
                logoShadow: "shadow-green-500/20",
                focusRing: "focus:ring-green-500/50",
                focusBorder: "focus:border-green-500",
                checkboxText: "text-green-600",
                buttonClass: "bg-linear-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800",
                linkText: "text-green-600",
                linkHover: "hover:text-green-700",
                iconGroupFocus: "group-focus-within:text-green-600",
            }}
            backgroundConfig={{
                type: "standard",
                blobs: {
                    top: "bg-green-500/10",
                    bottom: "bg-emerald-500/10",
                },
            }}
        />
    );
}
