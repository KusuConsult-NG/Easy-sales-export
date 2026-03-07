"use client";

import { Globe } from "lucide-react";
import Link from "next/link";

export default function LocalizationSettingsPage() {
    return (
        <div className="p-8 max-w-3xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Localization</h1>
            <p className="text-slate-600 mb-8">Manage supported languages and currencies</p>

            <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <h3 className="font-bold text-slate-900 mb-4">Supported Languages</h3>
                    <div className="space-y-3">
                        {[
                            { code: "en", name: "English", status: "Primary" },
                            { code: "ha", name: "Hausa", status: "Available" },
                        ].map(lang => (
                            <div key={lang.code} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                                <div className="flex items-center gap-3">
                                    <span className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center text-xs font-bold uppercase">{lang.code}</span>
                                    <span className="font-medium text-slate-900">{lang.name}</span>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${lang.status === "Primary" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{lang.status}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-6">
                    <h3 className="font-bold text-slate-900 mb-4">Supported Currencies</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { symbol: "₦", name: "Nigerian Naira", code: "NGN", primary: true },
                            { symbol: "$", name: "US Dollar", code: "USD", primary: false },
                            { symbol: "£", name: "British Pound", code: "GBP", primary: false },
                            { symbol: "€", name: "Euro", code: "EUR", primary: false },
                        ].map(c => (
                            <div key={c.code} className={`p-4 rounded-xl border ${c.primary ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                                <span className="text-2xl font-bold text-slate-900">{c.symbol}</span>
                                <p className="font-medium text-slate-900 mt-1">{c.name}</p>
                                <p className="text-xs text-slate-500">{c.code}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
