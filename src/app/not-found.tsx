'use client';

import Link from 'next/link';
import { Home, Search, ArrowLeft } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full text-center">
                {/* 404 Animation */}
                <div className="mb-8">
                    <h1 className="text-9xl font-bold text-transparent bg-clip-text bg-linear-to-r from-blue-600 to-purple-600 animate-pulse">
                        404
                    </h1>
                </div>

                {/* Message */}
                <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                    Page Not Found
                </h2>
                <p className="text-lg text-slate-600 mb-8">
                    The page you're looking for doesn't exist or has been moved.
                </p>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl"
                    >
                        <Home className="w-5 h-5" />
                        Go Home
                    </Link>
                    <button
                        onClick={() => window.history.back()}
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 border-2 border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Go Back
                    </button>
                </div>

                {/* Helpful Links */}
                <div className="mt-12 pt-8 border-t border-slate-200">
                    <p className="text-sm text-slate-500 mb-4">
                        Popular Pages:
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                        <Link href="/marketplace" className="px-4 py-2 bg-white text-slate-900 rounded-lg hover:shadow-md transition text-sm">
                            Marketplace
                        </Link>
                        <Link href="/farm-nation" className="px-4 py-2 bg-white text-slate-900 rounded-lg hover:shadow-md transition text-sm">
                            Farm Nation
                        </Link>
                        <Link href="/academy" className="px-4 py-2 bg-white text-slate-900 rounded-lg hover:shadow-md transition text-sm">
                            Academy
                        </Link>
                        <Link href="/export" className="px-4 py-2 bg-white text-slate-900 rounded-lg hover:shadow-md transition text-sm">
                            Export Windows
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
