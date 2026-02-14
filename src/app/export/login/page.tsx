"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { Ship } from "lucide-react";

export default function ExportLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Export Windows"
            logo={Ship}
            logoImage="/images/modules/export.png"
            redirectDefault="/export/onboarding"
            registerLink="/export/register"
            registerText="New to Export Windows?"
            theme={{
                logoGradient: "from-orange-600 to-amber-700",
                logoShadow: "shadow-orange-500/20",
                focusRing: "focus:ring-orange-500/50",
                focusBorder: "focus:border-orange-500",
                checkboxText: "text-orange-600",
                buttonClass: "bg-linear-to-r from-orange-600 to-amber-700 hover:from-orange-700 hover:to-amber-800",
                linkText: "text-orange-600",
                linkHover: "hover:text-orange-700",
                iconGroupFocus: "group-focus-within:text-orange-600",
            }}
            backgroundConfig={{
                type: "standard",
                blobs: {
                    top: "bg-orange-500/10",
                    bottom: "bg-amber-500/10",
                },
            }}
        />
    );
}
