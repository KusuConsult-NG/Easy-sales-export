"use client";

import { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, CheckCircle, Send, AlertCircle, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Accordion from "@/components/ui/Accordion";
import { COMPANY_INFO } from "@/lib/constants";
import { submitWaveApplicationAction, type WaveApplicationState } from "@/app/actions/platform";
import { checkWaveEligibilityAction } from "@/app/actions/wave";

const initialState: WaveApplicationState = { error: "Initializing...", success: false };

export default function WAVEProgramPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [checking, setChecking] = useState(true);
    const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        phone: "",
        gender: "female" as const, // WAVE is female-only
        businessName: "",
        businessType: "",
        yearsInBusiness: "",
        reasonForApplying: "",
    });
    const [state, formAction, isPending] = useFormState(submitWaveApplicationAction, initialState);

    // Check gender eligibility on mount
    useEffect(() => {
        async function checkEligibility() {
            if (sessionStatus === "loading") return;

            if (!session?.user?.id) {
                router.push("/auth/login");
                return;
            }

            const result = await checkWaveEligibilityAction(session.user.id);

            if (!result.eligible) {
                router.push("/wave/access-denied");
                return;
            }

            setChecking(false);
        }

        checkEligibility();
    }, [session, sessionStatus, router]);

    // Handle successful submission
    if (state.success && !isPending) {
        setIsApplicationModalOpen(false);
        setFormData({
            fullName: "",
            email: "",
            phone: "",
            gender: "female" as const,
            businessName: "",
            businessType: "",
            yearsInBusiness: "",
            reasonForApplying: "",
        });
    }

    const faqs = [
        {
            question: "Who is eligible for the WAVE Program?",
            answer:
                "The WAVE Program is open to all women agripreneurs in Nigeria, whether you're just starting or have an established agricultural business. We welcome farmers, processors, exporters, and agricultural service providers who demonstrate commitment to growth and sustainable practices.",
        },
        {
            question: "What kind of support does the WAVE Program provide?",
            answer:
                "The WAVE Program offers comprehensive support including: (1) Financial grants and low-interest loans from ₦50,000 to ₦5,000,000, (2) Business development training and mentorship, (3) Market access and export opportunities, (4) Networking with other women entrepreneurs, and (5) Technical assistance for farming and processing.",
        },
        {
            question: "How long does the application process take?",
            answer:
                "The complete application process typically takes 4-6 weeks from submission to final decision. This includes: initial application review (1 week), interview and site visit (1-2 weeks), committee review (1-2 weeks), and final approval and disbursement (1 week).",
        },
        {
            question: "Do I need collateral to receive funding?",
            answer:
                "No! The WAVE Program is specifically designed to support women who may not have traditional collateral. We use alternative assessment methods including business viability, commitment to training, and group guarantees through cooperative memberships.",
        },
        {
            question: "Can I apply if I'm already a member of a cooperative?",
            answer:
                "Absolutely! Being a cooperative member actually strengthens your application. Cooperative members receive priority consideration and can access larger funding amounts through group applications.",
        },
        {
            question: "What is the repayment structure for loans?",
            answer:
                "We offer flexible repayment terms tailored to your business cycle. For farmers, repayment begins after harvest. Typical repayment periods range from 12-36 months with competitive interest rates of 5-8% APY. Grace periods of 3-6 months are available for new businesses.",
        },
    ];

    const benefits = [
        {
            title: "Financial Support",
            description: "Access grants and loans from ₦50,000 to ₦5,000,000",
            icon: "💰",
        },
        {
            title: "Training & Mentorship",
            description: "Learn from industry experts and successful women entrepreneurs",
            icon: "📚",
        },
        {
            title: "Market Access",
            description: "Connect with buyers and export opportunities",
            icon: "🌍",
        },
        {
            title: "Networking",
            description: "Join a community of 500+ women agripreneurs",
            icon: "👥",
        },
        {
            title: "Technical Support",
            description: "Get expert guidance on farming techniques and processing",
            icon: "🔧",
        },
        {
            title: "Cooperative Benefits",
            description: "Access group savings and collective bargaining",
            icon: "🤝",
        },
    ];

    const handleInputChange = (
        e: React.ChangeEvent<
            HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >
    ) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Hero Section */}
                <div className="bg-linear-to-br from-pink-600 to-purple-700 text-white rounded-3xl p-12 mb-8 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
                    <div className="relative max-w-3xl">
                        <div className="flex items-center gap-3 mb-4">
                            <Heart className="w-12 h-12" />
                            <h1 className="text-4xl font-bold">WAVE Program</h1>
                        </div>
                        <h2 className="text-2xl font-semibold mb-4">
                            Women Agripreneurs Value-creation Empowerment
                        </h2>
                        <p className="text-lg text-pink-100 mb-8">
                            Empowering Nigerian women farmers through funding, training, mentorship,
                            and market access. Join our community of successful women agripreneurs
                            transforming agriculture across Nigeria.
                        </p>
                        <button
                            onClick={() => setIsApplicationModalOpen(true)}
                            className="px-8 py-4 bg-white text-pink-600 font-bold rounded-xl hover:scale-105 transition-transform elevation-3"
                        >
                            Apply Now
                        </button>
                    </div>
                </div>

                {/* Benefits Grid */}
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        Program Benefits
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {benefits.map((benefit, index) => (
                            <div
                                key={index}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="text-4xl mb-4">{benefit.icon}</div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
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
                        Application Process
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {[
                            {
                                step: "1",
                                title: "Submit Application",
                                description: "Fill out the online application form",
                            },
                            {
                                step: "2",
                                title: "Review & Interview",
                                description: "Attend interview and site visit",
                            },
                            {
                                step: "3",
                                title: "Committee Approval",
                                description: "Application reviewed by selection committee",
                            },
                            {
                                step: "4",
                                title: "Funding & Training",
                                description: "Receive funds and begin training program",
                            },
                        ].map((item, index) => (
                            <div key={index} className="text-center">
                                <div className="w-16 h-16 rounded-full bg-pink-600 text-white text-2xl font-bold flex items-center justify-center mx-auto mb-4">
                                    {item.step}
                                </div>
                                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                                    {item.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {item.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* FAQs */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        Frequently Asked Questions
                    </h2>
                    <Accordion items={faqs} />
                </div>
            </div>

            {/* Application Modal */}
            <Modal
                isOpen={isApplicationModalOpen}
                onClose={() => setIsApplicationModalOpen(false)}
                title="Apply to WAVE Program"
            >
                <form action={formAction} className="space-y-4">
                    {/* Server error display */}
                    {state.error && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                            <p className="text-sm text-red-200">{state.error}</p>
                        </div>
                    )}

                    {/* Success message */}
                    {state.success && state.message && (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
                            <CheckCircle className="w-5 h-5 text-green-300 shrink-0 mt-0.5" />
                            <p className="text-sm text-green-200">{state.message}</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Full Name *
                        </label>
                        <input
                            type="text"
                            name="fullName"
                            value={formData.fullName}
                            onChange={handleInputChange}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="Enter your full name"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Email Address *
                        </label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="your.email@example.com"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Phone Number *
                        </label>
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleInputChange}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="+234 XXX XXX XXXX"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Gender Confirmation *
                        </label>
                        <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl p-4">
                            <input
                                type="hidden"
                                name="gender"
                                value="female"
                            />
                            <div className="flex items-center gap-3">
                                <input
                                    type="radio"
                                    id="gender-female"
                                    checked={true}
                                    readOnly
                                    className="w-4 h-4 accent-pink-600"
                                />
                                <label htmlFor="gender-female" className="text-sm font-medium text-slate-900 dark:text-white">
                                    I confirm I am a female entrepreneur
                                </label>
                            </div>
                            <p className="text-xs text-pink-600 dark:text-pink-400 mt-2">
                                ℹ️ WAVE Program is exclusively for women agripreneurs
                            </p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Business Name *
                        </label>
                        <input
                            type="text"
                            name="businessName"
                            value={formData.businessName}
                            onChange={handleInputChange}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="e.g., Amina's Organic Farms"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Type of Agricultural Business *
                        </label>
                        <select
                            name="businessType"
                            value={formData.businessType}
                            onChange={handleInputChange}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-pink-600"
                        >
                            <option value="">Select business type</option>
                            <option value="farming">Farming/Crop Production</option>
                            <option value="processing">Food Processing</option>
                            <option value="trading">Agricultural Trading</option>
                            <option value="other">Other</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Years in Business *
                        </label>
                        <input
                            type="number"
                            name="yearsInBusiness"
                            value={formData.yearsInBusiness}
                            onChange={handleInputChange}
                            required
                            min="0"
                            max="100"
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="0"
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Enter 0 if just starting
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Why are you applying to the WAVE Program? *
                        </label>
                        <textarea
                            name="reasonForApplying"
                            value={formData.reasonForApplying}
                            onChange={handleInputChange}
                            required
                            rows={5}
                            minLength={50}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-600"
                            placeholder="Please explain your business goals, challenges you face, and how WAVE Program support would help you grow... (minimum 50 characters)"
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formData.reasonForApplying.length}/50 characters minimum
                        </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={() => setIsApplicationModalOpen(false)}
                            className="flex-1 px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 px-6 py-3 bg-pink-600 text-white font-semibold rounded-xl hover:bg-pink-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    Submit Application
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
