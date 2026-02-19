"use client";

import { Shield, Key, Clock } from "lucide-react";
import Link from "next/link";

export default function SecuritySettingsPage() {
    return (
        <div className="p-8 max-w-4xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Security & Access</h1>
            <p className="text-slate-600 mb-8">Manage admin roles, 2FA enforcement, and sessions</p>

            <div className="space-y-6">
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

                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                            <Key className="w-6 h-6 text-amber-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-900 mb-1">Two-Factor Authentication</h3>
                            <p className="text-sm text-slate-500 mb-4">MFA is enforced for all admin accounts</p>
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">ENFORCED</span>
                                <span className="text-sm text-slate-500">All admin users require 2FA to access the portal</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                            <Clock className="w-6 h-6 text-purple-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-900 mb-1">Session Management</h3>
                            <p className="text-sm text-slate-500 mb-4">Controls session duration and idle timeout</p>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs text-slate-500 mb-1">Session Duration</p>
                                    <p className="text-lg font-bold text-slate-900">30 days</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs text-slate-500 mb-1">Idle Timeout</p>
                                    <p className="text-lg font-bold text-slate-900">24 hours</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
