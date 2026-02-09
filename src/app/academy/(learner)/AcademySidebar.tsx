"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    BookOpen,
    GraduationCap,
    BarChart3,
    Award,
    Calendar,
    MessageSquare,
    User,
    LogOut,
    Menu,
    X
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
    { href: "/academy/(learner)/my-courses", label: "My Courses", icon: BookOpen },
    { href: "/academy/(learner)/progress", label: "Progress", icon: BarChart3 },
    { href: "/academy/courses", label: "Browse Courses", icon: GraduationCap },
    { href: "/academy/live-sessions", label: "Live Sessions", icon: Calendar },
    { href: "/academy/(learner)/certificates", label: "Certificates", icon: Award },
    { href: "/academy/(learner)/community", label: "Community", icon: MessageSquare },
    { href: "/academy/(learner)/profile", label: "Profile", icon: User }
];

export default function AcademySidebar() {
    const pathname = usePathname();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <>
            {/* Mobile Menu Toggle */}
            <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg"
            >
                {isMobileMenuOpen ? (
                    <X className="w-6 h-6 text-slate-900 dark:text-white" />
                ) : (
                    <Menu className="w-6 h-6 text-slate-900 dark:text-white" />
                )}
            </button>

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-40 transition-transform lg:translate-x-0 ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                                <GraduationCap className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="font-bold text-slate-900 dark:text-white">Academy</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Learner Portal</p>
                            </div>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 p-4 overflow-y-auto">
                        <ul className="space-y-2">
                            {NAV_ITEMS.map((item) => {
                                const Icon = item.icon;
                                const isActive = pathname === item.href || pathname.startsWith(item.href);

                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${isActive
                                                    ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-semibold"
                                                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                }`}
                                        >
                                            <Icon
                                                className={`w-5 h-5 ${isActive
                                                        ? "text-blue-600 dark:text-blue-400"
                                                        : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"
                                                    }`}
                                            />
                                            <span>{item.label}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                        >
                            <LogOut className="w-5 h-5 text-slate-400" />
                            <span>Back to Dashboard</span>
                        </Link>
                    </div>
                </div>
            </aside>

            {/* Mobile Overlay */}
            {isMobileMenuOpen && (
                <div
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="lg:hidden fixed inset-0 bg-black/50 z-30"
                />
            )}
        </>
    );
}
