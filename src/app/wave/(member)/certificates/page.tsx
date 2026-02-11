/**
 * WAVE Certificates Page
 * 
 * Displays member's earned certificates from training, milestones, and achievements
 */

"use client";

import { useEffect, useState } from "react";
import { Award, Download, Share2, Calendar, CheckCircle, TrendingUp, BookOpen, Star, Loader2 } from "lucide-react";
import Link from "next/link";
import { getCurrentUserCertificatesAction, WaveCertificate } from "@/app/actions/wave";

export default function CertificatesPage() {
    const [certificates, setCertificates] = useState<WaveCertificate[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadCertificates() {
            setLoading(true);
            try {
                const certs = await getCurrentUserCertificatesAction();
                setCertificates(certs);
            } catch (error) {
                console.error("Failed to load certificates:", error);
            } finally {
                setLoading(false);
            }
        }

        loadCertificates();
    }, []);

    // Calculate certificate counts by type
    const certCounts = {
        training: certificates.filter(c => c.certificateType === "training").length,
        achievement: certificates.filter(c => c.certificateType === "achievement").length,
        completion: certificates.filter(c => c.certificateType === "completion").length,
    };

    const hasCertificates = certificates.length > 0;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-12 h-12 animate-spin text-emerald-700" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="space-y-2">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                    My Certificates
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    View and download your earned certificates and achievements
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-xl flex items-center justify-center">
                            <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{certCounts.training}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Training</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-emerald-700 dark:text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{certCounts.achievement}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Milestones</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center">
                            <Award className="w-6 h-6 text-emerald-700 dark:text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{certCounts.completion}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Program</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center">
                            <Star className="w-6 h-6 text-emerald-700 dark:text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{certificates.length}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Total</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Certificates Grid or Empty State */}
            {hasCertificates ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Your Certificates ({certificates.length})
                        </h2>
                        <div className="flex gap-2">
                            <button className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                Filter
                            </button>
                            <button className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                Sort
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {certificates.map((cert) => (
                            <div
                                key={cert.id}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 hover:shadow-lg transition-shadow"
                            >
                                {/* Certificate Header */}
                                <div className="flex items-start gap-4 mb-4">
                                    <div className={`w-14 h-14 ${cert.certificateType === 'training' ? 'bg-blue-600' :
                                            cert.certificateType === 'achievement' ? 'bg-emerald-700' :
                                                'bg-emerald-700'
                                        } rounded-xl flex items-center justify-center shrink-0`}>
                                        {cert.certificateType === 'training' && <BookOpen className="w-7 h-7 text-white" />}
                                        {cert.certificateType === 'achievement' && <TrendingUp className="w-7 h-7 text-white" />}
                                        {cert.certificateType === 'completion' && <Award className="w-7 h-7 text-white" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1">
                                            {cert.programName}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {cert.certificateType.charAt(0).toUpperCase() + cert.certificateType.slice(1)} Certificate
                                        </p>
                                    </div>
                                </div>

                                {/* Certificate Meta */}
                                <div className="flex items-center gap-2 mb-4 text-sm text-slate-600 dark:text-slate-400">
                                    <Calendar className="w-4 h-4" />
                                    <span>Issued on {new Date(cert.issuedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                                    <CheckCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-500 ml-2" />
                                    <span className="text-emerald-700 dark:text-emerald-500 font-medium">Verified</span>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3">
                                    <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors">
                                        <Download className="w-4 h-4" />
                                        Download PDF
                                    </button>
                                    <button className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors">
                                        <Share2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                // Empty State
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center">
                    <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Award className="w-10 h-10 text-slate-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        No Certificates Yet
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                        Complete training courses, achieve milestones, and participate in the WAVE program to earn certificates.
                    </p>
                    <Link
                        href="/wave/training"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
                    >
                        <BookOpen className="w-5 h-5" />
                        Start Training
                    </Link>
                </div>
            )}

            {/* Information Card */}
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-50 dark:from-emerald-900/10 dark:to-emerald-900/10 border border-emerald-300 dark:border-emerald-800 rounded-2xl p-6">
                <div className="flex gap-4">
                    <div className="w-12 h-12 bg-emerald-700 rounded-xl flex items-center justify-center shrink-0">
                        <Star className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
                            How to Earn Certificates
                        </h4>
                        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-700 dark:text-emerald-500">•</span>
                                <span>Complete training courses and assessments</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-700 dark:text-emerald-500">•</span>
                                <span>Achieve business milestones (first sale, revenue targets, etc.)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-700 dark:text-emerald-500">•</span>
                                <span>Successfully complete WAVE program phases</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-700 dark:text-emerald-500">•</span>
                                <span>Receive special recognition for outstanding contributions</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
