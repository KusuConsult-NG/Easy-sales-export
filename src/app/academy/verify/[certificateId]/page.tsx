"use client";

import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Award, Calendar, User, BookOpen } from "lucide-react";
import Link from "next/link";

type CertificateVerification = {
    id: string;
    userName: string;
    courseTitle: string;
    completionDate: Date;
    grade?: number;
    isValid: boolean;
};

export default function CertificateVerificationPage({ params }: { params: { certificateId: string } }) {
    const [verification, setVerification] = useState<CertificateVerification | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        verifyCertificate();
    }, []);

    const verifyCertificate = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/academy/verify/${params.certificateId}`);
            const data = await response.json();

            if (data.success) {
                setVerification(data.certificate);
            } else {
                setError(data.message || "Certificate not found");
            }
        } catch (error) {
            setError("Failed to verify certificate");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Verifying certificate...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12">
            <div className="max-w-2xl mx-auto px-4">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
                    {error || !verification ? (
                        <div className="p-12 text-center">
                            <div className="w-24 h-24 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                                <XCircle className="w-16 h-16 text-red-600" />
                            </div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">
                                Certificate Not Found
                            </h1>
                            <p className="text-slate-600 dark:text-slate-400 mb-8">
                                {error || "This certificate ID does not exist in our records."}
                            </p>
                            <Link
                                href="/academy"
                                className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all"
                            >
                                Back to Academy
                            </Link>
                        </div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className="bg-linear-to-r from-green-500 to-green-600 p-8 text-white text-center">
                                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle className="w-16 h-16 text-green-600" />
                                </div>
                                <h1 className="text-3xl font-bold mb-2">Certificate Verified</h1>
                                <p className="text-green-100">This certificate is authentic and valid</p>
                            </div>

                            {/* Certificate Details */}
                            <div className="p-8 space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 text-center">
                                        Certificate Details
                                    </h2>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center shrink-0">
                                            <User className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Recipient</p>
                                            <p className="font-bold text-lg text-slate-900 dark:text-white">
                                                {verification.userName}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center shrink-0">
                                            <BookOpen className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Course</p>
                                            <p className="font-bold text-lg text-slate-900 dark:text-white">
                                                {verification.courseTitle}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center shrink-0">
                                            <Calendar className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Completion Date</p>
                                            <p className="font-bold text-lg text-slate-900 dark:text-white">
                                                {new Date(verification.completionDate).toLocaleDateString('en-US', {
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric'
                                                })}
                                            </p>
                                        </div>
                                    </div>

                                    {verification.grade && (
                                        <div className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center shrink-0">
                                                <Award className="w-5 h-5 text-primary" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Final Grade</p>
                                                <p className="font-bold text-lg text-green-600">
                                                    {verification.grade}%
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center shrink-0">
                                            <CheckCircle className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Certificate ID</p>
                                            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                                                {verification.id.toUpperCase()}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Issued By */}
                                <div className="pt-6 border-t border-slate-200 dark:border-slate-700 text-center">
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Issued by</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                                        Easy Sales Export Academy
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Empowering African Exporters
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-4 pt-4">
                                    <Link
                                        href={`/academy/certificate/${verification.id}`}
                                        className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all text-center"
                                    >
                                        View Certificate
                                    </Link>
                                    <Link
                                        href="/academy"
                                        className="flex-1 px-6 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-all text-center"
                                    >
                                        Explore Academy
                                    </Link>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Security Notice */}
                <div className="mt-8 text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        🔒 This verification was performed securely using blockchain-verified records
                    </p>
                </div>
            </div>
        </div>
    );
}
