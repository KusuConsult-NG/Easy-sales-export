import { Waves, User, Briefcase, DollarSign, FileText, CheckCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function WAVEProgramPage() {
    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Waves className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        WAVE Program
                    </h1>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                    Women's Advancement through Value-chain Enhancement
                </p>
            </div>

            {/* Hero Banner */}
            <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl p-8 text-white elevation-3 mb-8 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]">
                <h2 className="text-2xl font-bold mb-4">
                    Empowering Women in Agriculture
                </h2>
                <p className="text-blue-100 mb-6 max-w-3xl">
                    The WAVE Program provides funding, training, and market access to
                    women-led agricultural businesses. Get up to ₦5,000,000 in funding to
                    scale your operations.
                </p>
                <button className="px-8 py-4 bg-white text-blue-600 font-bold rounded-xl hover:scale-105 transition-transform elevation-2">
                    Apply Now
                </button>
            </div>

            {/* Benefits Grid */}
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Program Benefits
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        {
                            icon: DollarSign,
                            title: "Up to ₦5M Funding",
                            description:
                                "Access low-interest loans and grants to expand your business",
                            color: "bg-green-100 dark:bg-green-900/30 text-green-600",
                        },
                        {
                            icon: Briefcase,
                            title: "Business Training",
                            description:
                                "Free workshops on export regulations, quality control, and business management",
                            color: "bg-purple-100 dark:bg-purple-900/30 text-purple-600",
                        },
                        {
                            icon: CheckCircle,
                            title: "Market Access",
                            description:
                                "Direct connections to international buyers and export opportunities",
                            color: "bg-blue-100 dark:bg-blue-900/30 text-blue-600",
                        },
                    ].map((benefit, index) => (
                        <div
                            key={index}
                            className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                            style={{ animationDelay: `${100 + index * 100}ms` }}
                        >
                            <div
                                className={`w-12 h-12 rounded-xl ${benefit.color} flex items-center justify-center mb-4`}
                            >
                                <benefit.icon className="w-6 h-6" />
                            </div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                                {benefit.title}
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                {benefit.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Application Process */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2 mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    How to Apply
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[
                        {
                            step: "1",
                            title: "Submit Application",
                            description: "Fill out the online application form with your business details",
                        },
                        {
                            step: "2",
                            title: "Document Review",
                            description: "Our team reviews your business plan and financial projections",
                        },
                        {
                            step: "3",
                            title: "Interview",
                            description: "Selected applicants attend a virtual interview session",
                        },
                        {
                            step: "4",
                            title: "Funding & Training",
                            description: "Approved applicants receive funding and begin training",
                        },
                    ].map((process, index) => (
                        <div key={index} className="relative">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold shrink-0">
                                    {process.step}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                                        {process.title}
                                    </h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        {process.description}
                                    </p>
                                </div>
                            </div>
                            {index < 3 && (
                                <div className="hidden md:block absolute top-5 left-full w-full h-0.5 bg-slate-200 dark:bg-slate-700 -z-10" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Eligibility Requirements */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Eligibility Requirements
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                        "Women-owned or women-led agricultural business",
                        "At least 1 year of operation",
                        "Focus on approved export commodities (Yam, Sesame, Hibiscus)",
                        "Valid business registration (CAC)",
                        "Clear business plan and financial projections",
                        "Commitment to program training requirements",
                    ].map((requirement, index) => (
                        <div
                            key={index}
                            className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl"
                        >
                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                {requirement}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
