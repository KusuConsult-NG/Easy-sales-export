"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Search,
    HelpCircle,
    Book,
    MessageSquare,
    Mail,
    ChevronDown,
    ChevronUp,
    Youtube,
    FileText,
    Users,
    ShoppingCart,
    Wheat,
    GraduationCap,
    Leaf,
    Building,
    Home,
} from "lucide-react";

const faqs = [
    {
        category: "General",
        icon: HelpCircle,
        questions: [
            {
                q: "What is Easy Sales Export Platform?",
                a: "Easy Sales Export is a comprehensive multi-module platform connecting Nigerian exporters, farmers, learners, and cooperatives with global opportunities, microfinance services, and agricultural resources. It includes 7 core modules: Export Windows, Farm Nation, Marketplace, Academy, WAVE, Cooperatives, and Admin Suite."
            },
            {
                q: "How do I create an account?",
                a: "Click 'Get Started' or 'Register' on any module. You'll need to provide your email, create a password, and verify your email address. Different modules may require additional verification based on your role."
            },
            {
                q: "Is my data secure?",
                /*
                 * #334. This said "We use Firebase Authentication".
                 *
                 * Firebase is the FALLBACK, not the authenticator. lib/auth.ts
                 * signs you in against Supabase Auth and only reaches for
                 * Firebase when that fails, to migrate a legacy account — its
                 * own comment says "Supabase is the primary authenticator", and
                 * a deployment with no Firebase credential configured is a
                 * supported one that simply has no fallback. So the page named
                 * the one component a deployment may not have at all, and did
                 * not name the one that actually checks the password.
                 */
                a: "Yes. Sign-in is handled by Supabase Auth over encrypted connections (HTTPS), sessions are signed, and we follow industry-standard security practices. Your payment information is processed securely through Paystack — we never store your card details."
            },
        ]
    },
    {
        category: "Marketplace",
        icon: ShoppingCart,
        questions: [
            {
                q: "How do I make a purchase?",
                /*
                 *   #334 THIS PAGE DESCRIBED A CHECKOUT THE PRODUCT DOES NOT
                 *        HAVE, AND A MANUAL VERIFICATION NOBODY PERFORMS.
                 *
                 *        It said: "choose between Paystack (card payment) or
                 *        Bank Transfer. For bank transfers, send payment to the
                 *        provided account details and your order will be
                 *        verified within 24 hours."
                 *
                 *        Bank transfer is not missing — but it is not a CHOICE
                 *        the platform offers, and there is no 24-hour manual
                 *        verification behind it. Paystack's own payment page
                 *        accepts it: initializePaystackPayment defaults to
                 *        channels ["card","bank_transfer","bank","ussd"] and
                 *        _payment_orders.ts passes no override, so Paystack
                 *        issues the account and confirms the transfer itself,
                 *        automatically. The platform never sees an account
                 *        number and has nothing to verify.
                 *
                 *        What the page described — pick a method here, then
                 *        send money to details we give you, then wait a day for
                 *        a human — matches nothing in the code. A buyer
                 *        following it would hunt for an option that is not on
                 *        the screen, and then wait for a confirmation step that
                 *        does not exist. The two are not the same promise, and
                 *        the difference is where a buyer's money sits.
                 *
                 *        THERE IS NO CHOOSER AT ALL. Both checkouts declare
                 *
                 *            useState<"paystack">("paystack")
                 *
                 *        — marketplace/checkout and export/buyer/cart — a union
                 *        with ONE member, and `setPaymentMethod` is never called
                 *        anywhere in the codebase. The checkout submits to
                 *        initializeOrderPaymentAction and nothing else. The only
                 *        bank details the marketplace holds are the SELLER's,
                 *        collected at onboarding; no screen has ever shown a
                 *        buyer an account to pay into.
                 *
                 *        A buyer following this would look for an option that is
                 *        not there — or, worse, transfer money to an account
                 *        found somewhere else on the strength of it.
                 *
                 *        THE FEATURE IS THREE-QUARTERS BUILT, WHICH IS WHY THE
                 *        COPY LOOKS PLAUSIBLE. _payment_orders.ts exports
                 *        createBankTransferOrderAction and
                 *        createPaymentOnDeliveryOrderAction: session-guarded,
                 *        cart-validated, fee-calculated, #272 bounds-checked,
                 *        writing paymentMethod "bank_transfer" and
                 *        "payment_on_delivery" and reserving stock
                 *        (lib/order-status.ts documents both). NO SCREEN CALLS
                 *        EITHER. And the three layers do not even agree on the
                 *        vocabulary: lib/validations/marketplace.ts accepts
                 *        ["escrow","wallet","payment_on_delivery"] — so
                 *        "bank_transfer" is not a value the checkout schema
                 *        would take — while marketplace-notifications.ts renders
                 *        a "Pay on Delivery" label for a method no buyer can
                 *        select.
                 *
                 *        The copy is corrected to what the product does. Whether
                 *        to WIRE those two creators or retire them is a product
                 *        decision and is recorded for the owner, not made here.
                 */
                a: "Browse products, add items to your cart, and proceed to checkout. Enter your delivery address, then pay through Paystack — its payment page accepts card, bank transfer, USSD and direct bank. Your payment is held in escrow. When your order arrives, open it under Marketplace → My Orders and click 'Confirm Receipt' to mark it delivered; the platform then releases the payment to the seller."
            },
            {
                q: "What if I have an issue with my order?",
                a: "Go to Dashboard → Orders, find your order, and click 'Open Dispute'. You can describe the issue and upload evidence (photos, documents). Our admin team will review and resolve within 3-5 business days."
            },
            {
                q: "How do I track my order?",
                a: "Visit Dashboard → Orders to see all your orders and their current status (pending, processing, shipped, delivered)."
            },
        ]
    },
    {
        category: "Farm Nation",
        icon: Wheat,
        questions: [
            {
                q: "How do I list my land for sale?",
                a: "Go to Farm Nation → List Land, fill in property details (location, size, price, amenities), upload photos, and submit. Your listing will be reviewed by our verification team before going live."
            },
            {
                q: "What is the verification process?",
                a: "Our admin team verifies ownership documents, location accuracy, and property details. This typically takes 2-3 business days. You'll receive an email notification once approved."
            },
            {
                q: "Can I edit my property listing?",
                a: "Yes! Go to Farm Nation → My Properties, find your listing, and click 'Edit' to update details, photos, or pricing."
            },
        ]
    },
    {
        category: "Academy",
        icon: GraduationCap,
        questions: [
            {
                q: "How do I enroll in a course?",
                a: "Browse the Academy page, click on a course, review the curriculum, and click 'Enroll Now'. Some courses may require payment via Paystack."
            },
            {
                q: "Can I get a certificate?",
                /*
                 * #334. This promised "pass the final quiz with 70%+ score".
                 *
                 * There is no 70% rule. Each quiz carries its own passingScore
                 * and QuizComponent prints it on the quiz itself ("Passing
                 * score: N%"). The platform's DEFAULT is 95, not 70:
                 * _ac_progress.ts grades with `quiz?.passingScore ?? 95` and
                 * _ac_quiz.ts stores 95 for a module that never had one — the
                 * two are deliberately aligned, and its comment says so. The
                 * only 70 anywhere is the admin quiz builder's blank-form
                 * default, a starting value an author types over.
                 *
                 * So a learner could be told 70 and meet a 95 bar. The figure
                 * is removed rather than changed to 95: the number is per-quiz
                 * and is already shown on the quiz, which is the one place it
                 * cannot go stale.
                 */
                a: "Yes. Complete all lessons and pass each module quiz at the passing score shown on that quiz. Your certificate is generated automatically and available for download in Dashboard → Certificates."
            },
            {
                q: "Are courses self-paced?",
                a: "Most courses are self-paced, but some may have scheduled live sessions. Check the course details for specific information."
            },
        ]
    },
    {
        category: "WAVE Program",
        icon: Leaf,
        questions: [
            {
                q: "What is RH-WAVE 774?",
                a: "The Women Agro-Value Expansion Programme is Nigeria's flagship initiative to empower women in agriculture across all 774 Local Government Areas, launched June 2025."
            },
            {
                q: "How do I apply?",
                a: "Visit the WAVE landing page and click 'Apply Now'. Complete the multi-step application form with personal details, business information, and financial data."
            },
            {
                q: "How long does the application process take?",
                a: "Application review typically takes 5-7 business days. You'll be notified via email about your application status."
            },
        ]
    },
    {
        category: "Cooperatives",
        icon: Building,
        questions: [
            {
                q: "How do I join a cooperative?",
                a: "Navigate to Cooperatives, browse available cooperatives, and click 'Join'. You'll need to provide member information and may need to make an initial contribution."
            },
            {
                q: "How do I apply for a loan?",
                a: "From your Cooperatives dashboard, go to Loans → Apply. Specify the amount, purpose, and repayment period. Loans are subject to admin approval."
            },
            {
                q: "How do I make contributions?",
                a: "Go to Cooperatives → Contributions, enter the amount, and pay via Paystack. Your contribution will be reflected in your member dashboard."
            },
        ]
    },
];

