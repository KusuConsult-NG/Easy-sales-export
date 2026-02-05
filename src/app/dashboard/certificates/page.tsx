"use client";

import { useState, useEffect } from "react";
import { Upload, FileText, Download, Trash2, Plus, Calendar, Building } from "lucide-react";
import type { Certificate } from "@/app/actions/certificates";

export default function CertificatesPage() {
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [loading, setLoading] = useState(true);
    const [showUploadModal, setShowUploadModal] = useState(false);

    useEffect(() => {
        // Mock data for demonstration
        setCertificates([
            {
                id: "1",
                userId: "demo-user",
                fileName: "Export_License_2024.pdf",
                fileUrl: "#",
                fileType: "application/pdf",
                certificateType: "license",
                issueDate: new Date("2024-01-15"),
                expiryDate: new Date("2025-01-14"),
                issuer: "Nigerian Export Promotion Council",
                uploadedAt: { seconds: Date.now() / 1000 } as any,
                size: 2048000,
            },
        ]);
        setLoading(false);
    }, []);

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    };

    const getCertificateTypeColor = (type: string) => {
        const colors = {
            training: "bg-blue-100 text-blue-800",
            license: "bg-emerald-100 text-emerald-800",
            accreditation: "bg-purple-100 text-purple-800",
            other: "bg-slate-100 text-slate-800",
        };
        return colors[type as keyof typeof colors] || colors.other;
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                            My Certificates
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Manage your licenses, training certificates, and accreditations
                        </p>
                    </div>
                    <button
                        onClick={() => setShowUploadModal(true)}
                        className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition shadow-lg shadow-blue-500/30"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Upload Certificate</span>
                    </button>
                </div>

                {/* Certificates Grid */}
                {certificates.length === 0 ? (
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-12 text-center shadow-sm">
                        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No certificates uploaded
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            Upload your first certificate to get started
                        </p>
                        <button
                            onClick={() => setShowUploadModal(true)}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                        >
                            Upload Certificate
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {certificates.map((cert) => (
                            <div
                                key={cert.id}
                                className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm hover:shadow-lg transition"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <FileText className="w-10 h-10 text-blue-600" />
                                    <span
                                        className={`px-3 py-1 rounded-full text-xs font-semibold ${getCertificateTypeColor(
                                            cert.certificateType
                                        )}`}
                                    >
                                        {cert.certificateType}
                                    </span>
                                </div>

                                <h3 className="font-semibold text-slate-900 dark:text-white mb-2 truncate">
                                    {cert.fileName}
                                </h3>

                                {cert.issuer && (
                                    <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
                                        <Building className="w-4 h-4" />
                                        <span className="truncate">{cert.issuer}</span>
                                    </div>
                                )}

                                {cert.expiryDate && (
                                    <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                                        <Calendar className="w-4 h-4" />
                                        <span>
                                            Expires: {new Date(cert.expiryDate).toLocaleDateString()}
                                        </span>
                                    </div>
                                )}

                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                    {formatFileSize(cert.size)}
                                </div>

                                <div className="flex space-x-2">
                                    <button className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg font-medium transition">
                                        <Download className="w-4 h-4" />
                                        <span>Download</span>
                                    </button>
                                    <button className="px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg transition">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Upload Modal */}
                {showUploadModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 p-8">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Upload Certificate
                            </h2>

                            <form className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Certificate Type
                                    </label>
                                    <select className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white">
                                        <option value="training">Training Certificate</option>
                                        <option value="license">License</option>
                                        <option value="accreditation">Accreditation</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Upload File
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center">
                                        <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                        <p className="text-slate-600 dark:text-slate-400 mb-2">
                                            Drop your file here or click to browse
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-500">
                                            PDF, JPG, PNG (Max 10MB)
                                        </p>
                                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Issue Date
                                        </label>
                                        <input
                                            type="date"
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Expiry Date
                                        </label>
                                        <input
                                            type="date"
                                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Issuing Organization
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Nigerian Export Promotion Council"
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                                    />
                                </div>

                                <div className="flex justify-end space-x-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowUploadModal(false)}
                                        className="px-6 py-3 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-semibold transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                                    >
                                        Upload Certificate
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
