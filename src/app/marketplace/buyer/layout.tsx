/**
 * Buyer Layout with Access Control
 * 
 * Protects buyer routes and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { initializeApp, getApps } from "firebase-admin/app";
import Link from "next/link";
import { Home, ShoppingCart, Package, User, Search } from "lucide-react";

async function BuyerLayoutContent({ children }: { children: React.ReactNode }) {
    const navItems = [
        { href: "/marketplace/buyer/dashboard", label: "Dashboard", icon: Home },
        { href: "/marketplace/buyer/products", label: "Products", icon: Search },
        { href: "/marketplace/buyer/orders", label: "Orders", icon: Package },
        { href: "/marketplace/buyer/cart", label: "Cart", icon: ShoppingCart },
        { href: "/marketplace/buyer/profile", label: "Profile", icon: User }
    ];

    return (
        <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Sidebar */}
            <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 fixed h-full">
                <div className="p-6">
                    <Link href="/marketplace" className="flex items-center gap-3 mb-8">
                        <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                            <ShoppingCart className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-900 dark:text-white">Marketplace</h2>
                            <p className="text-xs text-slate-500">Buyer Portal</p>
                        </div>
                    </Link>

                    <nav className="space-y-2">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300 transition-colors"
                                >
                                    <Icon className="w-5 h-5" />
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-64">
                {children}
            </main>
        </div>
    );
}

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
    // Initialize Firebase Admin if needed
    if (getApps().length === 0) {
        initializeApp();
    }

    const auth = getAuth();

    // Get session cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session")?.value;

    if (!sessionCookie) {
        redirect("/auth/login");
    }

    try {
        // Verify session
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        // Check marketplace access (buyer)
        const accessResult = await checkServiceAccess(userId, "marketplace");

        if (!accessResult.hasAccess) {
            if (accessResult.redirectTo) {
                redirect(accessResult.redirectTo);
            }
            redirect("/marketplace/onboarding");
        }

        // User has access, render the layout
        return <BuyerLayoutContent>{children}</BuyerLayoutContent>;
    } catch (error) {
        console.error("Buyer access check error:", error);
        redirect("/auth/login");
    }
}
