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
    // EXPORT (Module: /export)
    // ------------------------------------------------------------------
    "export": [
        { name: "Dashboard", href: "/export/dashboard", icon: LayoutDashboard },
        { name: "My Windows", href: "/export/windows", icon: Briefcase },
        { name: "Shipments", href: "/export/shipments", icon: Truck },
        { name: "Documentation", href: "/export/documents", icon: FileText },
        { name: "Compliance", href: "/export/compliance", icon: CheckCircle },
    ],

    // ------------------------------------------------------------------
    // MARKETPLACE (Module: /marketplace)
    // ------------------------------------------------------------------
    "marketplace": [
        { name: "Market Overview", href: "/marketplace", icon: Store, exact: true },
        // Buyer View
        { name: "Browse Products", href: "/marketplace/buyer", icon: Search },
        { name: "My Orders", href: "/marketplace/orders", icon: Package },
        { name: "Cart", href: "/marketplace/cart", icon: ShoppingCart },
        { name: "Escrow", href: "/escrow", icon: Lock }, // Escrow is tight to Marketplace
        // Seller View (Conditional in Sidebar component)
        { name: "Seller Dashboard", href: "/marketplace/seller", icon: Store, requiredRole: "seller" },
        { name: "My Products", href: "/marketplace/seller/products", icon: Package, requiredRole: "seller" },
    ],

    // ------------------------------------------------------------------
    // COOPERATIVES (Module: /cooperatives)
    // ------------------------------------------------------------------
    "cooperatives": [
        { name: "Dashboard", href: "/cooperatives/dashboard", icon: LayoutDashboard },
        { name: "Members", href: "/cooperatives/members", icon: Users },
        { name: "Loans", href: "/cooperatives/loans", icon: Wallet },
        {
            name: "Savings", href: "/cooperatives/savings", icon:
                // Custom Piggy Bank Icon or similar if needed, reuse Wallet for now
                Wallet
        },
        { name: "Resources", href: "/cooperatives/resources", icon: BookOpen },
    ],

    // ------------------------------------------------------------------
    // FARM NATION (Module: /farm-nation)
    // ------------------------------------------------------------------
    "farm-nation": [
        { name: "Dashboard", href: "/farm-nation/dashboard", icon: LayoutDashboard },
        { name: "Land Listings", href: "/farm-nation/listings", icon: Map },
        { name: "My Farms", href: "/farm-nation/farms", icon: Tractor },
        { name: "Investments", href: "/farm-nation/investments", icon: Leaf },
    ],

    // ------------------------------------------------------------------
    // WAVE (Module: /wave) -> DISTINCT BRANDING
    // ------------------------------------------------------------------
    "wave": [
        { name: "Dashboard", href: "/wave/dashboard", icon: LayoutDashboard },
        { name: "Training", href: "/wave/training", icon: BookOpen },
        { name: "Grants", href: "/wave/grants", icon: Award },
        { name: "Community", href: "/wave/community", icon: Users },
        { name: "Resources", href: "/wave/resources", icon: FileText },
    ],

    // ------------------------------------------------------------------
    // ACADEMY (Module: /academy)
    // ------------------------------------------------------------------
    "academy": [
        { name: "Learning Home", href: "/academy/dashboard", icon: GraduationCap },
        { name: "My Courses", href: "/academy/courses", icon: BookOpen },
        { name: "Certificates", href: "/academy/certificates", icon: Award },
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
    ],
};
