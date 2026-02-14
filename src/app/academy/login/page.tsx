"use client";

import ModuleLoginPage from "@/components/auth/ModuleLoginPage";
import { GraduationCap } from "lucide-react";

export default function AcademyLoginPage() {
    return (
        <ModuleLoginPage
            moduleName="Academy"
            logo={GraduationCap}
            redirectDefault="/academy/application"
            registerLink="/academy/register"
            registerText="New to the Academy?"
            theme={{
                logoGradient: "from-blue-600 to-indigo-700",
                logoShadow: "shadow-blue-500/20",
                focusRing: "focus:ring-blue-500/50",
                focusBorder: "focus:border-blue-500",
                checkboxText: "text-blue-600",
                buttonClass: "bg-linear-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800",
                linkText: "text-blue-600",
                linkHover: "hover:text-blue-700",
                iconGroupFocus: "group-focus-within:text-blue-600",
            }}
            backgroundConfig={{
                type: "standard",
                blobs: {
                    top: "bg-blue-500/10",
                    bottom: "bg-indigo-500/10",
                },
            }}
        />
    );
}
