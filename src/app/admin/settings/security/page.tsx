"use client";

import { useState, useEffect } from "react";
import { Shield, Key, Clock, Save, Loader2, Lock, AlertTriangle, Database, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import { runServiceRegistrationRecoveryAction } from "@/app/actions/data-recovery";

interface SecuritySettings {
    sessionDurationDays: number;
    idleTimeoutHours: number;
    enforceMfa: boolean;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
}

const DEFAULTS: SecuritySettings = {
    sessionDurationDays: 30,
    idleTimeoutHours: 24,
    enforceMfa: true,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 30,
};

export default function SecuritySettingsPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [settings, setSettings] = useState<SecuritySettings>(DEFAULTS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [recoveryStats, setRecoveryStats] = useState<any>(null);
    const isSuperAdmin = session?.user?.roles?.includes("super_admin");

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/admin/settings/security");
                const data = await res.json();
                if (data.success && data.settings) setSettings(data.settings);
            } catch {
                // Use defaults if fetch fails
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    async function handleSave() {
        setIsSaving(true);
        try {
            const res = await fetch("/api/admin/settings/security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            });
            const data = await res.json();
            if (data.success) {
                showToast("Security settings saved", "success");
            } else {
                showToast(data.error || "Failed to save settings", "error");
            }
        } catch {
            showToast("Failed to save settings", "error");
        } finally {
            setIsSaving(false);
        }
    };

    async function handleRunRecovery() {
        if (!confirm("Are you sure you want to run the Data Integrity Recovery? This will scan all users and backfill missing registration data.")) return;
        
        setIsRecovering(true);
        try {
            const result = await runServiceRegistrationRecoveryAction();
            if (result.success) {
                setRecoveryStats(result.stats);
                showToast(`Data recovery complete: ${result.stats.fixedCount} users fixed.`, "success");
            } else {
                showToast(result.stats?.errors?.[0] || "Recovery failed", "error");
            }
        } catch (error: any) {
            showToast(error.message || "An unexpected error occurred", "error");
        } finally {
            setIsRecovering(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-4xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Security &amp; Access</h1>
                    <p className="text-slate-600">Manage admin roles, 2FA enforcement, and session controls</p>
                </div>
                {isSuperAdmin && (
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                )}
            </div>

            {!isSuperAdmin && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    <p className="text-sm text-amber-800">Only <strong>Super Admins</strong> can modify these settings. You are in view-only mode.</p>
                </div>
            )}

            <div className="space-y-6">
                {/* RBAC */}
                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                            <Shield className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-900 mb-1">Role-Based Access Control</h3>
                            <p className="text-sm text-slate-500 mb-4">13 roles configured across the platform</p>
                            <div className="flex flex-wrap gap-2">
                                {["general_user", "buyer", "seller", "farmer", "land_owner", "investor",
                                    "export_participant", "cooperative_member", "wave_participant",
                                    "academy_participant", "field_officer", "admin", "super_admin"].map(role => (
                                        <span key={role} className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded-full">
                                            {role.replace(/_/g, " ")}
                                        </span>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* MFA */}
                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                            <Key className="w-6 h-6 text-amber-600" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="font-bold text-slate-900">Two-Factor Authentication</h3>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={settings.enforceMfa}
                                        disabled={!isSuperAdmin}
                                        onChange={e => setSettings(s => ({ ...s, enforceMfa: e.target.checked }))}
                                    />
                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 peer-disabled:opacity-50"></div>
                                </label>
                            </div>
                            {/*
                              * This said "MFA is enforced for all admin accounts"
                              * whenever the toggle was on — and the toggle
                              * defaults to on.
                              *
                              * Nothing enforces MFA. src/middleware.ts has no MFA
                              * logic, the mfa_verified cookie is read by nothing,
                              * and requiresMFA() — which names withdrawal, loan
                              * approval and role change — has no callers. See
                              * the audit in mfa-not-enforced.test.ts.
                              *
                              * So the security settings screen was telling the
                              * person responsible for the platform's security
                              * that a control existed, in the place they would
                              * go to check. The preference is still recorded and
                              * is what enforcement should read when it is built;
                              * the copy now says which of those two things is
                              * true today.
                              */}
                            <p className="text-sm text-slate-500">
                                {settings.enforceMfa
                                    ? "Preference saved: require MFA for admin accounts."
                                    : "Preference saved: MFA optional for admin accounts."}
                            </p>
                            <p className="text-sm text-amber-700 mt-1">
                                Not yet enforced — this preference is recorded but no sign-in
                                currently requires a second factor.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Session Management */}
                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                            <Clock className="w-6 h-6 text-purple-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-900 mb-4">Session Management</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Session Duration (days)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={settings.sessionDurationDays}
                                        disabled={!isSuperAdmin}
                                        onChange={e => setSettings(s => ({ ...s, sessionDurationDays: Number(e.target.value) }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Idle Timeout (hours)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={168}
                                        value={settings.idleTimeoutHours}
                                        disabled={!isSuperAdmin}
                                        onChange={e => setSettings(s => ({ ...s, idleTimeoutHours: Number(e.target.value) }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Login Lockout */}
                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                            <Lock className="w-6 h-6 text-red-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-900 mb-4">Login Protection</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Max Login Attempts</label>
                                    <input
                                        type="number"
                                        min={3}
                                        max={20}
                                        value={settings.maxLoginAttempts}
                                        disabled={!isSuperAdmin}
                                        onChange={e => setSettings(s => ({ ...s, maxLoginAttempts: Number(e.target.value) }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Lockout Duration (minutes)</label>
                                    <input
                                        type="number"
                                        min={5}
                                        max={1440}
                                        value={settings.lockoutDurationMinutes}
                                        disabled={!isSuperAdmin}
                                        onChange={e => setSettings(s => ({ ...s, lockoutDurationMinutes: Number(e.target.value) }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Data Integrity & Recovery */}
            <div className="bg-white rounded-2xl shadow-sm p-6 mt-6 border-t-4 border-blue-600">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                        <Database className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-slate-900">Data Integrity & Recovery</h3>
                            {isSuperAdmin && (
                                <button
                                    onClick={handleRunRecovery}
                                    disabled={isRecovering}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition"
                                >
                                    {isRecovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                    Run Integrity Audit
                                </button>
                            )}
                        </div>
                        <p className="text-sm text-slate-500 mb-4">
                            Scans the database for corrupted module registrations caused by destructive writes. Reconstructs missing data from authoritative collections.
                        </p>

                        {recoveryStats && (
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                <div className="flex items-center gap-2 text-green-600 font-semibold mb-3">
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>Last Audit Results</span>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Users Scanned</p>
                                        <p className="text-xl font-bold text-slate-900">{recoveryStats.totalUsersProcessed}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Issues Found</p>
                                        <p className="text-xl font-bold text-slate-900">{recoveryStats.corruptedFound}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Users Fixed</p>
                                        <p className="text-xl font-bold text-green-600">{recoveryStats.fixedCount}</p>
                                    </div>
                                </div>
                                {recoveryStats.errors?.length > 0 && (
                                    <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-100">
                                        <p className="text-xs text-red-600 font-semibold mb-1">Errors Encountered:</p>
                                        <ul className="text-[10px] text-red-500 list-disc list-inside space-y-1">
                                            {recoveryStats.errors.slice(0, 3).map((err: string, i: number) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                            {recoveryStats.errors.length > 3 && <li>And {recoveryStats.errors.length - 3} more...</li>}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
