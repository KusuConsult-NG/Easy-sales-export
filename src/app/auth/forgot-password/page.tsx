"use client";

import Link from "next/link";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-primary to-slate-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <div className="relative w-full max-w-md">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <Link href="/" className="flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-2xl border-2 border-white/20"
                        />
                        <div className="text-left">
                            <h2 className="text-xl font-bold text-white">{COMPANY_INFO.name}</h2>
                            <p className="text-sm text-blue-300">{COMPANY_INFO.tagline}</p>
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-white mb-2">Password Reset</h1>
                    <p className="text-blue-200">Feature coming soon</p>
                </div>

                {/* Info Card */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                    <div className="text-center space-y-4">
                        <p className="text-white">
                            Password reset functionality is currently under development.
                        </p>
                        <p className="text-blue-200 text-sm">
                            For assistance with your account, please contact our support team at{" "}
                            <a
                                href={`mailto:${COMPANY_INFO.email}`}
                                className="text-white underline hover:text-blue-300"
                            >
                                {COMPANY_INFO.email}
                            </a>
                        </p>
                    </div>

                    {/* Back Button */}
                    <Link
                        href="/auth/login"
                        className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all border border-white/20"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Login
                    </Link>
                </div>

                {/* Footer */}
                <p className="mt-8 text-center text-sm text-blue-200/60">
                    {COMPANY_INFO.copyright}
                </p>
            </div>
        </div>
    );
}
