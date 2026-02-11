/**
 * Farm Nation Dashboard
 */

import { Metadata } from "next";
import {
    LayoutDashboard,
    Sprout,
    MapPin,
    TrendingUp,
    ArrowRight
} from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
    title: "Dashboard | Farm Nation",
    description: "Manage your farm investments and properties",
};

export default async function FarmNationDashboard() {
    const session = await auth();
    const user = session?.user;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Welcome back, {user?.name?.split(" ")[0] || "Partner"}!
            </h1>

            <p className="text-slate-600 dark:text-slate-400">
                Manage your land acquisitions and track your agricultural investments.
            </p>

            {/* Quick Stats Placeholder */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                            <Sprout className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 font-medium">Total Land</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">0 Hectares</h3>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                            <MapPin className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 font-medium">Active Properties</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">0 Sites</h3>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 font-medium">Portfolio Value</p>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">₦0.00</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-8 mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                <Link href="/farm-nation/list-land" className="group p-4 bg-emerald-600 text-white rounded-xl flex items-center justify-between hover:bg-emerald-700 transition">
                    <span className="font-semibold">List New Property</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link href="/farm-nation/properties" className="group p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                    <span className="font-semibold text-slate-700 dark:text-white">Browse Listings</span>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition-transform" />
                </Link>
            </div>
        </div>
    );
}
