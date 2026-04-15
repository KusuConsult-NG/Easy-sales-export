"use client";

import { useState, useEffect } from "react";
import { Settings, Save, Loader2 } from "lucide-react";
import Link from "next/link";
import { savePlatformSettingsAction, getPlatformSettingsAction } from "@/app/actions/admin";
import { toast } from "sonner";

export default function GeneralSettingsPage() {
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState({
        platformName: "Easy Sales Export",
        supportEmail: "support@easysalesexport.com",
        contactPhone: "+234 000 000 0000",
        defaultCurrency: "NGN",
        maintenanceMode: false,
    });

    useEffect(() => {
        getPlatformSettingsAction().then((data) => {
            setSettings(data);
            setLoading(false);
        });
    }, []);

    async function handleSave() {
        setSaving(true);
        const result = await savePlatformSettingsAction(settings);
        setSaving(false);
        if (result.success) {
            toast.success("Settings saved successfully");
        } else {
            toast.error(result.error || "Failed to save settings");
        }
    };

    return (
        <div className="p-8 max-w-3xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">General Configuration</h1>
            <p className="text-slate-600 mb-8">Platform name, contacts, and global settings</p>

            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Platform Name</label>
                    <input type="text" value={settings.platformName}
                        onChange={e => setSettings({ ...settings, platformName: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Support Email</label>
                    <input type="email" value={settings.supportEmail}
                        onChange={e => setSettings({ ...settings, supportEmail: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Contact Phone</label>
                    <input type="tel" value={settings.contactPhone}
                        onChange={e => setSettings({ ...settings, contactPhone: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Default Currency</label>
                    <select value={settings.defaultCurrency}
                        onChange={e => setSettings({ ...settings, defaultCurrency: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                        <option value="NGN">Nigerian Naira (₦)</option>
                        <option value="USD">US Dollar ($)</option>
                        <option value="GBP">British Pound (£)</option>
                    </select>
                </div>
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl">
                    <div>
                        <p className="font-medium text-slate-900">Maintenance Mode</p>
                        <p className="text-sm text-slate-500">Temporarily disable public access</p>
                    </div>
                    <button onClick={() => setSettings({ ...settings, maintenanceMode: !settings.maintenanceMode })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${settings.maintenanceMode ? "bg-red-500" : "bg-slate-300"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings.maintenanceMode ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                </div>
                <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </div>
        </div>
    );
}
