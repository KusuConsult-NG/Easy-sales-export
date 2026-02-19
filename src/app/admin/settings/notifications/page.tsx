"use client";

import { Bell, Mail, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function NotificationSettingsPage() {
    const [notifications, setNotifications] = useState({
        newUserEmail: true,
        exportRequestEmail: true,
        loanApplicationEmail: true,
        systemAlerts: true,
        weeklyDigest: false,
    });

    const toggle = (key: keyof typeof notifications) => {
        setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const items = [
        { key: "newUserEmail" as const, label: "New User Registration", desc: "Email when a new user signs up" },
        { key: "exportRequestEmail" as const, label: "Export Requests", desc: "Email for new export applications" },
        { key: "loanApplicationEmail" as const, label: "Loan Applications", desc: "Email for new loan requests" },
        { key: "systemAlerts" as const, label: "System Alerts", desc: "Critical system notifications" },
        { key: "weeklyDigest" as const, label: "Weekly Digest", desc: "Summary of platform activity" },
    ];

    return (
        <div className="p-8 max-w-3xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Notification Settings</h1>
            <p className="text-slate-600 mb-8">Configure email templates and system alerts</p>

            <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
                {items.map(item => (
                    <div key={item.key} className="flex items-center justify-between p-6">
                        <div>
                            <p className="font-medium text-slate-900">{item.label}</p>
                            <p className="text-sm text-slate-500">{item.desc}</p>
                        </div>
                        <button onClick={() => toggle(item.key)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${notifications[item.key] ? "bg-blue-500" : "bg-slate-300"}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${notifications[item.key] ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
