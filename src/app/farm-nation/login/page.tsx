"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { Sprout } from "lucide-react";

export default function FarmNationLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Farm Nation"
            logo={Sprout}
            logoImage="/images/modules/farm-nation.png"
            redirectDefault="/farm-nation/onboarding"
            registerLink="/farm-nation/register"
            registerText="New to Farm Nation?"
            theme={{
                logoGradient: "from-teal-600 to-cyan-700",
                logoShadow: "shadow-teal-500/20",
                focusRing: "focus:ring-teal-500/50",
                focusBorder: "focus:border-teal-500",
                checkboxText: "text-teal-600",
                buttonClass: "bg-linear-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800",
                linkText: "text-teal-600",
                linkHover: "hover:text-teal-700",
                iconGroupFocus: "group-focus-within:text-teal-600",
            }}
            backgroundConfig={{
                type: "standard",
                blobs: {
                    top: "bg-teal-500/10",
                    bottom: "bg-cyan-500/10",
                },
            }}
        />
    );
}
