"use client";

import { Bell, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useToast } from "@/contexts/ToastContext";

interface NotificationSettings {
    newUserEmail: boolean;
    exportRequestEmail: boolean;
    loanApplicationEmail: boolean;
    systemAlerts: boolean;
    weeklyDigest: boolean;
}

export default function NotificationSettingsPage() {
    const { showToast } = useToast();
    const [notifications, setNotifications] = useState<NotificationSettings>({
        newUserEmail: true,
        exportRequestEmail: true,
        loanApplicationEmail: true,
        systemAlerts: true,
        weeklyDigest: false,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        try {
            const res = await fetch("/api/admin/settings/notifications");
            if (res.ok) {
                const data = await res.json();
                if (data.settings) {
                    setNotifications(data.settings);
                }
            }
        } catch {
            // Use defaults on error
        } finally {
            setLoading(false);
        }
    }

    async function saveSettings() {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/settings/notifications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ settings: notifications }),
            });
            if (res.ok) {
                showToast("Notification settings saved", "success");
            } else {
                showToast("Failed to save settings", "error");
            }
        } catch {
            showToast("Failed to save settings", "error");
        } finally {
            setSaving(false);
        }
    }

    const toggle = (key: keyof NotificationSettings) => {
        setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const items = [
        { key: "newUserEmail" as const, label: "New User Registration", desc: "Email when a new user signs up" },
        { key: "exportRequestEmail" as const, label: "Export Requests", desc: "Email for new export applications" },
        { key: "loanApplicationEmail" as const, label: "Loan Applications", desc: "Email for new loan requests" },
        { key: "systemAlerts" as const, label: "System Alerts", desc: "Critical system notifications" },
        { key: "weeklyDigest" as const, label: "Weekly Digest", desc: "Summary of platform activity" },
    ];

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[300px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-3xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-3xl font-bold text-slate-900">Notification Settings</h1>
                <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                </button>
            </div>
            {/*
              * This said "Configure which events trigger admin email
              * notifications". It configures nothing, and the notifications do
              * not exist.
              *
              * None of the five keys — newUserEmail, exportRequestEmail,
              * loanApplicationEmail, systemAlerts, weeklyDigest — is read
              * anywhere outside this screen and the route that stores them.
              * More than that: there is no admin-directed email sender in the
              * platform at all. Every function in lib/email-notifications.ts
              * writes to a user — membership approval, withdrawal confirmation,
              * seller approval — and nothing sends to an operator address.
              *
              * Four of the five default to ON, so an operator opening this page
              * is told that new-user, export-request and loan-application
              * emails are being sent to them, and that System Alerts —
              * "Critical system notifications" — is active. None of it is. That
              * is the same defect as the MFA line on the security screen and
              * worse in one respect: someone relying on system alerts to hear
              * about a problem has been told they are covered.
              *
              * Same treatment as #170. The preferences are still stored and are
              * what a notifier should read when one is built; the copy now says
              * which of those two things is true today.
              */}
            <p className="text-slate-600 mb-2">Preferences for admin email notifications</p>
            <p className="text-sm text-amber-700 mb-8">
                Not yet active — these preferences are recorded, but the platform has no
                admin notification email. Nothing reads these settings and no message is
                sent for any of the events below.
            </p>

            <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
                {items.map(item => (
                    <div key={item.key} className="flex items-center justify-between p-6">
                        <div>
                            <p className="font-medium text-slate-900">{item.label}</p>
                            <p className="text-sm text-slate-500">{item.desc}</p>
                        </div>
                        <button
                            onClick={() => toggle(item.key)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${notifications[item.key] ? "bg-blue-500" : "bg-slate-300"}`}
                            aria-label={`Toggle ${item.label}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${notifications[item.key] ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                    </div>
                ))}
            </div>

            <div className="mt-6 flex justify-end">
                <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Save Notification Settings
                </button>
            </div>
        </div>
    );
}
