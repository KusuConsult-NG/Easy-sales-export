"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";

export default function HubHero() {
    // Hero background image slider - lazy load most images
    const heroImages = [
        "/images/hub/photo_2026-02-14 15.20.02.jpeg",
        "/images/hub/photo_2026-02-14 15.20.11.jpeg",
        // Picture 3 removed per user request
        "/images/hub/photo_2026-02-14 15.20.27.jpeg",
        "/images/hub/photo_2026-02-14 15.20.37.jpeg",
        "/images/hub/photo_2026-02-14 15.20.45.jpeg",
        "/images/hub/photo_2026-02-14 15.21.06.jpeg",
        "/images/hub/photo_2026-02-14 15.21.14.jpeg",
        "/images/hub/photo_2026-02-14 15.21.28.jpeg",
        "/images/hub/photo_2026-02-14 15.21.33.jpeg",
        "/images/hub/photo_2026-02-14 15.21.49.jpeg",
    ];
    const [currentHeroImage, setCurrentHeroImage] = useState(0);
    const [loadedImages, setLoadedImages] = useState(2); // Only load first 2 initially

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentHeroImage((prev) => (prev + 1) % heroImages.length);
        }, 8000);
        return () => clearInterval(timer);
    }, [heroImages.length]);

    // Lazy load remaining images after mount
    useEffect(() => {
        const loadTimer = setTimeout(() => {
            setLoadedImages(heroImages.length);
        }, 2000); // Load rest after 2 seconds
        return () => clearTimeout(loadTimer);
    }, [heroImages.length]);

    return (
        <div className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-linear-to-br from-primary via-primary/80 to-blue-600">
            {/* Background Image Slider */}
            <div className="absolute inset-0 overflow-hidden">
                {heroImages.map((img, index) => {
                    // Smart Lazy Loading: Only render current, next, and previous images
                    const isNext = index === (currentHeroImage + 1) % heroImages.length;
                    const isPrev = index === (currentHeroImage - 1 + heroImages.length) % heroImages.length;
                    const isCurrent = index === currentHeroImage;
                    const shouldLoad = isCurrent || isNext || isPrev;

                    if (!shouldLoad) return null;

                    return (
                        <div
                            key={index}
                            className={`absolute inset-0 transition-opacity duration-2000 ${index === currentHeroImage ? "opacity-20" : "opacity-0"
                                }`}
                        >
                            <Image
                                src={img}
                                alt="Hub Background"
                                fill
                                className="object-cover"
                                priority={index === 0}
                                loading={index === 0 ? "eager" : "lazy"}
                                sizes="100vw"
                                quality={75}
                            />
                        </div>
                    );
                })}
                {/* Animated overlay elements - Removed animate-pulse for performance */}
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/10 rounded-full blur-3xl opacity-50" />
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
                    className="rounded-full border-4 border-white/30 shadow-2xl object-cover"
                    priority
                />
                </div>

                {/* Main Title */}
                <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 animate-[slideInUp_0.8s_ease-out]">
                    Easy Sales Export
                </h1>

                {/* Subtitle */}
                <p className="text-xl md:text-2xl text-white/90 mb-12 max-w-3xl mx-auto animate-[slideInUp_0.8s_ease-out_0.2s_both]">
                    Powering Nigeria's Agro Trade, Export & Farm Investment
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center animate-[slideInUp_0.8s_ease-out_0.4s_both]">
                    <Link
                        href="/marketplace"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-primary font-bold rounded-xl hover:bg-slate-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
                    >
                        Start Trading Agro Products
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <Link
                        href="/academy"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-bold rounded-xl hover:bg-white/20 transition-all border-2 border-white/30"
                    >
                        Learn Export and Agro Business
                    </Link>
                </div>
            </div>
        </div>
    );
}
