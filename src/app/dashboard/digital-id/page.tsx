"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/auth";
import { generateDigitalIDCard, formatMemberNumber, type DigitalIDCard as DigitalIDCardType } from "@/lib/digital-id";
import DigitalIDCard from "@/components/DigitalIDCard";
import { CreditCard, Loader2 } from "lucide-react";

export default function DigitalIDPage() {
    const [loading, setLoading] = useState(true);
    const [idCard, setIdCard] = useState<DigitalIDCardType | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadDigitalID() {
            try {
                // In a real app, fetch user data from Firestore
                // For now, we'll use mock data
                const mockUserId = "demo-user-12345";
                const mockCreatedAt = new Date("2024-01-15");
                const memberNumber = formatMemberNumber(mockUserId, mockCreatedAt);

                const card = await generateDigitalIDCard(
                    mockUserId,
                    memberNumber,
                    "John Doe",
                    "john.doe@example.com",
                    "exporter",
                    mockCreatedAt
                );

                setIdCard(card);
            } catch (err) {
                console.error("Failed to generate digital ID:", err);
                setError("Failed to load digital ID. Please try again.");
            } finally {
                setLoading(false);
            }
        }

        loadDigitalID();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
                        <p className="text-red-800 dark:text-red-200">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!idCard) {
        return null;
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <CreditCard className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">
                            Digital Member ID
                        </h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Your official Easy Sales Export platform identification
                    </p>
                </div>

                {/* ID Card */}
                <DigitalIDCard
                    memberNumber={idCard.memberNumber}
                    fullName={idCard.fullName}
                    email={idCard.email}
                    role={idCard.role}
                    memberSince={idCard.memberSince}
                    qrCodeDataUrl={idCard.qrCodeDataUrl}
                    expiresAt={idCard.expiresAt}
                />

                {/* Info Section */}
                <div className="mt-8 bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                        About Your Digital ID
                    </h2>
                    <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                        <li className="flex items-start space-x-3">
                            <span className="text-blue-600 font-bold">•</span>
                            <span>
                                <strong>QR Code:</strong> Contains encrypted verification data. Scan
                                at any Easy Sales Export facility for instant verification.
                            </span>
                        </li>
                        <li className="flex items-start space-x-3">
                            <span className="text-blue-600 font-bold">•</span>
                            <span>
                                <strong>Validity:</strong> Your digital ID is valid for 1 year from
                                issue date. Renew automatically by logging in.
                            </span>
                        </li>
                        <li className="flex items-start space-x-3">
                            <span className="text-blue-600 font-bold">•</span>
                            <span>
                                <strong>Downloads:</strong> Save as PNG for mobile or PDF for
                                printing. Keep a copy for offline verification.
                            </span>
                        </li>
                        <li className="flex items-start space-x-3">
                            <span className="text-blue-600 font-bold">•</span>
                            <span>
                                <strong>Security:</strong> QR code expires after 1 year and cannot
                                be duplicated. Each scan is logged in our audit system.
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
