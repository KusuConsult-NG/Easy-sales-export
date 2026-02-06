"use client";

import { FileText, Package, Clock } from "lucide-react";

export default function VendorOrdersPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Coming Soon Banner */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                    <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <FileText className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                    </div>

                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                        Order Management
                    </h1>

                    <div className="inline-block px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-semibold mb-6">
                        Limited in Beta
                    </div>

                    <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto mb-8">
                        Order tracking and fulfillment tools are under development.
                        You'll be able to manage pending orders, track shipments, and update order statuses soon.
                    </p>

                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 max-w-md mx-auto">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
                            Upcoming Features:
                        </h3>
                        <ul className="space-y-2 text-left text-sm text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-600 mt-0.5">•</span>
                                View and manage all incoming orders
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-600 mt-0.5">•</span>
                                Update order statuses (processing, shipped, delivered)
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-600 mt-0.5">•</span>
                                Print shipping labels and invoices
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-600 mt-0.5">•</span>
                                Communicate directly with buyers
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
