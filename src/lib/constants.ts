// Brand Colors
export const COLORS = {
    primary: "#2E519F",
    accent: "#E31E24",
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
    tagline: "Export & Agri",
    fullName: "EASY SALES EXPORT & AGRICULTURE",
    rc: "RC: 763845",
    copyright: `© ${new Date().getFullYear()} EASY SALES EXPORT & AGRICULTURE. All rights reserved.`,
} as const;

