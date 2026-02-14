"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { Building2 } from "lucide-react";

export default function CooperativeLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Cooperative"
            logo={Building2}
            redirectDefault="/cooperatives/dashboard"
            registerLink="/cooperatives/register"
            registerText="New to the Cooperative?"
            theme={{
                logoGradient: "from-purple-800 to-indigo-900",
                logoShadow: "shadow-purple-500/20",
                focusRing: "focus:ring-purple-500/50",
                focusBorder: "focus:border-purple-500",
                checkboxText: "text-purple-600",
                buttonClass: "bg-blue-900 hover:bg-blue-950",
                linkText: "text-purple-600",
                linkHover: "hover:text-purple-700",
                iconGroupFocus: "group-focus-within:text-purple-600",
            }}
            backgroundConfig={{
                type: "standard",
                blobs: {
                    top: "bg-purple-500/10",
                    bottom: "bg-indigo-500/10",
                },
            }}
        />
    );
}
