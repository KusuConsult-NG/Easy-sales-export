/**
 * RH-WAVE 774 Public Landing Page
 * 
 * Single-page website for Women Agro-Value Expansion Programme
 */

"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Users, TrendingUp, Globe, Shield, Sparkles, CheckCircle, ChevronLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function WaveLandingPage() {
    // Image Slider State
    const images = [
        "/wave/3L8A9873.jpg",
        "/wave/3L8A9713.jpg",
        "/wave/3L8A9720.jpg",
        "/wave/3L8A9721.jpg",
        "/wave/3L8A9765.jpg",
        "/wave/3L8A9807.jpg",
        "/wave/8866221.jpg",
        "/wave/96a35f41-fce4-48e0-81f4-2206e03d5d32.png",
        "/wave/P1359762.jpg",
        "/wave/P1359776.jpg",
        "/wave/photo_2026-02-04_04-02-12.jpg",
    ];

    const [currentImage, setCurrentImage] = useState(0);

    // Auto-play carousel
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentImage((prev) => (prev + 1) % images.length);
        }, 5000); // Change image every 5 seconds

        return () => clearInterval(timer);
    }, [images.length]);

    const nextImage = () => {
        setCurrentImage((prev) => (prev + 1) % images.length);
    };

    const prevImage = () => {
        setCurrentImage((prev) => (prev - 1 + images.length) % images.length);
    };

    return (
        <div className="min-h-screen">
            {/* Home Navigation Button */}
            <Link
                href="/"
                className="fixed top-6 left-6 z-50 flex items-center gap-2 bg-white dark:bg-slate-900 dark:bg-slate-900 text-slate-900 dark:text-white dark:text-white px-4 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-slate-200 dark:border-slate-700"
            >
                <Home className="w-4 h-4" />
                <span className="font-semibold text-sm">Home</span>
            </Link>

            {/* Login Button (Fixed Top-Right) */}
            <Link
                href="/wave/login"
                className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-white dark:bg-slate-900 dark:bg-slate-900 text-green-700 dark:text-green-400 px-6 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-green-200 dark:border-green-800 font-bold"
            >
                <span>Login</span>
            </Link>

            {/* Hero Section with Carousel */}
            <section className="relative min-h-screen flex items-center justify-center bg-linear-to-br from-green-50 dark:from-slate-900 via-white to-green-100 overflow-hidden">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-5">
                    <div className="absolute inset-0" style={{
                        backgroundImage: `radial-gradient(circle at 2px 2px, #10b981 1px, transparent 0)`,
                        backgroundSize: '40px 40px'
                    }} />
                </div>

                <div className="relative max-w-7xl mx-auto px-6 py-20 text-center">
                    {/* Presidential Badge */}
                    <div className="inline-flex items-center gap-2 bg-linear-to-r from-green-700 via-green-600 to-green-500 text-white px-6 py-2 rounded-full text-sm font-semibold mb-8 shadow-lg">
                        <Shield className="w-4 h-4" />
                        <span>Presidential Mandate • Renewed Hope Agenda</span>
                    </div>

                    {/* Main Headline */}
                    <h1 className="text-5xl md:text-7xl font-bold text-slate-900 dark:text-white mb-6 leading-tight">
                        RH-WAVE 774
                    </h1>
                    <h2 className="text-3xl md:text-5xl font-bold bg-linear-to-r from-green-700 via-green-600 to-green-500 bg-clip-text text-transparent mb-6">
                        Women Agro-Value Expansion Program
                    </h2>

                    {/* Subheadline */}
                    <p className="text-xl md:text-2xl text-slate-900 dark:text-white max-w-4xl mx-auto mb-12">
                        A National Movement. A Presidential Mandate. <br />
                        <span className="font-semibold text-green-700">A Women-Led Revolution in Agribusiness.</span>
                    </p>

                    {/* CTA Button */}
                    <Link
                        href="/wave/application"
                        className="inline-flex items-center gap-3 bg-linear-to-r from-green-700 via-green-600 to-green-500 text-white px-10 py-5 rounded-xl text-lg font-bold shadow-2xl hover:shadow-green-500/50 transition-all hover:scale-105"
                    >
                        <span>Apply Now</span>
                        <ArrowRight className="w-6 h-6" />
                    </Link>                </div>

            </section>

            {/* WAVE Program Video - Strategic Placement */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-full text-base font-bold mb-6 shadow-lg">
                            <Sparkles className="w-5 h-5" />
                            <span>See RH-WAVE 774 in Action</span>
                        </div>
                        <h3 className="text-3xl md:text-4xl font-bold text-green-700 dark:text-green-400 mb-3">
                            Transforming Lives Through Agribusiness Excellence
                        </h3>
                        <p className="text-lg text-slate-900 dark:text-white max-w-3xl mx-auto">
                            Watch how the Women Agro-Value Expansion Programme is empowering Nigerian women to become leaders in agriculture and export
                        </p>
                    </div>

                    {/* YouTube Video Embed */}
                    <div className="relative aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-green-100 bg-slate-900">
                        <iframe
                            className="absolute inset-0 w-full h-full"
                            src="https://www.youtube.com/embed/pijwn6DGhbQ?si=7BtMi-m3l9-zcJ8W"
                            title="RH-WAVE 774 Program - Women Agro-Value Expansion"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        />
                    </div>

                    {/* CTA Below Video */}
                    <div className="text-center mt-8">
                        <p className="text-lg text-slate-900 dark:text-white mb-4">
                            Ready to be part of this transformation?
                        </p>
                        <Link
                            href="/wave/application"
                            className="inline-flex items-center gap-3 bg-linear-to-r from-green-700 via-green-600 to-green-500 text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl hover:shadow-green-500/50 transition-all hover:scale-105"
                        >
                            <Users className="w-5 h-5" />
                            <span>Join the Movement</span>
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Image Carousel Section */}
            <section className="py-16 bg-linear-to-br from-green-50 dark:from-slate-900 via-green-100 to-white">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="text-center mb-8">
                        <h3 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-3">
                            <span className="text-green-700">RH-WAVE 774</span> in Action
                        </h3>
                        <p className="text-lg text-slate-900 dark:text-white">Witness the transformation happening across Nigeria</p>
                    </div>

                    <div className="relative">
                        <div className="relative aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900">
                            {/* Images */}
                            {images.map((img, index) => (
                                <div
                                    key={index}
                                    className={`absolute inset-0 transition-opacity duration-1000 ${index === currentImage ? 'opacity-100' : 'opacity-0'
                                        }`}
                                >
                                    <Image
                                        src={img}
                                        alt={`RH-WAVE 774 Program - Women in Agriculture Training and Development ${index + 1}`}
                                        fill
                                        className="object-contain"
                                        priority={index === 0}
                                    />
                                </div>
                            ))}

                            {/* Navigation Buttons */}
                            <button
                                onClick={prevImage}
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white dark:bg-slate-900/90 hover:bg-white dark:bg-slate-900 p-4 rounded-full shadow-lg transition z-10"
                                aria-label="Previous image"
                            >
                                <ChevronLeft className="w-6 h-6 text-green-700" />
                            </button>
                            <button
                                onClick={nextImage}
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white dark:bg-slate-900/90 hover:bg-white dark:bg-slate-900 p-4 rounded-full shadow-lg transition z-10"
                                aria-label="Next image"
                            >
                                <ChevronRight className="w-6 h-6 text-green-700" />
                            </button>

                            {/*Indicators */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                                {images.map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setCurrentImage(index)}
                                        className={`w-3 h-3 rounded-full transition ${index === currentImage
                                            ? 'bg-white dark:bg-slate-900 w-12'
                                            : 'bg-white dark:bg-slate-900/60 hover:bg-white dark:bg-slate-900/80'
                                            }`}
                                        aria-label={`Go to image ${index + 1}`}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Image Counter */}
                        <div className="text-center mt-6">
                            <p className="text-slate-900 dark:text-white text-xl font-bold bg-white dark:bg-slate-900/90 rounded-xl px-5 py-2.5 inline-block shadow-lg">
                                {currentImage + 1} / {images.length}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Introduction Section */}
            <section className="py-20 bg-slate-50 dark:bg-slate-900">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-6">
                            More Than a Program — <br />
                            <span className="text-green-700">A National Reawakening</span>
                        </h2>
                        <div className="w-24 h-1 bg-linear-to-r from-green-700 via-green-600 to-green-600 mx-auto rounded-full" />
                    </div>

                    <div className="prose prose-lg max-w-4xl mx-auto text-slate-900 dark:text-white leading-relaxed">
                        <p className="text-xl mb-6">
                            RH-WAVE 774 is Nigeria's boldest answer to economic exclusion, food insecurity, and structural inequality — anchored on the <strong className="text-green-700">brilliance, courage, and economic power of Nigerian women</strong>.
                        </p>
                        <p className="text-lg mb-6">
                            Launched under the visionary leadership of <strong>President Bola Ahmed Tinubu, GCFR</strong>, in June 2025, this flagship Women Agro-Value Expansion Programme propels women from subsistence farming to value-chain entrepreneurs, market leaders, and exporters.
                        </p>
                        <p className="text-lg font-semibold text-green-700">
                            This is not empowerment rhetoric — this is economic inclusion in practice.
                        </p>
                    </div>
                </div>
            </section>

            {/* Vision & Stats Section */}
            <section className="py-20 bg-linear-to-br from-green-50 dark:from-slate-900 to-green-50">
                <div className="max-w-7xl mx-auto px-6">
                    {/* Vision Statement */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 shadow-xl mb-16">
                        <div className="flex items-start gap-4 mb-4">
                            <Sparkles className="w-8 h-8 text-green-700 shrink-0 mt-1" />
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Our Vision</h3>
                                <p className="text-lg text-slate-900 dark:text-white leading-relaxed">
                                    A Nigeria where every woman is a <strong className="text-green-700">wealth creator</strong>, <strong className="text-green-600">value-chain leader</strong>, <strong className="text-green-700">job generator</strong>, trusted participant in national export growth, and builder of resilient food systems.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Key Stats */}
                    <h3 className="text-3xl font-bold text-center text-slate-900 dark:text-white mb-12">The Challenge We're Solving</h3>
                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-lg hover:shadow-xl transition">
                            <div className="text-6xl font-bold text-green-700 mb-4">70%</div>
                            <p className="text-slate-900 dark:text-white text-lg">
                                Nigerian women represent nearly <strong>70% of the agricultural workforce</strong>
                            </p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-lg hover:shadow-xl transition">
                            <div className="text-6xl font-bold text-green-600 mb-4">80%</div>
                            <p className="text-slate-900 dark:text-white text-lg">
                                Over <strong>80% of total food production</strong> comes from women
                            </p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-lg hover:shadow-xl transition border-4 border-green-200">
                            <div className="text-6xl font-bold text-green-700 mb-4">10%</div>
                            <p className="text-slate-900 dark:text-white text-lg">
                                Yet only <strong className="text-green-700">~10% own farmland</strong> or access finance, markets, or technology
                            </p>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="text-center mt-12">
                        <Link
                            href="/wave/application"
                            className="inline-flex items-center gap-3 bg-linear-to-r from-green-700 via-green-600 to-green-500 text-white px-8 py-4 rounded-xl text-lg font-bold shadow-xl hover:shadow-green-500/50 transition-all hover:scale-105"
                        >
                            <Users className="w-5 h-5" />
                            <span>Join 10 Million Women Building Nigeria's Future</span>
                        </Link>
                    </div>
                </div>
            </section>

            {/* About Section */}
            <section className="py-20 bg-slate-50 dark:bg-slate-900">
                <div className="max-w-6xl mx-auto px-6">
                    <h2 className="text-4xl md:text-5xl font-bold text-center text-slate-900 dark:text-white mb-16">
                        Our Genesis — <span className="text-green-700">Hope Birthed from National Purpose</span>
                    </h2>

                    <div className="space-y-12">
                        {/* The Problem */}
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-8">
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed">
                                Nigerian women represent nearly 70% of the agricultural workforce and over 80% of total food production. Yet tragically, only ~10% own farmland or access finance, markets, or technology.
                            </p>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed mt-4">
                                This stark imbalance has constrained productivity, deepened poverty, and weakened national food systems. <strong className="text-green-700">RH-WAVE 774 was born to change that.</strong>
                            </p>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed mt-4">
                                Under the <strong>Renewed Hope Agenda</strong>, President Tinubu empowered the Federal Ministry of Women Affairs to architect a program that <strong className="text-green-600">dismantles barriers — not just talk about them</strong>.
                            </p>
                        </div>

                        {/* OIC Partnership */}
                        <div className="bg-linear-to-br from-green-50 dark:from-slate-900 to-green-50 rounded-2xl p-8 border-l-4 border-green-700">
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
                                <Globe className="w-7 h-7 text-green-700" />
                                OIC & Strategic Collaboration — A Global Partnership in Abuja
                            </h3>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed mb-4">
                                From <strong>August 27–29, 2025</strong>, the Federal Government — led by the Honourable Minister, <strong>Imaan Sulaiman-Ibrahim</strong> — partnered with the Organisation of Islamic Cooperation (OIC) to conduct a national capacity-building workshop in Abuja.
                            </p>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed">
                                This landmark training featured <strong>greenhouse farming, post-harvest storage, financial literacy, and agribusiness skills</strong> sessions. The OIC pledged support for women in agribusiness, food security, and entrepreneurial development, reinforcing Nigeria's role as a leader in women-inclusive economic transformation.
                            </p>
                        </div>

                        {/* Easy Sales Export Partnership */}
                        <div className="bg-linear-to-br from-green-50 dark:from-slate-900 to-green-100 rounded-2xl p-8 border-l-4 border-green-600">
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
                                <Shield className="w-7 h-7 text-green-600" />
                                Easy Sales Export — Lead Implementation Partner
                            </h3>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed mb-4">
                                To ensure RH-WAVE 774 becomes reality, the Federal Ministry partnered with <strong>Easy Sales Export Nigeria Ltd</strong> — a seasoned agribusiness execution expert with globally-minded operational leadership.
                            </p>
                            <p className="text-lg text-slate-900 dark:text-white leading-relaxed mb-4">
                                As lead implementing partner, Easy Sales Export brings:
                            </p>
                            <ul className="space-y-2 text-slate-900 dark:text-white">
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                                    <span>Agribusiness structuring and governance</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                                    <span>Cooperative systems design</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                                    <span>Market access and export pathways</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                                    <span>Operational execution excellence</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                                    <span>Monitoring, reporting, and impact delivery systems</span>
                                </li>
                            </ul>
                            <p className="text-lg font-semibold text-green-800 mt-4">
                                This partnership ensures RH-WAVE 774 becomes a scalable, transparent, and impact-heavy reality.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Opportunity Section */}
            <section className="py-20 bg-slate-50 dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-6">
                            What RH-WAVE 774 Will Do
                        </h2>
                        <p className="text-xl text-slate-900 dark:text-white max-w-3xl mx-auto">
                            The program is built on <strong className="text-green-700">5 pillars of transformation</strong>
                        </p>
                    </div>

                    {/* 5 Pillars */}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
                        {[
                            {
                                number: "1",
                                title: "Structured Agribusiness Pathways",
                                description: "Women move from subsistence to business — producing, processing, packaging, and selling at scale.",
                                color: "emerald"
                            },
                            {
                                number: "2",
                                title: "Market Linkages — Local & Global",
                                description: "Guaranteed market channels within Nigeria and international destinations.",
                                color: "purple"
                            },
                            {
                                number: "3",
                                title: "Value Addition & Export Readiness",
                                description: "Because raw produce is poverty — value is wealth.",
                                color: "blue"
                            },
                            {
                                number: "4",
                                title: "Financial & Technical Support Ecosystems",
                                description: "Access to finance, modern technology, mechanisation, storage, and enterprise coaching.",
                                color: "green"
                            },
                            {
                                number: "5",
                                title: "Cooperative Power & Collective Ownership",
                                description: "No woman stands alone — cooperatives amplify resources, resilience, and revenue.",
                                color: "indigo"
                            }
                        ].map((pillar, index) => (
                            <div key={index} className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-lg hover:shadow-xl transition">
                                <div className={`w-14 h-14 bg-${pillar.color}-100 rounded-xl flex items-center justify-center mb-4`}>
                                    <span className={`text-2xl font-bold text-${pillar.color}-600`}>{pillar.number}</span>
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">{pillar.title}</h3>
                                <p className="text-slate-900 dark:text-white">{pillar.description}</p>
                            </div>
                        ))}
                    </div>

                    <div className="bg-linear-to-r from-green-700 via-green-600 to-green-600 rounded-3xl p-1 max-w-4xl mx-auto">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 text-center">
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                This is not charity — this is <span className="text-green-700">structured economic participation</span>.
                            </p>
                        </div>
                    </div>

                    {/* Who Should Join */}
                    <div className="mt-16 bg-white dark:bg-slate-900 rounded-3xl p-10 shadow-xl">
                        <h3 className="text-3xl font-bold text-center text-slate-900 dark:text-white mb-8">
                            To Every Nigerian Woman — <span className="text-green-700">This is Your Moment</span>
                        </h3>
                        <p className="text-lg text-slate-900 dark:text-white text-center mb-6">If you are:</p>
                        <div className="grid md:grid-cols-4 gap-4 max-w-4xl mx-auto">
                            {[
                                "A farmer", "A trader", "A processor", "A graduate",
                                "A single mother", "A rural entrepreneur", "A market woman", "A woman with dreams"
                            ].map((type, index) => (
                                <div key={index} className="bg-green-50 rounded-lg p-4 text-center">
                                    <p className="font-semibold text-green-700">{type}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xl font-bold text-center text-slate-900 dark:text-white mt-8">
                            RH-WAVE 774 is designed for you.
                        </p>
                        <p className="text-lg text-center text-green-700 mt-4">
                            This is your invitation to rise. To build. To lead. To own your economic future.
                        </p>
                    </div>
                </div>
            </section>

            {/* Benefits Section */}
            <section className="py-20 bg-slate-50 dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-6">
                    <h2 className="text-4xl md:text-5xl font-bold text-center text-slate-900 dark:text-white mb-6">
                        Why RH-WAVE 774 Matters to Nigeria's Future
                    </h2>
                    <div className="w-24 h-1 bg-linear-to-r from-green-700 via-green-600 to-green-600 mx-auto rounded-full mb-16" />

                    {/* National Impact */}
                    <div className="grid md:grid-cols-2 gap-8 mb-16">
                        {[
                            {
                                title: "Food Security",
                                description: "becomes sustainable when women are profitable participants, not marginalized contributors.",
                                icon: "🌾"
                            },
                            {
                                title: "Economic Growth",
                                description: "accelerates when millions of women trade, process, export, and reinvest.",
                                icon: "📈"
                            },
                            {
                                title: "Import Dependence",
                                description: "shrinks when Nigerian products are globally competitive.",
                                icon: "🌍"
                            },
                            {
                                title: "Household Dignity",
                                description: "is restored when families earn, save, and invest locally.",
                                icon: "🏡"
                            },
                            {
                                title: "National Pride",
                                description: "blooms when Nigerian women transform agriculture from survival to opportunity.",
                                icon: "🇳🇬"
                            }
                        ].map((benefit, index) => (
                            <div key={index} className="bg-linear-to-br from-green-50 dark:from-slate-900 to-green-50 rounded-2xl p-8 border-l-4 border-green-700">
                                <div className="flex items-start gap-4">
                                    <div className="text-4xl">{benefit.icon}</div>
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{benefit.title}</h3>
                                        <p className="text-slate-900 dark:text-white">{benefit.description}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* What You Gain */}
                    <div className="bg-linear-to-br from-green-50 dark:from-slate-900 to-green-100 rounded-3xl p-10">
                        <h3 className="text-3xl font-bold text-center text-slate-900 dark:text-white mb-8">What You Gain</h3>
                        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                            {[
                                "Access to finance and modern technology",
                                "Training in greenhouse farming, post-harvest storage, and financial literacy",
                                "Direct market connections locally and internationally",
                                "Cooperative membership for collective strength",
                                "Export readiness and value-addition skills",
                                "Ongoing enterprise coaching and support",
                                "Partnership with international organizations (OIC)"
                            ].map((gain, index) => (
                                <div key={index} className="flex items-start gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-700 shrink-0 mt-1" />
                                    <p className="text-slate-900 dark:text-white font-medium">{gain}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Call to Action */}
                    <div className="mt-16 text-center">
                        <p className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Join the Movement. Shape the Future. Lead the Change.
                        </p>
                        <p className="text-lg text-slate-900 dark:text-white mb-8 max-w-3xl mx-auto">
                            Women feeding the world. Women leading commerce. Women transforming communities. <br />
                            <span className="font-semibold text-green-700">Women building nations.</span>
                        </p>
                        <p className="text-xl font-bold text-green-600 mb-8">
                            This is WAVE. This is your stage. This is your legacy.
                        </p>
                    </div>
                </div>
            </section>

            {/* Final Registration CTA */}
            <section className="py-20 bg-linear-to-br from-green-700 via-green-600 to-green-500 text-white">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold mb-6">
                        Register Now — Be Positioned for Impact, Income & Legacy
                    </h2>
                    <p className="text-xl mb-4 opacity-90">
                        RH-WAVE 774 is not just another government program.
                    </p>
                    <p className="text-2xl font-bold mb-12">
                        It is Nigeria's promise reborn — through the hands of its women.
                    </p>

                    <Link
                        href="/wave/application"
                        className="inline-flex items-center gap-3 bg-white dark:bg-slate-900 text-green-700 px-12 py-6 rounded-xl text-xl font-bold shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                    >
                        <span>Begin Here - Apply Now!</span>
                        <ArrowRight className="w-6 h-6" />
                    </Link>

                    <p className="text-lg mt-8 opacity-90">
                        Complete your registration and join <strong>10 million Nigerian women</strong> building a new economic reality.
                    </p>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-slate-900 text-white py-12">
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <p className="text-slate-400 mb-4">
                        RH-WAVE 774 • Women Agro-Value Expansion Programme
                    </p>
                    <p className="text-slate-500 text-sm">
                        Federal Ministry of Women Affairs • Renewed Hope Agenda • Presidential Mandate
                    </p>
                    <p className="text-slate-500 text-sm mt-2">
                        Implemented by Easy Sales Export Nigeria Ltd
                    </p>
                </div>
            </footer>
        </div>
    );
}
