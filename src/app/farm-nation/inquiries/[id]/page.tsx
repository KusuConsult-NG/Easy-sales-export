"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ArrowLeft, Loader2, User, Phone, Mail, MessageSquare, ExternalLink, Calendar
} from "lucide-react";
import { getLandInquiryByIdAction } from "@/app/actions/land-listings";
import Link from "next/link";

export default function InquiryDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const inquiryId = params.id as string;

    const [inquiry, setInquiry] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/farm-nation");
            return;
        }

        async function loadInquiry() {
            if (session?.user?.id) {
                const result = await getLandInquiryByIdAction(inquiryId);
                if (result.success && result.inquiry) {
                    setInquiry(result.inquiry);
                } else {
                    setError(result.error || "Inquiry not found");
                }
                setLoading(false);
            }
        }

        if (status === "authenticated") {
            loadInquiry();
        }
    }, [status, session, inquiryId, router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        );
    }

    if (error || !inquiry) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-red-500 mb-4">{error || "Inquiry not found"}</p>
                    <button
                        onClick={() => router.push("/farm-nation/inquiries")}
                        className="px-6 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                    >
                        Back to Inquiries
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/farm-nation/inquiries")}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition mb-4"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Inquiries
                    </button>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        Inquiry Details
                    </h1>
                </div>

                {/* Content Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden">
                    <div className="p-8 space-y-8">
                        {/* Listing Info */}
                        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-6">
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Inquiry for Property</p>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {inquiry.listingTitle}
                                </h2>
                            </div>
                            <Link
                                href={`/farm-nation/property/${inquiry.listingId}`}
                                className="flex items-center gap-2 text-green-600 hover:text-green-700 font-medium"
                                target="_blank"
                            >
                                View Listing <ExternalLink className="w-4 h-4" />
                            </Link>
                        </div>

                        {/* Buyer Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-full">
                                    <User className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">Buyer Name</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{inquiry.buyerName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-full">
                                    <Calendar className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">Date Received</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">
                                        {inquiry.createdAt?.seconds
                                            ? new Date(inquiry.createdAt.seconds * 1000).toLocaleString()
                                            : 'N/A'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-full">
                                    <Mail className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">Email Address</p>
                                    <a href={`mailto:${inquiry.buyerEmail}`} className="font-semibold text-green-600 hover:text-green-700">
                                        {inquiry.buyerEmail}
                                    </a>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-full">
                                    <Phone className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">Phone Number</p>
                                    <a href={`tel:${inquiry.buyerPhone}`} className="font-semibold text-slate-900 dark:text-white hover:text-blue-600">
                                        {inquiry.buyerPhone}
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Message */}
                        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-4 text-slate-900 dark:text-white font-semibold">
                                <MessageSquare className="w-5 h-5 text-slate-500" />
                                Message
                            </div>
                            <p className="text-slate-600 dark:text-white whitespace-pre-line leading-relaxed">
                                {inquiry.message}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
