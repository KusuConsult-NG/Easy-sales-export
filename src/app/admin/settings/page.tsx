"use client";

import { Settings, Shield, Globe, Bell, Database } from "lucide-react";
import Link from "next/link";

export default function AdminSettingsPage() {
    const sections = [
        {
            title: "General Configuration",
            description: "Platform name, contacts, and global settings",
            icon: Settings,
            href: "/admin/settings/general",
            color: "text-slate-600",
            bg: "bg-slate-100 dark:bg-slate-800"
        },
        {
            title: "Security & Access",
            description: "Manage admin roles, 2FA enforcement, and sessions",
            icon: Shield,
            href: "/admin/settings/security",
            color: "text-blue-600",
            bg: "bg-blue-100 dark:bg-blue-900/20"
        },
        {
            title: "Notifications",
            description: "Configure email templates and system alerts",
            icon: Bell,
            href: "/admin/settings/notifications",
            color: "text-amber-600",
            bg: "bg-amber-100 dark:bg-amber-900/20"
        },
        {
            title: "Localization",
            description: "Manage supported languages and currencies",
            icon: Globe,
            href: "/admin/settings/localization",
            color: "text-green-600",
            bg: "bg-green-100 dark:bg-green-900/20"
        },
        {
            title: "System Logs",
            description: "View system health and audit logs",
            icon: Database,
            href: "/admin/settings/logs",
            color: "text-purple-600",
            bg: "bg-purple-100 dark:bg-purple-900/20"
        }
    ];

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    System Settings
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Configure platform behavior and security policies
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sections.map((section) => (
                    <Link
                        key={section.title}
                        href={section.href}
                        className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm hover:shadow-md transition group"
                    >
                        <div className={`w-12 h-12 rounded-xl ${section.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                            <section.icon className={`w-6 h-6 ${section.color}`} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                            {section.title}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {section.description}
                        </p>
                    </Link>
                ))}
            </div>
        </div>
    );
}