const resources = [
    {
        title: "Getting Started Guide",
        description: "Complete walkthrough for new users",
        icon: Book,
        link: "#"
    },
    {
        title: "Video Tutorials",
        description: "Watch step-by-step guides",
        icon: Youtube,
        link: "#"
    },
    // "API Documentation" was removed rather than relinked. It pointed at
    // /help/api-docs, which is not a route — there is no /help segment beyond
    // this page — so the card 404'd. There is no API documentation to link to
    // and this platform exposes no public API, so advertising it and sending
    // people nowhere is worse than not offering it.
    //
    // Deliberately NOT changed to "#" like its three siblings: an inert card
    // that looks clickable is the same defect this audit removed from the admin
    // and cooperative screens. Those three placeholders are a content gap —
    // real pages someone intends to write — and are left for the owner rather
    // than quietly deleted here.
    {
        title: "Community Forum",
        description: "Connect with other users",
        icon: Users,
        link: "#"
    },
];

export default function HelpCenterPage() {
    const [searchQuery, setSearchQuery] = useState("");
    const [expandedQuestions, setExpandedQuestions] = useState<string[]>([]);

    const toggleQuestion = (questionId: string) => {
        setExpandedQuestions(prev =>
            prev.includes(questionId)
                ? prev.filter(id => id !== questionId)
                : [...prev, questionId]
        );
    };

    const filteredFaqs = faqs.map(category => ({
        ...category,
        questions: category.questions.filter(q =>
            q.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
            q.a.toLowerCase().includes(searchQuery.toLowerCase())
        )
    })).filter(category => category.questions.length > 0);

    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 py-12">
            <div className="max-w-6xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-12">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-primary mb-6 transition"
                    >
                        <Home className="w-4 h-4" />
                        Back to Home
                    </Link>
                    <h1 className="text-5xl font-bold text-slate-900 mb-4">
                        How can we help you?
                    </h1>
                    <p className="text-xl text-slate-600">
                        Search our knowledge base or browse FAQs
                    </p>
                </div>

                {/* Search Bar */}
                <div className="max-w-2xl mx-auto mb-12">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search for answers..."
                            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-slate-900 focus:ring-2 focus:ring-primary focus:border-primary shadow-lg"
                        />
                    </div>
                </div>

                {/* Resources Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {resources.map((resource) => (
                        <Link
                            key={resource.title}
                            href={resource.link}
                            className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 border border-slate-200"
                        >
                            <resource.icon className="w-10 h-10 text-primary mb-3" />
                            <h3 className="font-bold text-slate-900 mb-2">
                                {resource.title}
                            </h3>
                            <p className="text-sm text-slate-600">
                                {resource.description}
                            </p>
                        </Link>
                    ))}
                </div>

                {/* FAQs */}
                <div className="mb-12">
                    <h2 className="text-3xl font-bold text-slate-900 text-center mb-8">
                        Frequently Asked Questions
                    </h2>

                    <div className="space-y-8">
                        {filteredFaqs.map((category) => (
                            <div key={category.category}>
                                <div className="flex items-center gap-3 mb-4">
                                    <category.icon className="w-6 h-6 text-primary" />
                                    <h3 className="text-2xl font-bold text-slate-900">
                                        {category.category}
                                    </h3>
                                </div>

                                <div className="space-y-3">
                                    {category.questions.map((faq, idx) => {
                                        const questionId = `${category.category}-${idx}`;
                                        const isExpanded = expandedQuestions.includes(questionId);

                                        return (
                                            <div
                                                key={questionId}
                                                className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden"
                                            >
                                                <button
                                                    onClick={() => toggleQuestion(questionId)}
                                                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition"
                                                >
                                                    <span className="font-semibold text-slate-900">
                                                        {faq.q}
                                                    </span>
                                                    {isExpanded ? (
                                                        <ChevronUp className="w-5 h-5 text-primary shrink-0" />
                                                    ) : (
                                                        <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />
                                                    )}
                                                </button>
                                                {isExpanded && (
                                                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
                                                        <p className="text-slate-900">
                                                            {faq.a}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {filteredFaqs.length === 0 && searchQuery && (
                        <div className="text-center py-12">
                            <p className="text-slate-600 mb-4">
                                No results found for "{searchQuery}"
                            </p>
                            <button
                                onClick={() => setSearchQuery("")}
                                className="text-primary hover:underline"
                            >
                                Clear search
                            </button>
                        </div>
                    )}
                </div>

                {/* Contact Support */}
                <div className="bg-linear-to-r from-primary to-blue-600 rounded-2xl p-8 text-center text-white shadow-xl">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold mb-2">Still need help?</h3>
                    <p className="mb-6 text-blue-100">
                        Our support team is here to assist you
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <a
                            href="mailto:info@easysalesexport.com"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-primary font-semibold rounded-xl hover:bg-blue-50 transition"
                        >
                            <Mail className="w-5 h-5" />
                            Email Support
                        </a>
                        <Link
                            href="/contact"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 border-2 border-white text-white font-semibold rounded-xl hover:bg-white/10 transition"
                        >
                            <MessageSquare className="w-5 h-5" />
                            Contact Us
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
