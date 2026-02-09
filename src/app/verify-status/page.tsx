"use client";

import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { ShieldAlert, CheckCircle, LogOut } from "lucide-react";


// We'll use next-auth signOut for simplicity if a client action isn't readily available, 
// but based on previous files, let's stick to standard patterns.
import { signOut } from "next-auth/react";

export default function VerifyStatusPage() {
    const { data: session } = useSession();

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldAlert className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Verification Pending
                    </h1>

                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Hello <span className="font-semibold text-slate-900 dark:text-white">{session?.user?.name}</span>,
                    </p>

                    <p className="text-slate-600 dark:text-slate-400 mb-8">
                        Your account is currently under review by our administrators.
                        You will receive an email once your verification is complete.
                        <br /><br />
                        Please check back later.
                    </p>

                    <div className="space-y-3">
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                        >
                            <CheckCircle className="w-4 h-4" />
                            Check Status
                        </button>

                        <button
                            onClick={() => signOut({ callbackUrl: "/auth/login" })}
                            className="w-full py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center justify-center gap-2"
                        >
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-500">
                        Need help? <Link href="/contact" className="text-blue-600 hover:underline">Contact Support</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
