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
                a: "Yes! We use Firebase Authentication, encrypted connections (HTTPS), and follow industry-standard security practices. Your payment information is processed securely through Paystack."
            },
        ]
    },
    {
        category: "Marketplace",
        icon: ShoppingCart,
        questions: [
            {
                q: "How do I make a purchase?",
                a: "Browse products, add items to your cart, proceed to checkout, and choose between Paystack (card payment) or Bank Transfer. For bank transfers, send payment to the provided account details and your order will be verified within 24 hours."
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
                a: "Yes! Complete all lessons and pass the final quiz with 70%+ score. Your certificate will be automatically generated and available for download in Dashboard → Certificates."
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
    {
        title: "API Documentation",
        description: "For developers and integrations",
        icon: FileText,
        link: "/help/api-docs"
    },
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
                            href="mailto:support@kusuconsult.ng"
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
