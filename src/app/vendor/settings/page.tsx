"use client";

import { Settings, User, Bell, CreditCard } from "lucide-react";

export default function VendorSettingsPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Coming Soon Banner */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                    <div className="w-20 h-20 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Settings className="w-10 h-10 text-purple-600 dark:text-purple-400" />
                    </div>

                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                        Vendor Settings
                    </h1>

                    <div className="inline-block px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-semibold mb-6">
                        Limited in Beta
                    </div>

                    <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto mb-8">
                        Vendor profile and store configuration settings are being finalized.
                        You'll soon be able to customize your store, manage payment methods, and configure notifications.
                    </p>

                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 max-w-md mx-auto">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
                            Settings Available Soon:
                        </h3>
                        <ul className="space-y-2 text-left text-sm text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-purple-600 mt-0.5">•</span>
                                Store profile and branding customization
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-purple-600 mt-0.5">•</span>
                                Payment account setup and verification
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-purple-600 mt-0.5">•</span>
                                Notification preferences and alerts
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-purple-600 mt-0.5">•</span>
                                Shipping policies and fulfillment options
                            </li>
                        </ul>
                    </div>

                    <button
                        onClick={() => window.history.back()}
                        className="mt-8 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
