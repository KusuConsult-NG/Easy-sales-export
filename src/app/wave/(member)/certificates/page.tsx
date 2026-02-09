/**
 * WAVE Certificates Page
 * 
 * Displays member's earned certificates from training, milestones, and achievements
 */

import { Award, Download, Share2, Calendar, CheckCircle, TrendingUp, BookOpen, Star } from "lucide-react";
import Link from "next/link";

// Mock certificate data - will be replaced with Firestore data later
const mockCertificates = [
    {
        id: "cert-1",
        type: "training" as const,
        name: "Agricultural Business Fundamentals",
        description: "Completed comprehensive training on agricultural business management",
        issuedDate: "2024-01-15",
        icon: BookOpen,
        color: "bg-blue-600"
    },
    {
        id: "cert-2",
        type: "milestone" as const,
        name: "First Product Sale",
        description: "Successfully completed your first product sale through the WAVE platform",
        issuedDate: "2024-02-01",
        icon: TrendingUp,
        color: "bg-green-600"
    },
    {
        id: "cert-3",
        type: "program" as const,
        name: "WAVE Program Completion - Phase 1",
        description: "Successfully completed Phase 1 of the WAVE empowerment program",
        issuedDate: "2024-03-10",
        icon: Award,
        color: "bg-purple-600"
    },
];

export default function CertificatesPage() {
    const hasCertificates = mockCertificates.length > 0;

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
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">3</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Training</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">2</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Milestones</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-xl flex items-center justify-center">
                            <Award className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">1</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Program</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/20 rounded-xl flex items-center justify-center">
                            <Star className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">0</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Recognition</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Certificates Grid or Empty State */}
            {hasCertificates ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Your Certificates ({mockCertificates.length})
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
                        {mockCertificates.map((cert) => {
                            const Icon = cert.icon;
                            return (
                                <div
                                    key={cert.id}
                                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 hover:shadow-lg transition-shadow"
                                >
                                    {/* Certificate Header */}
                                    <div className="flex items-start gap-4 mb-4">
                                        <div className={`w-14 h-14 ${cert.color} rounded-xl flex items-center justify-center shrink-0`}>
                                            <Icon className="w-7 h-7 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1">
                                                {cert.name}
                                            </h3>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                {cert.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Certificate Meta */}
                                    <div className="flex items-center gap-2 mb-4 text-sm text-slate-600 dark:text-slate-400">
                                        <Calendar className="w-4 h-4" />
                                        <span>Issued on {new Date(cert.issuedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                                        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 ml-2" />
                                        <span className="text-green-600 dark:text-green-400 font-medium">Verified</span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-3">
                                        <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg transition-colors">
                                            <Download className="w-4 h-4" />
                                            Download PDF
                                        </button>
                                        <button className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors">
                                            <Share2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
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
                        className="inline-flex items-center gap-2 px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg transition-colors"
                    >
                        <BookOpen className="w-5 h-5" />
                        Start Training
                    </Link>
                </div>
            )}

            {/* Information Card */}
            <div className="bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-900/10 dark:to-pink-900/10 border border-rose-200 dark:border-rose-800 rounded-2xl p-6">
                <div className="flex gap-4">
                    <div className="w-12 h-12 bg-rose-600 rounded-xl flex items-center justify-center shrink-0">
                        <Star className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
                            How to Earn Certificates
                        </h4>
                        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                            <li className="flex items-start gap-2">
                                <span className="text-rose-600 dark:text-rose-400">•</span>
                                <span>Complete training courses and assessments</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-rose-600 dark:text-rose-400">•</span>
                                <span>Achieve business milestones (first sale, revenue targets, etc.)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-rose-600 dark:text-rose-400">•</span>
                                <span>Successfully complete WAVE program phases</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-rose-600 dark:text-rose-400">•</span>
                                <span>Receive special recognition for outstanding contributions</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
