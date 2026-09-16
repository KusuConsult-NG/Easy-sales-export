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
    /**
     * The strapline under the module name in the sidebar.
     *
     *   #824 OPTIONAL, because WAVE's was a SEVENTH INVENTED EXPANSION.
     *
     *   It read "Women's Agribusiness" — sitting under "WAVE Program" in the
     *   top-left of every WAVE screen, where it reads as what the letters stand
     *   for. It is not. #774 found five expansions and corrected them, #777 a
     *   sixth on the application form, and this was a seventh that no sweep
     *   reached because it is not a sentence about the programme at all, just a
     *   two-word strapline in a config file.
     *
     *   The owner: "at the Top left of the sidebar remove wave agribusiness
     *   completely."
     *
     *   Omitted rather than blanked: the sidebar used to fall back to "Hub" for
     *   an empty string, so setting it to "" would have put a different wrong
     *   word in the same place.
     */
    description?: string;
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
        //   #824 No strapline. See the note on `description` above: the one
        //   that was here read as an expansion of the acronym and was not one.
        //   The name alone is correct and complete.
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
        theme: "indigo",
        icon: Lock,
        pathPrefix: "/escrow",
    },

};

/**
 * Helper to get the active module configuration based on the current path and domain
 */
export function getModuleConfig(pathname: string | null, hostname?: string): ModuleConfig {
    if (!pathname) return DEFAULT_MODULE;

    // 1. Check hostname if provided (server-side detection)
    if (hostname) {
        const cleanedHost = hostname.replace(/^www\./, "").toLowerCase();
        if (cleanedHost === "easysalescooperative.com" || cleanedHost.endsWith(".easysalescooperative.com")) {
            return MODULE_CONFIGS.cooperatives;
        }
    }

    // 2. Check window.location if in browser (client-side detection)
    if (typeof window !== "undefined") {
        const cleanedHost = window.location.hostname.replace(/^www\./, "").toLowerCase();
        if (cleanedHost === "easysalescooperative.com" || cleanedHost.endsWith(".easysalescooperative.com")) {
            return MODULE_CONFIGS.cooperatives;
        }
    }

    // 3. Find the matching module config based on pathname prefix
    const moduleKey = Object.keys(MODULE_CONFIGS).find(key =>
        pathname.startsWith(`/${key}`)
    );

    return moduleKey ? MODULE_CONFIGS[moduleKey] : DEFAULT_MODULE;
}
