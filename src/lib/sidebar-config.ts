import {
    LayoutDashboard,
    Truck,
    Store,
    Users,
    Sprout,
    GraduationCap,
    Lock,
    MessageSquare,
    User,
    FileText,
    BookOpen,
    CheckCircle,
    Settings,
    Wallet,
    Home,
    Search,
    ShoppingCart,
    Package,
    ClipboardList,
    Leaf,
    Tractor,
    Map,
    Award,
    Briefcase,
    TrendingUp,
    ClipboardCheck,
    ShieldAlert,
    ScrollText,
    UserX,
    BadgeCheck,
    ToggleLeft,
    Waves,
    Building2,
    Container,
    MessageCircle,
} from "lucide-react";
import type { AppIdentifier } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";

export interface NavigationItem {
    name: string;
    href: string;
    icon: any;
    app?: AppIdentifier; // Optional, defaults to current module context
    requiredRole?: UserRole;
    exact?: boolean; // If true, matches exact path only
    featureToggle?: string; // Optional feature toggle to hide the item
}

export const GLOBAL_NAV_ITEMS: NavigationItem[] = [
    { name: "Messages", href: "/messages", icon: MessageSquare, app: "messages" },
    { name: "Profile", href: "/profile", icon: User, app: "profile" },
];

export const MODULE_NAVIGATION: Record<string, NavigationItem[]> = {
    // ------------------------------------------------------------------
    // HUB / DASHBOARD (General Entry)
    // ------------------------------------------------------------------
    "dashboard": [
        { name: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
        { name: "Settings", href: "/settings", icon: Settings },
    ],

    // ------------------------------------------------------------------
    // EXPORT (Module: /export) — pages live inside /export/(app)/
    // ------------------------------------------------------------------
    "export": [
        { name: "Dashboard", href: "/export/dashboard", icon: LayoutDashboard },
        { name: "Opportunities", href: "/export/opportunities", icon: Briefcase },
        { name: "Portfolio", href: "/export/portfolio", icon: TrendingUp },
        { name: "Transactions", href: "/export/transactions", icon: FileText },
        { name: "Browse Windows", href: "/export/windows", icon: Container },
    ],

    // ------------------------------------------------------------------
    // MARKETPLACE (Module: /marketplace)
    // ------------------------------------------------------------------
    "marketplace": [
        { name: "Market Overview", href: "/marketplace", icon: Store, exact: true },
        { name: "Browse Products", href: "/marketplace/buyer/products", icon: Search },
        { name: "Shopping Cart", href: "/marketplace/checkout", icon: ShoppingCart },
        { name: "My Orders", href: "/marketplace/buyer/orders", icon: Package },
        { name: "Escrow", href: "/escrow", icon: Lock, featureToggle: "escrow_messaging" },
        { name: "Seller Dashboard", href: "/marketplace/sell", icon: Store, requiredRole: "seller" },
        { name: "My Products", href: "/marketplace/products", icon: Package, requiredRole: "seller" },
    ],

    // ------------------------------------------------------------------
    // COOPERATIVES (Module: /cooperatives) — pages inside /cooperatives/(member)/
    // ------------------------------------------------------------------
    "cooperatives": [
        { name: "Dashboard", href: "/cooperatives/dashboard", icon: LayoutDashboard },
        { name: "My Savings", href: "/cooperatives/my-savings", icon: Wallet },
        { name: "Loans", href: "/cooperatives/loans", icon: ScrollText, featureToggle: "cooperative_loans" },
        { name: "Contribute", href: "/cooperatives/contribute", icon: TrendingUp },
        { name: "Directory", href: "/cooperatives/directory", icon: Users },
        { name: "History", href: "/cooperatives/history", icon: ClipboardList },
    ],

    // ------------------------------------------------------------------
    // FARM NATION (Module: /farm-nation)
    // ------------------------------------------------------------------
    "farm-nation": [
        { name: "Properties", href: "/farm-nation/properties", icon: Map, featureToggle: "farm_nation_purchases" },
        { name: "My Properties", href: "/farm-nation/my-properties", icon: Tractor },
        { name: "My Purchases", href: "/farm-nation/my-purchases", icon: Home, featureToggle: "farm_nation_purchases" },
        { name: "Map View", href: "/farm-nation/map", icon: Map },
        { name: "List Land", href: "/farm-nation/list-land", icon: Leaf },
    ],

    // ------------------------------------------------------------------
    // WAVE (Module: /wave) — pages inside /wave/(member)/
    // ------------------------------------------------------------------
    "wave": [
        { name: "Dashboard", href: "/wave/dashboard", icon: LayoutDashboard, featureToggle: "wave_program" },
        { name: "Training", href: "/wave/training", icon: BookOpen, featureToggle: "wave_program" },
        { name: "Resources", href: "/wave/resources", icon: FileText, featureToggle: "wave_program" },
        { name: "Earnings", href: "/wave/earnings", icon: TrendingUp, featureToggle: "wave_program" },
        { name: "Shipments", href: "/wave/shipments", icon: Truck, featureToggle: "wave_program" },
        { name: "Certificates", href: "/wave/certificates", icon: Award, featureToggle: "wave_program" },
    ],

    // ------------------------------------------------------------------
    // ACADEMY (Module: /academy) — pages in /academy/ and /academy/(learner)/
    // ------------------------------------------------------------------
    "academy": [
        { name: "Learning Home", href: "/academy/dashboard", icon: GraduationCap, featureToggle: "academy_courses" },
        { name: "My Courses", href: "/academy/my-courses", icon: BookOpen, featureToggle: "academy_courses" },
        { name: "My Progress", href: "/academy/progress", icon: TrendingUp, featureToggle: "academy_courses" },
    ],

    // ------------------------------------------------------------------
    // ADMIN (Module: /admin)
    // ------------------------------------------------------------------
    "admin": [
        // ── Core Platform ────────────────────────────────────────────────
        { name: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
        { name: "Analytics", href: "/admin/analytics", icon: TrendingUp },
        { name: "User Management", href: "/admin/users", icon: Users },
        { name: "Content Approval", href: "/admin/content-approval", icon: ClipboardCheck },
        { name: "Communications", href: "/admin/communications", icon: MessageSquare },
        { name: "Disputes", href: "/admin/disputes", icon: ShieldAlert },
        { name: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText },
        { name: "Orphaned Users", href: "/admin/orphaned-users", icon: UserX },

        { name: "Feature Toggles", href: "/admin/feature-toggles", icon: ToggleLeft },
        // ── Modules ──────────────────────────────────────────────────────
        { name: "WAVE Program", href: "/admin/wave", icon: Waves, featureToggle: "wave_program" },
        { name: "Cooperatives", href: "/admin/cooperatives", icon: Building2, featureToggle: "cooperative_loans" },
        { name: "Marketplace", href: "/admin/marketplace", icon: Store },
        { name: "Export Windows", href: "/admin/export", icon: Container },
        { name: "Export Applications", href: "/admin/export/applications", icon: FileText },
        { name: "Farm Nation", href: "/admin/farm-nation", icon: Tractor, featureToggle: "farm_nation_purchases" },
        { name: "Academy", href: "/admin/academy", icon: GraduationCap, featureToggle: "academy_courses" },
        // ── Finance & Settings ────────────────────────────────────────────
        { name: "Finance", href: "/admin/finance", icon: Wallet },
        { name: "Escrow Ledger", href: "/admin/escrow", icon: Lock },
        { name: "System Health", href: "/admin/system-health", icon: ShieldAlert },
        { name: "Settings", href: "/admin/settings", icon: Settings },
        // ── AI Tools ─────────────────────────────────────────────────────
        { name: "AI Chatbot", href: "/admin/chatbot", icon: MessageCircle, featureToggle: "ai_assistant" },
    ],
};

