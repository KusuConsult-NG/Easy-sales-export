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
    Briefcase
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
        { name: "Overview", href: "/admin", icon: LayoutDashboard, exact: true },
        { name: "Users", href: "/admin/users", icon: Users },
        { name: "Approvals", href: "/admin/content-approval", icon: CheckCircle },
        { name: "Exports", href: "/admin/export", icon: Truck },
        { name: "Academy", href: "/admin/academy", icon: GraduationCap },
        { name: "Finance", href: "/admin/finance", icon: Wallet },
        { name: "Settings", href: "/admin/settings", icon: Settings },
    ],
};
