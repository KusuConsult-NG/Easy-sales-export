/**
 * Cooperative Sidebar Navigation
 * 
 * Fixed sidebar for member portal navigation
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Home,
    Wallet,
    PlusCircle,
    TrendingUp,
    CreditCard,
    ArrowDownLeft,
    History,
    Users,
    Settings,
    Menu,
    X,
    Award,
    LogOut
} from "lucide-react";
import { useState } from "react";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const navItems = [
    { icon: Home, label: "Dashboard", href: "/cooperatives/dashboard" },
    { icon: Wallet, label: "My Savings", href: "/cooperatives/my-savings" },
    { icon: PlusCircle, label: "Contribute", href: "/cooperatives/contribute" },
    { icon: TrendingUp, label: "Loans", href: "/cooperatives/loans" },
    { icon: CreditCard, label: "My Loans", href: "/cooperatives/my-loans" },
    { icon: ArrowDownLeft, label: "Withdrawals", href: "/cooperatives/withdrawals" },
    { icon: History, label: "History", href: "/cooperatives/history" },
    { icon: Users, label: "Directory", href: "/cooperatives/directory" },
];

interface CooperativeSidebarProps {
    user?: {
        firstName: string;
        lastName: string;
        tier: string;
    };
}

export default function CooperativeSidebar({ user }: CooperativeSidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const handleLogout = async () => {
        await signOut({ redirect: false });
        router.push('/cooperatives/login');
    };

    const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

    const initials = user?.firstName && user?.lastName
        ? `${user.firstName[0]}${user.lastName[0]}`
        : "ME";

    const fullName = user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : "Member";

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-purple-900 text-white rounded-lg shadow-lg"
            >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform z-40 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    }`}
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                    {/* Company Brand */}
                    <div className="flex items-center gap-2 mb-6">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={24}
                            height={24}
                            className="rounded-full border border-slate-200 dark:border-slate-700"
                        />
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-widest uppercase">
                            {COMPANY_INFO.name}
                        </span>
                    </div>

                    <Link href="/cooperatives" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 bg-linear-to-br from-purple-800 to-indigo-900 rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                            <Award className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-900 dark:text-white text-lg">Cooperative</h2>
                            <p className="text-xs text-slate-600 dark:text-slate-400">Member Portal</p>
                        </div>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active
                                    ? "bg-purple-900 text-white shadow-lg shadow-purple-900/30"
                                    : "text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                                    }`}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* User Info & Logout */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
                        <div className="w-10 h-10 bg-linear-to-br from-purple-800 to-indigo-900 rounded-full flex items-center justify-center text-white font-bold">
                            {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                                {fullName}
                            </p>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-300 text-xs font-semibold rounded-full capitalize">
                                    {user?.tier || "Basic"}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all"
                    >
                        <LogOut className="w-5 h-5" />
                        <span className="font-medium">Logout</span>
                    </button>
                </div>
            </aside>


            {/* Mobile Overlay */}
            {mobileMenuOpen && (
                <div
                    onClick={() => setMobileMenuOpen(false)}
                    className="lg:hidden fixed inset-0 bg-black/50 z-30"
                />
            )}
        </>
    );
}
