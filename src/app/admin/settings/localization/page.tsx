"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Globe, Save, Loader2, CheckCircle, AlertTriangle,
    Languages, DollarSign, Clock, Calendar,
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Language {
    code: string;
    name: string;
    nativeName: string;
    enabled: boolean;
    primary: boolean;
}

interface Currency {
    code: string;
    name: string;
    symbol: string;
    enabled: boolean;
    primary: boolean;
}

interface LocalizationSettings {
    defaultLanguage: string;
    defaultCurrency: string;
    languages: Language[];
    currencies: Currency[];
    timezone: string;
    dateFormat: string;
    timeFormat: "12h" | "24h";
}

// ─── Defaults (mirrored from API) ─────────────────────────────────────────────
const DEFAULT_SETTINGS: LocalizationSettings = {
    defaultLanguage: "en",
    defaultCurrency: "NGN",
    languages: [
        { code: "en", name: "English", nativeName: "English",  enabled: true,  primary: true  },
        { code: "ha", name: "Hausa",   nativeName: "Hausa",    enabled: true,  primary: false },
        { code: "yo", name: "Yoruba",  nativeName: "Yorùbá",   enabled: false, primary: false },
        { code: "ig", name: "Igbo",    nativeName: "Igbo",     enabled: false, primary: false },
        { code: "fr", name: "French",  nativeName: "Français",  enabled: false, primary: false },
    ],
    currencies: [
        { code: "NGN", name: "Nigerian Naira",  symbol: "₦",   enabled: true,  primary: true  },
        { code: "USD", name: "US Dollar",       symbol: "$",   enabled: true,  primary: false },
        { code: "GBP", name: "British Pound",   symbol: "£",   enabled: true,  primary: false },
        { code: "EUR", name: "Euro",            symbol: "€",   enabled: false, primary: false },
        { code: "GHS", name: "Ghanaian Cedi",   symbol: "₵",   enabled: false, primary: false },
        { code: "KES", name: "Kenyan Shilling", symbol: "KSh", enabled: false, primary: false },
    ],
    timezone: "Africa/Lagos",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
};

