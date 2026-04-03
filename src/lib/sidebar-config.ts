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
        { name: "Browse Products", href: "/marketplace/buyer", icon: Search },
        { name: "My Orders", href: "/marketplace/orders", icon: Package },
        { name: "Escrow", href: "/escrow", icon: Lock },
        { name: "Seller Dashboard", href: "/marketplace/sell", icon: Store, requiredRole: "seller" },
        { name: "My Products", href: "/marketplace/products", icon: Package, requiredRole: "seller" },
    ],

    // ------------------------------------------------------------------
    // COOPERATIVES (Module: /cooperatives) — pages inside /cooperatives/(member)/
    // ------------------------------------------------------------------
    "cooperatives": [
        { name: "Dashboard", href: "/cooperatives/dashboard", icon: LayoutDashboard },
        { name: "My Savings", href: "/cooperatives/my-savings", icon: Wallet },
        { name: "Loans", href: "/cooperatives/loans", icon: ScrollText },
        { name: "Contribute", href: "/cooperatives/contribute", icon: TrendingUp },
        { name: "Directory", href: "/cooperatives/directory", icon: Users },
        { name: "History", href: "/cooperatives/history", icon: ClipboardList },
    ],

    // ------------------------------------------------------------------
    // FARM NATION (Module: /farm-nation)
    // ------------------------------------------------------------------
    "farm-nation": [
        { name: "Properties", href: "/farm-nation/properties", icon: Map },
        { name: "My Properties", href: "/farm-nation/my-properties", icon: Tractor },
        { name: "My Purchases", href: "/farm-nation/my-purchases", icon: Home },
        { name: "Map View", href: "/farm-nation/map", icon: Map },
        { name: "List Land", href: "/farm-nation/list-land", icon: Leaf },
    ],

    // ------------------------------------------------------------------
    // WAVE (Module: /wave) — pages inside /wave/(member)/
    // ------------------------------------------------------------------
    "wave": [
        { name: "Dashboard", href: "/wave/dashboard", icon: LayoutDashboard },
        { name: "Training", href: "/wave/training", icon: BookOpen },
        { name: "Resources", href: "/wave/resources", icon: FileText },
        { name: "Earnings", href: "/wave/earnings", icon: TrendingUp },
        { name: "Shipments", href: "/wave/shipments", icon: Truck },
        { name: "Certificates", href: "/wave/certificates", icon: Award },
    ],

    // ------------------------------------------------------------------
    // ACADEMY (Module: /academy) — pages in /academy/ and /academy/(learner)/
    // ------------------------------------------------------------------
    "academy": [
        { name: "Learning Home", href: "/academy/dashboard", icon: GraduationCap },
        { name: "My Courses", href: "/academy/my-courses", icon: BookOpen },
        { name: "My Progress", href: "/academy/progress", icon: TrendingUp },
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
        { name: "ID Verification", href: "/admin/verify-id", icon: BadgeCheck },
        { name: "Feature Toggles", href: "/admin/feature-toggles", icon: ToggleLeft },
        // ── Modules ──────────────────────────────────────────────────────
        { name: "WAVE Program", href: "/admin/wave", icon: Waves },
        { name: "Cooperatives", href: "/admin/cooperatives", icon: Building2 },
        { name: "Marketplace", href: "/admin/marketplace", icon: Store },
        { name: "Export Windows", href: "/admin/export", icon: Container },
        { name: "Export Applications", href: "/admin/export/applications", icon: FileText },
        { name: "Farm Nation", href: "/admin/farm-nation", icon: Tractor },
        { name: "Academy", href: "/admin/academy", icon: GraduationCap },
        // ── Finance & Settings ────────────────────────────────────────────
        { name: "Finance", href: "/admin/finance", icon: Wallet },
        { name: "Settings", href: "/admin/settings", icon: Settings },
        // ── AI Tools ─────────────────────────────────────────────────────
        { name: "AI Chatbot", href: "/admin/chatbot", icon: MessageCircle },
    ],
};

