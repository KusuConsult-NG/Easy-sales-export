"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";

export default function HubHero() {
    return (
        <div className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-linear-to-br from-primary via-primary/80 to-blue-600 dark:from-primary/90 dark:via-primary/70 dark:to-blue-700">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/10 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/10 rounded-full blur-3xl animate-pulse delay-1000" />
            </div>

            {/* Content */}
            <div className="relative z-10 max-w-6xl mx-auto px-4 text-center">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-white text-sm font-semibold mb-8 animate-[slideInDown_0.6s_ease-out]">
                    <Sparkles className="w-4 h-4" />
                    Empowering Agricultural Commerce
                </div>

                {/* Logo */}
                <div className="flex justify-center mb-8 animate-[slideInDown_0.5s_ease-out]">                    <Image
                    src="/images/logo.jpg"
                    alt="Easy Sales Export Logo"
                    width={120}
                    height={120}
                    className="rounded-full border-4 border-white/30 shadow-2xl"
                    priority
                />
                </div>

                {/* Main Title */}
                <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 animate-[slideInUp_0.8s_ease-out]">
                    Easy Sales Export
                </h1>

                {/* Subtitle */}
                <p className="text-xl md:text-2xl text-white/90 mb-12 max-w-3xl mx-auto animate-[slideInUp_0.8s_ease-out_0.2s_both]">
                    Your complete platform for agricultural exports, marketplace trading,
                    land investment, education, and financial empowerment
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center animate-[slideInUp_0.8s_ease-out_0.4s_both]">
                    <Link
                        href="/marketplace"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-primary font-bold rounded-xl hover:bg-slate-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
                    >
                        Explore Marketplace
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <Link
                        href="/academy"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-bold rounded-xl hover:bg-white/20 transition-all border-2 border-white/30"
                    >
                        Start Learning
                    </Link>
                </div>
            </div>
        </div>
    );
}