const TIMEZONES = [
    { value: "Africa/Lagos",      label: "Africa/Lagos (WAT, UTC+1)" },
    { value: "Africa/Accra",      label: "Africa/Accra (GMT, UTC+0)" },
    { value: "Africa/Nairobi",    label: "Africa/Nairobi (EAT, UTC+3)" },
    { value: "Africa/Cairo",      label: "Africa/Cairo (EET, UTC+2)" },
    { value: "Europe/London",     label: "Europe/London (GMT/BST)" },
    { value: "Europe/Paris",      label: "Europe/Paris (CET/CEST)" },
    { value: "America/New_York",  label: "America/New_York (ET)" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
    { value: "UTC",               label: "UTC (Universal)" },
];

const DATE_FORMATS = [
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY  (14/03/2025)" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY  (03/14/2025)" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD  (2025-03-14)" },
    { value: "DD MMM YYYY", label: "DD MMM YYYY (14 Mar 2025)" },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function LocalizationSettingsPage() {
    const { showToast } = useToast();
    const [settings, setSettings] = useState<LocalizationSettings>(DEFAULT_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // ── Load from API ──────────────────────────────────────────────────────
    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/settings/localization");
            const data = await res.json();
            if (data.success && data.settings) {
                setSettings(data.settings);
            }
        } catch {
            // Fall back to defaults silently
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ── Helpers to mutate state while tracking dirty flag ─────────────────
    const mutate = (updater: (prev: LocalizationSettings) => LocalizationSettings) => {
        setSettings(updater);
        setIsDirty(true);
    };

    const toggleLanguage = (code: string) => {
        mutate(prev => {
            // Don't allow disabling the default language
            if (code === prev.defaultLanguage) {
                showToast("Cannot disable the default language. Change the default first.", "error");
                return prev;
            }
            return {
                ...prev,
                languages: prev.languages.map(l =>
                    l.code === code ? { ...l, enabled: !l.enabled } : l
                ),
            };
        });
    };

    const setDefaultLanguage = (code: string) => {
        mutate(prev => ({
            ...prev,
            defaultLanguage: code,
            languages: prev.languages.map(l => ({
                ...l,
                enabled: l.code === code ? true : l.enabled, // auto-enable if set as default
                primary: l.code === code,
            })),
        }));
    };

    const toggleCurrency = (code: string) => {
        mutate(prev => {
            if (code === prev.defaultCurrency) {
                showToast("Cannot disable the default currency. Change the default first.", "error");
                return prev;
            }
            return {
                ...prev,
                currencies: prev.currencies.map(c =>
                    c.code === code ? { ...c, enabled: !c.enabled } : c
                ),
            };
        });
    };

    const setDefaultCurrency = (code: string) => {
        mutate(prev => ({
            ...prev,
            defaultCurrency: code,
            currencies: prev.currencies.map(c => ({
                ...c,
                enabled: c.code === code ? true : c.enabled,
                primary: c.code === code,
            })),
        }));
    };

    // ── Save ──────────────────────────────────────────────────────────────
    async function handleSave() {
        setIsSaving(true);
        try {
            const res = await fetch("/api/admin/settings/localization", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            });
            const data = await res.json();
            if (data.success) {
                showToast("Localization settings saved", "success");
                setIsDirty(false);
            } else {
                showToast(data.error || "Failed to save settings", "error");
            }
        } catch {
            showToast("An unexpected error occurred", "error");
        } finally {
            setIsSaving(false);
        }
    };

    // ── Derived ───────────────────────────────────────────────────────────
    const enabledLangs = settings.languages.filter(l => l.enabled).length;
    const enabledCurrs = settings.currencies.filter(c => c.enabled).length;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-4xl">
            {/* ── Header ── */}
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>

            <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
                        <Globe className="w-7 h-7 text-green-600" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Localization</h1>
                        <p className="text-slate-500 text-sm mt-0.5">
                            Configure supported languages, currencies, and regional formats
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleSave}
                    disabled={isSaving || !isDirty}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        : <><Save className="w-4 h-4" /> Save Changes</>
                    }
                </button>
            </div>

            {/* Unsaved changes banner */}
            {isDirty && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-amber-800 font-medium">You have unsaved changes.</span>
                </div>
            )}

            <div className="space-y-6">
                {/* ── Languages ── */}
                <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
                        <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                            <Languages className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <h2 className="font-bold text-slate-900">Languages</h2>
                            <p className="text-xs text-slate-500">{enabledLangs} of {settings.languages.length} enabled</p>
                        </div>
                        <div className="text-xs text-slate-400">
                            <span className="font-semibold text-slate-600">Default: </span>
                            {settings.languages.find(l => l.code === settings.defaultLanguage)?.name}
                        </div>
                    </div>

                    <div className="divide-y divide-slate-50">
                        {settings.languages.map(lang => {
                            const isDefault = lang.code === settings.defaultLanguage;
                            return (
                                <div key={lang.code} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/60 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm border ${
                                            lang.enabled ? "bg-blue-100 border-blue-200 text-blue-700" : "bg-slate-100 border-slate-200 text-slate-400"
                                        }`}>
                                            {lang.code.toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-medium text-slate-900 text-sm">{lang.name}</p>
                                            <p className="text-xs text-slate-400">{lang.nativeName}</p>
                                        </div>
                                        {isDefault && (
                                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold uppercase tracking-wide rounded-full">
                                                Default
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {/* Set as default */}
                                        {!isDefault && lang.enabled && (
                                            <button
                                                onClick={() => setDefaultLanguage(lang.code)}
                                                className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                                            >
                                                Set default
                                            </button>
                                        )}

                                        {/* Toggle */}
                                        <button
                                            onClick={() => toggleLanguage(lang.code)}
                                            aria-label={`Toggle ${lang.name}`}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                                                lang.enabled ? "bg-blue-500" : "bg-slate-200"
                                            } ${isDefault ? "opacity-50 cursor-not-allowed" : ""}`}
                                            disabled={isDefault}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                                lang.enabled ? "translate-x-6" : "translate-x-1"
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ── Currencies ── */}
                <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
                        <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
                            <DollarSign className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="flex-1">
                            <h2 className="font-bold text-slate-900">Currencies</h2>
                            <p className="text-xs text-slate-500">{enabledCurrs} of {settings.currencies.length} enabled</p>
                        </div>
                        <div className="text-xs text-slate-400">
                            <span className="font-semibold text-slate-600">Default: </span>
                            {settings.currencies.find(c => c.code === settings.defaultCurrency)?.code} {settings.currencies.find(c => c.code === settings.defaultCurrency)?.symbol}
                        </div>
                    </div>

                    <div className="divide-y divide-slate-50">
                        {settings.currencies.map(curr => {
                            const isDefault = curr.code === settings.defaultCurrency;
                            return (
                                <div key={curr.code} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/60 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-base border ${
                                            curr.enabled ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200 text-slate-400"
                                        }`}>
                                            {curr.symbol}
                                        </div>
                                        <div>
                                            <p className="font-medium text-slate-900 text-sm">{curr.name}</p>
                                            <p className="text-xs text-slate-400 font-mono">{curr.code}</p>
                                        </div>
                                        {isDefault && (
                                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold uppercase tracking-wide rounded-full">
                                                Default
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {!isDefault && curr.enabled && (
                                            <button
                                                onClick={() => setDefaultCurrency(curr.code)}
                                                className="text-xs text-amber-600 hover:text-amber-700 font-medium px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors"
                                            >
                                                Set default
                                            </button>
                                        )}

                                        <button
                                            onClick={() => toggleCurrency(curr.code)}
                                            aria-label={`Toggle ${curr.name}`}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                                                curr.enabled ? "bg-amber-500" : "bg-slate-200"
                                            } ${isDefault ? "opacity-50 cursor-not-allowed" : ""}`}
                                            disabled={isDefault}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                                curr.enabled ? "translate-x-6" : "translate-x-1"
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ── Date, Time & Timezone ── */}
                <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
                        <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
                            <Calendar className="w-4 h-4 text-purple-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-900">Regional Formats</h2>
                            <p className="text-xs text-slate-500">Timezone, date and time display preferences</p>
                        </div>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Timezone */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                Timezone
                            </label>
                            <select
                                value={settings.timezone}
                                onChange={e => mutate(prev => ({ ...prev, timezone: e.target.value }))}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none appearance-none bg-white"
                            >
                                {TIMEZONES.map(tz => (
                                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Date Format */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                Date Format
                            </label>
                            <select
                                value={settings.dateFormat}
                                onChange={e => mutate(prev => ({ ...prev, dateFormat: e.target.value }))}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none appearance-none bg-white"
                            >
                                {DATE_FORMATS.map(fmt => (
                                    <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Time Format */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                Time Format
                            </label>
                            <div className="flex gap-3">
                                {(["12h", "24h"] as const).map(fmt => (
                                    <button
                                        key={fmt}
                                        onClick={() => mutate(prev => ({ ...prev, timeFormat: fmt }))}
                                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                                            settings.timeFormat === fmt
                                                ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                                                : "bg-white text-slate-600 border-slate-200 hover:border-purple-300"
                                        }`}
                                    >
                                        {fmt}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                                {settings.timeFormat === "12h" ? "e.g. 2:30 PM" : "e.g. 14:30"}
                            </p>
                        </div>
                    </div>

                    {/* Live preview */}
                    <div className="mx-6 mb-6 bg-slate-50 rounded-xl p-4 flex items-center gap-3">
                        <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="text-sm text-slate-600">
                            <span className="font-medium">Preview: </span>
                            {(() => {
                                const now = new Date();
                                const parts = {
                                    DD: String(now.getDate()).padStart(2, "0"),
                                    MM: String(now.getMonth() + 1).padStart(2, "0"),
                                    YYYY: String(now.getFullYear()),
                                    MMM: now.toLocaleString("en", { month: "short" }),
                                };
                                const date = settings.dateFormat
                                    .replace("DD", parts.DD)
                                    .replace("MMM", parts.MMM)
                                    .replace("MM", parts.MM)
                                    .replace("YYYY", parts.YYYY);
                                const hours = now.getHours();
                                const mins = String(now.getMinutes()).padStart(2, "0");
                                const time = settings.timeFormat === "12h"
                                    ? `${((hours % 12) || 12)}:${mins} ${hours >= 12 ? "PM" : "AM"}`
                                    : `${String(hours).padStart(2, "0")}:${mins}`;
                                return `${date} · ${time} (${settings.timezone})`;
                            })()}
                        </div>
                    </div>
                </section>

                {/* ── Summary card ── */}
                <section className="bg-linear-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5 flex items-start gap-4">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-semibold text-green-800 mb-1">Configuration Summary</p>
                        <p className="text-green-700">
                            <strong>{enabledLangs}</strong> language{enabledLangs !== 1 ? "s" : ""} ·{" "}
                            <strong>{enabledCurrs}</strong> currenc{enabledCurrs !== 1 ? "ies" : "y"} ·{" "}
                            Default <strong>{settings.languages.find(l => l.code === settings.defaultLanguage)?.name}</strong> /{" "}
                            <strong>{settings.defaultCurrency}</strong> · {settings.timezone}
                        </p>
                    </div>
                </section>
            </div>

            {/* Footer save */}
            <div className="mt-8 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={isSaving || !isDirty}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        : <><Save className="w-4 h-4" /> Save Localization Settings</>
                    }
                </button>
            </div>
        </div>
    );
}
