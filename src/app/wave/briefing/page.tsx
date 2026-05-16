/**
 * WAVE National Awareness & Opportunity Briefing
 * Premium Registration Landing Page
 * 
 * Public page — no auth required
 * Theme: White & Dark Forest Green
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowRight, CheckCircle, Shield, TrendingUp, Users, Sparkles, Clock, MapPin, Calendar, ChevronDown } from "lucide-react";
import Link from "next/link";
import { registerForBriefingAction } from "@/app/actions/briefing";
import BackToHub from "@/components/common/BackToHub";

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
    "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
    "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

const ROLES = [
    { value: "woman_seeking", label: "Woman seeking participation" },
    { value: "investor", label: "Investor" },
    { value: "cooperative", label: "Cooperative member" },
    { value: "farm_owner", label: "Farm owner" },
    { value: "general", label: "General interest" },
];

export default function WaveBriefingPage() {
    const [formData, setFormData] = useState({
        firstName: "",
        lastName: "",
        otherName: "",
        phoneNumber: "",
        email: "",
        state: "",
        role: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRegistered, setIsRegistered] = useState(false);
    const [error, setError] = useState("");
    const [isOfflinePending, setIsOfflinePending] = useState(false);
    const formRef = useRef<HTMLDivElement>(null);
    const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

    // Intersection Observer for scroll animations
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setVisibleSections((prev) => new Set(prev).add(entry.target.id));
                    }
                });
            },
            { threshold: 0.15 }
        );

        const sections = document.querySelectorAll("[data-animate]");
        sections.forEach((section) => observer.observe(section));

        return () => observer.disconnect();
    }, []);

    // Offline sync listener
    useEffect(() => {
        async function handleOnline() {
            const pendingData = localStorage.getItem("wave_briefing_pending_sync");
            if (pendingData && !isSubmitting) {
                try {
                    const data = JSON.parse(pendingData);
                    setIsOfflinePending(false);
                    setIsSubmitting(true);
                    const result = await registerForBriefingAction(data);
                    if (result.success) {
                        setIsRegistered(true);
                        localStorage.removeItem("wave_briefing_pending_sync");
                    } else {
                        setError(result.error || "Registration failed on sync");
                    }
                } catch {
                    setError("Failed to sync registration.");
                } finally {
                    setIsSubmitting(false);
                }
            }
        };

        window.addEventListener("online", handleOnline);
        return () => window.removeEventListener("online", handleOnline);
    }, [isSubmitting]);

    const scrollToForm = () => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");

        // Client-side validation — mirrors server strictNameSchema (min 2 chars)
        const fullName = [formData.firstName, formData.otherName, formData.lastName]
            .filter(Boolean).join(" ").trim();
        if (formData.firstName.trim().length < 2) {
            setError("First name must be at least 2 characters.");
            return;
        }
        if (formData.lastName.trim().length < 2) {
            setError("Last name must be at least 2 characters.");
            return;
        }
        if (fullName.length < 2) {
            setError("Please provide your full name.");
            return;
        }

        if (typeof navigator !== "undefined" && !navigator.onLine) {
            localStorage.setItem("wave_briefing_pending_sync", JSON.stringify(formData));
            setIsOfflinePending(true);
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                ...formData,
                fullName,
            };
            const result = await registerForBriefingAction(payload);
            if (result.success) {
                setIsRegistered(true);
                // Scroll up so user sees the success message right above the form area
                setTimeout(() => scrollToForm(), 100);
            } else {
                setError(result.error || "Registration failed");
            }
        } catch {
            setError("Something went wrong. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const isVisible = (id: string) => visibleSections.has(id);

    return (
        <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
            {/* ───────────────── HERO SECTION ───────────────── */}
            <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
                {/* Background layers - Clean White/Green implementation */}
                <div className="absolute inset-0 bg-white pointer-events-none" />
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
                    backgroundImage: `radial-gradient(circle at 2px 2px, #14532d 0.5px, transparent 0)`,
                    backgroundSize: '40px 40px'
                }} />

                {/* Animated Dark Forest Green accents */}
                <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-green-50 blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-green-50 blur-3xl opacity-50 translate-y-1/2 -translate-x-1/4" />

                <BackToHub className="top-6 left-6 z-20 text-slate-600 hover:text-green-900" />

                <div className="relative z-10 max-w-5xl mx-auto px-6 text-center py-12 md:py-24">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-900 px-5 py-2 rounded-full text-sm font-bold mb-8 shadow-sm">
                        <Shield className="w-4 h-4 text-green-700" />
                        <span className="tracking-wide">GOVERNMENT-BACKED • STRATEGIC OPPORTUNITY</span>
                    </div>

                    {/* Pre-headline */}
                    <p className="text-lg md:text-xl text-slate-500 font-medium tracking-wide uppercase mb-4 animate-fade-in">
                        One-Day National Awareness & Opportunity Briefing
                    </p>

                    {/* Main Headline */}
                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-black mb-6 leading-tight text-slate-900">
                        <span className="block mb-2">Nigeria Is Shifting.</span>
                        <span className="text-green-900">
                            The WAVE Opportunity Is Here.
                        </span>
                    </h1>

                    {/* Sub-statement */}
                    <p className="text-lg md:text-xl text-slate-600 max-w-3xl mx-auto mb-10 leading-relaxed font-medium">
                        Position yourself legally inside a <strong className="text-green-900 font-bold">government-backed agricultural structure</strong> — and access opportunities that can transform your financial future.
                    </p>

                    {/* Value pills - Clean Style */}
                    <div className="flex flex-wrap justify-center gap-3 mb-12 max-w-4xl mx-auto">
                        {[
                            "₦1M Capital Support",
                            "₦20M+ Growth Potential",
                            "Food Security Contracts",
                            "Export Access",
                            "Structured Wealth",
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-full text-sm font-semibold shadow-sm hover:border-green-300 transition-colors">
                                <CheckCircle className="w-4 h-4 text-green-700 shrink-0" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>

                    {/* Trust line */}
                    <p className="text-slate-500 text-lg font-medium mb-8 italic">
                        "This is not hype. This is <span className="text-green-900 font-bold underline decoration-green-500/30 decoration-4 underline-offset-4">structure</span>."
                    </p>

                    {/* CTA - Dark Forest Green Button */}
                    <button
                        onClick={scrollToForm}
                        className="group inline-flex items-center gap-3 bg-green-900 text-white px-10 py-5 rounded-xl text-lg font-bold shadow-xl shadow-green-900/20 hover:bg-green-800 hover:shadow-green-900/30 transition-all hover:-translate-y-1 active:translate-y-0"
                    >
                        <span>RESERVE YOUR FREE SEAT</span>
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <p className="text-slate-500 text-sm mt-4 font-medium flex items-center justify-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        Free Registration • Limited Seats Available
                    </p>

                    {/* Scroll indicator */}
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
                        <ChevronDown className="w-8 h-8 text-slate-300" />
                    </div>
                </div>
            </section>

            {/* ───────────────── WHAT YOU'LL DISCOVER ───────────────── */}
            <section className="py-12 md:py-24 bg-slate-50 relative border-t border-slate-100">
                <div
                    id="discover"
                    data-animate
                    className={`relative max-w-6xl mx-auto px-6 transition-all duration-1000 ${isVisible("discover") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                >
                    <div className="text-center mb-16">
                        <p className="text-green-700 font-bold tracking-widest uppercase text-sm mb-3">Your Invitation</p>
                        <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-6">
                            1-Day Live Awareness Briefing
                        </h2>

                        {/* ─── LAND ALLOCATION URGENCY BANNER ─── */}
                        <div className="max-w-xl mx-auto bg-yellow-50 border-2 border-yellow-200 rounded-xl p-5 mb-8 shadow-sm">
                            <p className="text-yellow-900 font-bold text-lg">
                                Land allocation discussions are happening now.
                            </p>
                            <p className="text-yellow-800 font-bold text-lg mt-1">
                                Only positioned members will be considered
                            </p>
                        </div>

                        <div className="w-24 h-1.5 bg-green-900 mx-auto rounded-full" />
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                        {[
                            "How WAVE is structurally designed for sustainability",
                            "How women can access ₦1M simplified entry capital",
                            "How small capital compounds into ₦20M+ within 5 years",
                            "How private investors can participate in the model",
                            "How cooperatives are positioned ahead of individuals",
                            "How to plug into national food security contracts",
                            "How agriculture is becoming Nigeria's definitive wealth engine",
                        ].map((item, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow group"
                                style={{ transitionDelay: `${i * 100}ms` }}
                            >
                                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center shrink-0 group-hover:bg-green-100 transition-colors">
                                    <CheckCircle className="w-5 h-5 text-green-800" />
                                </div>
                                <p className="text-slate-700 font-medium text-lg leading-snug pt-1.5">{item}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ───────────────── WHY THIS MATTERS NOW ───────────────── */}
            <section className="py-24 bg-white">
                <div
                    id="why-now"
                    data-animate
                    className={`max-w-5xl mx-auto px-6 transition-all duration-1000 ${isVisible("why-now") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                >
                    <div className="text-center mb-16">
                        <p className="text-green-700 font-bold tracking-widest uppercase text-sm mb-3">Critical Timing</p>
                        <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-6">
                            Why Need To Act <span className="text-green-900 underline decoration-green-200 decoration-8 underline-offset-4">Now</span>
                        </h2>
                    </div>

                    <div className="space-y-8 max-w-4xl mx-auto">
                        {[
                            { title: "Review", text: "Nigeria is completely restructuring its food systems." },
                            { title: "Align", text: "Government-backed agricultural frameworks are emerging rapidly." },
                            { title: "Position", text: "Policies are shifting toward structured production, aggregation, and export." },
                        ].map((item, i) => (
                            <div key={i} className="flex items-start gap-6">
                                <span className="text-4xl font-black text-slate-200 shrink-0 select-none">0{i + 1}</span>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">{item.title}</h3>
                                    <p className="text-xl text-slate-600 leading-relaxed font-medium">{item.text}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-16 bg-green-50 border border-green-100 rounded-3xl p-10 text-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-green-200 rounded-full blur-3xl opacity-50" />
                        <div className="relative z-10">
                            <p className="text-2xl text-slate-900 font-bold mb-3">
                                Those who understand early… <span className="text-green-800">win early.</span>
                            </p>
                            <p className="text-lg text-slate-600 mb-6">
                                Those who delay… watch others build wealth securely.
                            </p>
                            <div className="inline-block bg-white px-6 py-2 rounded-full border border-green-200 shadow-sm">
                                <p className="text-green-900 font-bold text-lg">
                                    Your briefing seat is your early positioning advantage.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ───────────────── FOR WOMEN ───────────────── */}
            <section className="py-24 bg-green-900 text-white relative overflow-hidden">
                {/* Pattern overlay */}
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
                    backgroundImage: `radial-gradient(circle at 2px 2px, #ffffff 1px, transparent 0)`,
                    backgroundSize: '30px 30px'
                }} />

                <div
                    id="for-women"
                    data-animate
                    className={`relative max-w-6xl mx-auto px-6 transition-all duration-1000 ${isVisible("for-women") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                >
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        {/* Left — Messaging */}
                        <div>
                            <div className="inline-block bg-white/20 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-6 backdrop-blur-sm">
                                Core Focus
                            </div>
                            <h2 className="text-4xl md:text-5xl font-black text-white mb-8 leading-tight">
                                Opportunity For <br /><span className="text-green-300">Women</span>
                            </h2>

                            <p className="text-green-100/80 mb-8 text-xl font-medium">If you identify as:</p>
                            <div className="space-y-4 mb-8">
                                {[
                                    "A graduate seeking stability",
                                    "A trader looking to scale up",
                                    "A civil servant seeking side income",
                                    "A housewife ready to build legacy",
                                    "A young woman breaking limits",
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-4 group">
                                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-green-400 group-hover:text-green-900 transition-all">
                                            <CheckCircle className="w-4 h-4" />
                                        </div>
                                        <p className="text-lg text-white font-medium">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right — Impact card */}
                        <div className="bg-white text-slate-900 rounded-3xl p-10 shadow-2xl shadow-black/20 relative z-10 transform rotate-1 hover:rotate-0 transition-transform duration-500">
                            <h3 className="text-2xl font-bold text-green-900 mb-8 border-b border-green-100 pb-4">The Briefing Reveals:</h3>
                            <div className="space-y-6">
                                <div>
                                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">Starting Point</p>
                                    <p className="text-3xl font-black text-slate-900">How <span className="text-green-700">₦1,000,000</span></p>
                                    <p className="text-slate-600 font-medium">in structured agro-deployment...</p>
                                </div>
                                <div className="w-px h-8 bg-slate-200 ml-4"></div>
                                <div>
                                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">Growth Projection</p>
                                    <p className="text-slate-600 mb-1 font-medium">Multiplies structurally into over</p>
                                    <p className="text-4xl font-black text-green-800">₦20,000,000+</p>
                                    <p className="text-slate-500 text-sm mt-2 font-medium bg-green-50 inline-block px-3 py-1 rounded-lg">
                                        Within 5 years • Production • Aggregation • Export
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ───────────────── FOR INVESTORS ───────────────── */}
            <section className="py-24 bg-slate-50">
                <div
                    id="for-investors"
                    data-animate
                    className={`max-w-6xl mx-auto px-6 transition-all duration-1000 ${isVisible("for-investors") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                >
                    <div className="text-center mb-16">
                        <p className="text-green-700 font-bold tracking-widest uppercase text-sm mb-3">Expanding The Scope</p>
                        <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">
                            For Investors, Farm Owners & <span className="text-green-800">Business Leaders</span>
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8">
                        {/* If you are */}
                        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Users className="w-5 h-5 text-green-700" />
                                Who Needs To Be Here:
                            </h3>
                            <div className="space-y-4">
                                {[
                                    "Investors seeking structured, secured agricultural ROI",
                                    "Landowners seeking managed partnerships",
                                    "Cooperative leaders",
                                    "Diaspora Nigerians seeking verified channels",
                                    "Business owners tired of unstable ventures",
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2.5 shrink-0" />
                                        <p className="text-slate-600 font-medium">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* You will discover */}
                        <div className="bg-green-900 text-white rounded-3xl p-8 shadow-xl shadow-green-900/10">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-green-300" />
                                What You Will Discover:
                            </h3>
                            <div className="space-y-5">
                                {[
                                    "The WAVE structural business model explained",
                                    "Transparent revenue split systems",
                                    "Government alignment advantages",
                                    "Long-term food security positioning",
                                    "Paths to tens/hundreds of millions annually",
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-3 border-b border-green-800 pb-3 last:border-0 last:pb-0">
                                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                                        <p className="text-green-50 font-medium">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ───────────────── URGENCY BAND ───────────────── */}
            <section className="py-12 bg-slate-900 text-white border-y border-slate-800">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <div className="flex items-center justify-center gap-2 mb-3">
                        <Clock className="w-5 h-5 text-green-400 animate-pulse" />
                        <p className="text-green-400 font-bold tracking-widest uppercase text-xs">Strictly Limited Capacity</p>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-white mb-2">
                        This is a <span className="text-green-400">strategic positioning session</span>.
                    </p>
                    <p className="text-slate-400 font-medium mt-2">
                        It's specifically for those ready to legally structure their agricultural wealth.
                    </p>
                </div>
            </section>

            {/* ───────────────── LAND ALLOCATION URGENCY BAND ───────────────── */}
            <section className="py-10 bg-green-950 text-white border-y border-green-800">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <p className="text-lg md:text-xl font-bold text-white leading-relaxed">
                        Land allocation discussions are happening now.
                    </p>
                    <p className="text-lg md:text-xl font-bold text-green-300 mt-1">
                        Only positioned members will be considered.
                    </p>
                </div>
            </section>

            {/* ───────────────── REGISTRATION FORM ───────────────── */}
            <section className="py-24 bg-white relative" ref={formRef}>
                {/* Background nuance */}
                <div className="absolute top-0 left-0 w-full h-1/2 bg-slate-50 skew-y-1 transform origin-top-left -z-10" />

                <div
                    id="registration"
                    data-animate
                    className={`max-w-2xl mx-auto px-6 transition-all duration-1000 ${isVisible("registration") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                >
                    {isRegistered ? (
                        /* ─── Success State (White/Green) ─── */
                        <div className="bg-white border-2 border-green-100 rounded-3xl p-10 text-center shadow-2xl shadow-green-900/5 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-green-50 rounded-full blur-3xl -z-10" />

                            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce-slow">
                                <CheckCircle className="w-12 h-12 text-green-700" />
                            </div>

                            <h3 className="text-3xl font-black text-slate-900 mb-4">Registration Confirmed 🎉</h3>
                            <p className="text-xl text-slate-600 mb-10 max-w-sm mx-auto">Your seat for the WAVE National Awareness Briefing has been securely reserved.</p>

                            <div className="bg-green-50 rounded-xl p-6 text-left space-y-4 mb-8">
                                <p className="text-xs font-bold text-green-800 uppercase tracking-widest mb-2">Next Steps</p>
                                {[
                                    { icon: "📩", text: "Watch for your Confirmation Message" },
                                    { icon: "📍", text: "Venue details will be sent directly" },
                                    { icon: "📘", text: "Review the Pre-Briefing Info Pack" },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3 bg-white border border-green-100/50 rounded-lg px-4 py-3 shadow-sm">
                                        <span className="text-xl">{item.icon}</span>
                                        <p className="text-slate-800 font-medium">{item.text}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-2">
                                <Link
                                    href="/"
                                    className="inline-flex items-center gap-2 text-green-700 hover:text-green-900 font-bold transition-colors group"
                                >
                                    <span>Return to Hub</span>
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </Link>
                            </div>
                        </div>
                    ) : (
                        /* ─── Registration Form (White/Green) ─── */
                        <div className="bg-white border border-slate-200 rounded-3xl p-8 md:p-12 shadow-2xl shadow-slate-200/50 relative">
                            <div className="absolute top-0 left-0 w-full h-2 bg-green-900" /> {/* Accent bar */}

                            {/* ─── LAND ALLOCATION URGENCY BANNER (Specifically for the form) ─── */}
                            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-5 mb-8 text-center shadow-sm">
                                <p className="text-yellow-900 font-bold text-lg">
                                    Land allocation discussions are happening now.
                                </p>
                                <p className="text-yellow-800 font-bold text-lg mt-1">
                                    Only positioned members will be considered
                                </p>
                            </div>

                            <div className="text-center mb-10">
                                <p className="text-green-700 font-bold text-xs uppercase tracking-widest mb-3">Free Registration</p>
                                <h3 className="text-3xl font-black text-slate-900 mb-3">
                                    Secure Your Access
                                </h3>
                                <p className="text-slate-500 font-medium">Please provide accurate details for check-in.</p>
                            </div>

                            {error && (
                                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-8 text-center flex items-center justify-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-red-500" />
                                    <p className="text-red-700 text-sm font-bold">{error}</p>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* KYC Notice */}
                                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-2 flex items-start gap-2">
                                    <span className="text-amber-500 text-sm shrink-0 mt-0.5">⚠️</span>
                                    <p className="text-xs text-amber-800 font-medium">
                                        <strong>KYC Notice:</strong> Enter your name exactly as it appears on your NIN/BVN.
                                    </p>
                                </div>

                                {/* First Name */}
                                <div>
                                    <label htmlFor="firstName" className="block text-sm font-bold text-slate-700 mb-2">
                                        First Name <span className="text-red-500">*</span>
                                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As on your NIN/BVN</span>
                                    </label>
                                    <input
                                        id="firstName"
                                        name="firstName"
                                        type="text"
                                        required
                                        value={formData.firstName}
                                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all font-medium"
                                        placeholder="e.g. Amina"
                                    />
                                </div>

                                {/* Last Name */}
                                <div>
                                    <label htmlFor="lastName" className="block text-sm font-bold text-slate-700 mb-2">
                                        Last Name <span className="text-red-500">*</span>
                                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As on your NIN/BVN</span>
                                    </label>
                                    <input
                                        id="lastName"
                                        name="lastName"
                                        type="text"
                                        required
                                        value={formData.lastName}
                                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all font-medium"
                                        placeholder="e.g. Ibrahim"
                                    />
                                </div>

                                {/* Other Name (Optional) */}
                                <div>
                                    <label htmlFor="otherName" className="block text-sm font-bold text-slate-700 mb-2">
                                        Other Name <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                                        <span className="block text-xs font-normal text-slate-500 mt-0.5">Middle name or additional name</span>
                                    </label>
                                    <input
                                        id="otherName"
                                        name="otherName"
                                        type="text"
                                        value={formData.otherName}
                                        onChange={(e) => setFormData({ ...formData, otherName: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all font-medium"
                                        placeholder="e.g. Fatima"
                                    />
                                </div>

                                {/* Phone Number */}
                                <div>
                                    <label htmlFor="phone" className="block text-sm font-bold text-slate-700 mb-2">Phone Number</label>
                                    <input
                                        id="phone"
                                        name="phone"
                                        type="tel"
                                        required
                                        autoComplete="tel"
                                        maxLength={14}
                                        value={formData.phoneNumber}
                                        onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all font-medium"
                                        placeholder="08012345678"
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label htmlFor="email" className="block text-sm font-bold text-slate-700 mb-2">Email Address</label>
                                    <input
                                        id="email"
                                        name="email"
                                        type="email"
                                        required
                                        autoComplete="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all font-medium"
                                        placeholder="you@email.com"
                                    />
                                </div>

                                {/* State */}
                                <div>
                                    <label htmlFor="state" className="block text-sm font-bold text-slate-700 mb-2">State of Residence</label>
                                    <div className="relative">
                                        <select
                                            id="state"
                                            name="state"
                                            required
                                            autoComplete="address-level1"
                                            value={formData.state}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-900/20 focus:border-green-900 transition-all appearance-none cursor-pointer font-medium"
                                        >
                                            <option value="">Select your state</option>
                                            {NIGERIAN_STATES.map((state) => (
                                                <option key={state} value={state}>{state}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <ChevronDown className="w-5 h-5" />
                                        </div>
                                    </div>
                                </div>

                                {/* Role */}
                                <div>
                                    <p className="block text-sm font-bold text-slate-700 mb-4">I am primarily a:</p>
                                    <div className="space-y-3">
                                        {ROLES.map((role) => (
                                            <label
                                                key={role.value}
                                                className={`flex items-center gap-4 border rounded-xl px-5 py-4 cursor-pointer transition-all hover:bg-slate-50 ${formData.role === role.value
                                                    ? "border-green-900 bg-green-50/50 shadow-sm"
                                                    : "border-slate-200"
                                                    }`}
                                            >
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${formData.role === role.value ? "border-green-900" : "border-slate-300"
                                                    }`}>
                                                    {formData.role === role.value && (
                                                        <div className="w-2.5 h-2.5 rounded-full bg-green-900" />
                                                    )}
                                                </div>
                                                <input
                                                    type="radio"
                                                    name="role"
                                                    required
                                                    value={role.value}
                                                    checked={formData.role === role.value}
                                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                                    className="sr-only"
                                                />
                                                <span className={`font-medium ${formData.role === role.value ? "text-green-900" : "text-slate-600"}`}>
                                                    {role.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={isSubmitting || isOfflinePending}
                                    className="w-full bg-green-900 text-white py-4 rounded-xl text-lg font-bold shadow-lg shadow-green-900/20 hover:bg-green-800 hover:shadow-green-900/30 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3 mt-4"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Processing...</span>
                                        </>
                                    ) : isOfflinePending ? (
                                        <>
                                            <div className="w-5 h-5 flex items-center justify-center mt-0.5">
                                                <Clock className="w-5 h-5 text-white" />
                                            </div>
                                            <span>Pending Sync (Offline)</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Complete Registration</span>
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>

                                <p className="text-center text-xs text-slate-400 font-medium">
                                    By registering, you agree to receive official briefing updates.
                                </p>
                            </form>
                        </div>
                    )}
                </div>
            </section>

            {/* ───────────────── CLOSING SECTION ───────────────── */}
            <section className="py-24 bg-slate-950 text-white text-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
                    backgroundImage: `radial-gradient(circle at 2px 2px, #22c55e 1px, transparent 0)`,
                    backgroundSize: '40px 40px'
                }} />

                <div className="relative max-w-4xl mx-auto px-6">
                    <h2 className="text-3xl md:text-5xl font-black mb-8 leading-tight text-white">
                        This Is Your Moment To <br /> <span className="text-green-500">Enter The Structure.</span>
                    </h2>

                    <div className="flex flex-wrap justify-center gap-4 mb-12">
                        {["Systems", "Capital", "Exports", "Policy Alignment", "National Leverage"].map((item, i) => (
                            <div key={i} className="bg-white/10 border border-white/10 px-6 py-2 rounded-full font-semibold text-sm backdrop-blur-md">
                                {item}
                            </div>
                        ))}
                    </div>

                    <p className="text-xl font-bold text-white mb-10 max-w-2xl mx-auto">
                        This briefing may change how you see agriculture forever.
                    </p>

                    <button
                        onClick={scrollToForm}
                        className="inline-flex items-center gap-3 bg-white text-green-900 px-10 py-4 rounded-xl text-lg font-bold hover:bg-green-50 transition-colors shadow-lg shadow-white/10"
                    >
                        <span>Secure Your Seat Now</span>
                    </button>
                </div>
            </section>

            {/* ───────────────── FOOTER ───────────────── */}
            <footer className="py-16 bg-white border-t border-slate-200">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-2">Convener</p>
                    <p className="text-slate-900 text-xl font-black mb-1">Sir Abdallah Mohammed Narabi</p>
                    <p className="text-green-700 font-medium">Strategic Implementing Partner</p>
                    <p className="text-slate-500 text-sm mt-1">Women Agro-Value Expansion (WAVE)</p>

                    <div className="mt-12 pt-8 border-t border-slate-100">
                        <p className="text-slate-400 text-sm">© {(new Date()).getFullYear()} Easy Sales Export Hub. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
