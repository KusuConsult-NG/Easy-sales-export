"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, MessageSquare, Calendar, ChevronRight } from "lucide-react";
import { getLandInquiriesAction } from "@/app/actions/land-listings";
import Link from "next/link";
import { formatLocalDate } from "@/lib/date-utils";

export default function InquiriesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [inquiries, setInquiries] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/farm-nation");
            return;
        }

        async function loadInquiries() {
            if (session?.user?.id) {
                const result = await getLandInquiriesAction(session.user.id);
                if (result.success && result.data) {
                    setInquiries(result.data);
                } else {
                    setError(result.error || "Failed to load inquiries");
                }
                setLoading(false);
            }
        }

        if (status === "authenticated") {
            loadInquiries();
        }
    }, [status, session, router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <MessageSquare className="w-8 h-8 text-green-600" />
                        Buyer Inquiries
                    </h1>
                    <p className="text-slate-600 mt-2">
                        Manage inquiries from potential buyers for your land listings.
                    </p>
                </div>

                {inquiries.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
                        <MessageSquare className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">No Inquiries Yet</h3>
                        <p className="text-slate-600">
                            You haven't received any inquiries for your properties yet.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                        <ul className="divide-y divide-slate-200">
                            {inquiries.map((inquiry) => (
                                <li key={inquiry.id}>
                                    <Link
                                        href={`/farm-nation/inquiries/${inquiry.id}`}
                                        className="block p-6 hover:bg-slate-50 transition"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1 min-w-0 pr-4">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-sm font-medium text-green-600 truncate">
                                                        {inquiry.listingTitle}
                                                    </p>
                                                    <div className="flex items-center text-xs text-slate-500">
                                                        <Calendar className="w-3 h-3 mr-1" />
                                                        {formatLocalDate(inquiry.createdAt) || 'Just now'}
                                                    </div>
                                                </div>
                                                <h3 className="text-lg font-semibold text-slate-900 truncate">
                                                    {inquiry.buyerName}
                                                </h3>
                                                <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                                                    {inquiry.message}
                                                </p>
                                            </div>
                                            <ChevronRight className="w-5 h-5 text-slate-400" />
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}
