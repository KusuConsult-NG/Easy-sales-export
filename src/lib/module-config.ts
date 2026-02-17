import {
    Sparkles,
    Users,
    Sprout,
    GraduationCap,
    Store,
    LayoutDashboard,
    FileText,
    Lock,
    MessageSquare,
    User,
    LucideIcon
} from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";

export type ModuleConfig = {
    name: string;
    description: string;
    theme: string; // Tailwind color name (e.g., "emerald", "blue", "teal")
    icon: LucideIcon;
    pathPrefix: string;
};

export const DEFAULT_MODULE: ModuleConfig = {
    name: COMPANY_INFO.name,
    description: "Export & Agriculture",
    theme: "primary", // Uses default primary color
    icon: LayoutDashboard,
    pathPrefix: "/dashboard",
};

export const MODULE_CONFIGS: Record<string, ModuleConfig> = {
    wave: {
        name: "WAVE Program",
        description: "Women's Agribusiness",
        theme: "emerald",
        icon: Sparkles,
        pathPrefix: "/wave",
    },
    cooperatives: {
        name: "Cooperatives",
        description: "Member Portal",
        theme: "blue",
        icon: Users,
        pathPrefix: "/cooperatives",
    },
    "farm-nation": {
        name: "Farm Nation",
        description: "Agricultural Investment",
        theme: "teal",
        icon: Sprout,
        pathPrefix: "/farm-nation",
    },
    academy: {
        name: "Academy",
        description: "Learning Portal",
        theme: "amber",
        icon: GraduationCap,
        pathPrefix: "/academy",
    },
    marketplace: {
        name: "Marketplace",
        description: "Global Trade",
        theme: "indigo",
        icon: Store,
        pathPrefix: "/marketplace",
    },
    export: {
        name: "Export Windows",
        description: "Logistics & Trade",
        theme: "sky",
        icon: FileText,
        pathPrefix: "/export",
    },
    escrow: {
        name: "Secure Escrow",
        description: "Transaction Protection",
        theme: "rose",
        icon: Lock,
        pathPrefix: "/escrow",
    },
};

/**
 * Helper to get the active module configuration based on the current path
 */
export function getModuleConfig(pathname: string | null): ModuleConfig {
    if (!pathname) return DEFAULT_MODULE;

    // Find the matching module config
    const moduleKey = Object.keys(MODULE_CONFIGS).find(key =>
        pathname.startsWith(`/${key}`)
    );

    return moduleKey ? MODULE_CONFIGS[moduleKey] : DEFAULT_MODULE;
}
