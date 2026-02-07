"use client";

import { useState, useEffect } from "react";
import { Upload, Download, Trash2, FileText, Loader2, Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";

interface Certificate {
    id: string;
    userId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    uploadedBy: string;
    uploadedAt: Date;
}

export default function CertificatesPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        fetchCertificates();
    }, []);

    const fetchCertificates = async () => {
        try {
            const response = await fetch("/api/certificates");
            const data = await response.json();

            if (data.success) {
                setCertificates(data.certificates || []);
            }
        } catch (error) {
            console.error("Failed to fetch certificates:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            showToast("Only PDF and images are allowed", "error");
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showToast("File size must be less than 5MB", "error");
            return;
        }

        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/certificates/upload", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data.success) {
                showToast("Certificate uploaded successfully", "success");
                fetchCertificates();
            } else {
                showToast(data.error || "Upload failed", "error");
            }
        } catch (error) {
            showToast("Upload failed", "error");
        } finally {
            setIsUploading(false);
        }
    };

    const handleDownload = async (certificate: Certificate) => {
        try {
            const response = await fetch(`/api/certificates/download?id=${certificate.id}`);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = certificate.fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            showToast("Download failed", "error");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this certificate?")) {
            return;
        }

        try {
            const response = await fetch(`/api/certificates/${id}`, {
                method: "DELETE",
            });

            const data = await response.json();

            if (data.success) {
                showToast("Certificate deleted", "success");
                fetchCertificates();
            } else {
                showToast("Delete failed", "error");
            }
        } catch (error) {
            showToast("Delete failed", "error");
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        My Certificates
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">
                        Manage your certificates and documents
                    </p>
                </div>

                {/* Upload Section */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                        Upload Certificate
                    </h2>
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 transition">
                        <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleUpload}
                            disabled={isUploading}
                            className="hidden"
                        />
                        {isUploading ? (
                            <>
                                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                                <p className="text-slate-600 dark:text-slate-400">Uploading...</p>
                            </>
                        ) : (
                            <>
                                <Plus className="w-12 h-12 text-slate-400 mb-4" />
                                <p className="text-slate-900 dark:text-white font-semibold mb-2">
                                    Click to upload
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    PDF, JPG, or PNG (max 5MB)
                                </p>
                            </>
                        )}
                    </label>
                </div>

                {/* Certificates List */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                        Your Certificates ({certificates.length})
                    </h2>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                        </div>
                    ) : certificates.length === 0 ? (
                        <div className="text-center py-12">
                            <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <p className="text-slate-600 dark:text-slate-400">
                                No certificates yet. Upload your first certificate above.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {certificates.map((cert) => (
                                <div
                                    key={cert.id}
                                    className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-500 dark:hover:border-blue-400 transition"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                                            <FileText className="w-6 h-6 text-blue-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                                {cert.fileName}
                                            </h3>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                Uploaded {new Date(cert.uploadedAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleDownload(cert)}
                                            className="p-2 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition"
                                            title="Download"
                                        >
                                            <Download className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(cert.id)}
                                            className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg transition"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
