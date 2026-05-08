// Brand Colors
export const COLORS = {
    primary: "#2E519F",
    accent: "#E31E24",
} as const;

// Currency Configuration (Centralized)
export const CURRENCY_CONFIG = {
    code: "NGN",
    symbol: "₦",
    locale: "en-NG",
} as const;

// Approved Commodities
export const COMMODITIES = [
    "Yam Tubers",
    "Sesame Seeds",
    "Dried Hibiscus",
] as const;

// Navigation Menu Items
export const NAVIGATION_ITEMS = [
    { name: "Dashboard", href: "/", icon: "dashboard" },
    { name: "Export Windows", href: "/export", icon: "local_shipping" },
    { name: "Marketplace", href: "/marketplace", icon: "store" },
    { name: "Cooperatives", href: "/cooperatives", icon: "groups" },
    { name: "WAVE Program", href: "/wave", icon: "waves" },
    { name: "Farm Nation", href: "/farm-nation", icon: "agriculture" },
    { name: "Academy", href: "/academy", icon: "school" },
] as const;

// Company Info
export const COMPANY_INFO = {
    name: "Easy Sales Export",
    tagline: "Export & Agriculture",
    fullName: "EASY SALES EXPORT & AGRICULTURE",
    rc: "RC: 763845",
    contact: {
        cooperative: {
            email: "info@easysalesexport.com",
            address: "68 Murtala Muhammed Way, opposite UTC junction, beside the VIO office, in Jos, Plateau State, Nigeria",
        },
        general: {
            email: "info@easysalesexport.com",
            phone: "02013309593",
            whatsapp: "07076988080",
        },
    },
    copyright: `© ${new Date().getFullYear()} EASY SALES EXPORT & AGRICULTURE. All rights reserved.`,
} as const;

// Cooperative Configuration
export const COOPERATIVE_CONFIG = {
    registrationFee: 10000,
} as const;

// Academy Configuration
export const ACADEMY_CONFIG = {
    plans: {
        foundation: {
            id: "foundation",
            name: "Foundation Program",
            fee: 25000,
            description: "Essential knowledge for starting your agro-export journey correctly.",
            features: ["Export fundamentals", "Agro-business structure", "Basic market access strategy"],
            highlight: false,
        },
        standard: {
            id: "standard",
            name: "Standard Program",
            fee: 50000,
            description: "Deep dive into strategies, compliance, and scaling your operations.",
            features: ["Advanced export strategies", "Comprehensive compliance training", "Cooperative opportunity positioning"],
            highlight: true,
        },
        elite: {
            id: "elite",
            name: "Elite Program",
            fee: 100000,
            description: "The complete playbook for high-level execution and dominance.",
            features: ["Full ecosystem mastery", "Direct market linkages", "Priority positioning strategy"],
            highlight: false,
        },
    },
} as const;


