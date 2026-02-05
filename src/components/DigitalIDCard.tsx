"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

interface DigitalIDCardProps {
    memberNumber: string;
    fullName: string;
    email: string;
    role: string;
    memberSince: Date;
    qrCodeDataUrl: string;
    expiresAt: Date;
}

export default function DigitalIDCard({
    memberNumber,
    fullName,
    email,
    role,
    memberSince,
    qrCodeDataUrl,
    expiresAt,
}: DigitalIDCardProps) {
    const [downloading, setDownloading] = useState(false);

    const downloadAsPNG = async () => {
        setDownloading(true);
        try {
            const cardElement = document.getElementById("digital-id-card");
            if (!cardElement) return;

            const canvas = await html2canvas(cardElement, {
                scale: 2,
                backgroundColor: null,
            });

            const link = document.createElement("a");
            link.download = `digital-id-${memberNumber}.png`;
            link.href = canvas.toDataURL();
            link.click();
        } catch (error) {
            console.error("Failed to download PNG:", error);
        } finally {
            setDownloading(false);
        }
    };

    const downloadAsPDF = async () => {
        setDownloading(true);
        try {
            const cardElement = document.getElementById("digital-id-card");
            if (!cardElement) return;

            const canvas = await html2canvas(cardElement, {
                scale: 2,
                backgroundColor: "#ffffff",
            });

            const imgData = canvas.toDataURL("image/png");
            const pdf = new jsPDF({
                orientation: "landscape",
                unit: "px",
                format: [canvas.width, canvas.height],
            });

            pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
            pdf.save(`digital-id-${memberNumber}.pdf`);
        } catch (error) {
            console.error("Failed to download PDF:", error);
        } finally {
            setDownloading(false);
        }
    };

    const roleColors = {
        member: "bg-blue-500",
        exporter: "bg-emerald-500",
        admin: "bg-purple-500",
        super_admin: "bg-red-500",
        vendor: "bg-amber-500",
    };

    const roleColor = roleColors[role as keyof typeof roleColors] || roleColors.member;

    return (
        <div className="space-y-6">
            {/* Digital ID Card */}
            <div
                id="digital-id-card"
                className="relative bg-linear-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl p-8 shadow-2xl max-w-2xl mx-auto"
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                        <ShieldCheck className="w-8 h-8 text-white" />
                        <div>
                            <h2 className="text-white font-bold text-xl">Easy Sales Export</h2>
                            <p className="text-blue-200 text-sm">Digital Member ID</p>
                        </div>
                    </div>
                    <div className={`px-4 py-2 rounded-lg ${roleColor} text-white text-sm font-semibold uppercase`}>
                        {role.replace("_", " ")}
                    </div>
                </div>

                {/* Card Content */}
                <div className="grid grid-cols-3 gap-6">
                    {/* Member Info */}
                    <div className="col-span-2 space-y-4">
                        <div>
                            <p className="text-blue-200 text-sm mb-1">Member Number</p>
                            <p className="text-white font-mono text-2xl font-bold tracking-wider">
                                {memberNumber}
                            </p>
                        </div>

                        <div>
                            <p className="text-blue-200 text-sm mb-1">Full Name</p>
                            <p className="text-white text-xl font-semibold">{fullName}</p>
                        </div>

                        <div>
                            <p className="text-blue-200 text-sm mb-1">Email</p>
                            <p className="text-white text-sm">{email}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-4">
                            <div>
                                <p className="text-blue-200 text-xs mb-1">Member Since</p>
                                <p className="text-white text-sm font-medium">
                                    {new Date(memberSince).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </p>
                            </div>
                            <div>
                                <p className="text-blue-200 text-xs mb-1">Valid Until</p>
                                <p className="text-white text-sm font-medium">
                                    {new Date(expiresAt).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* QR Code */}
                    <div className="flex flex-col items-center justify-center bg-white rounded-xl p-4">
                        <img
                            src={qrCodeDataUrl}
                            alt="QR Code"
                            className="w-full h-auto"
                        />
                        <p className="text-xs text-gray-600 mt-2 text-center">
                            Scan to verify
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-6 pt-4 border-t border-blue-500/30">
                    <p className="text-blue-200 text-xs text-center">
                        This digital ID is property of Easy Sales Export Platform (RC: 763845)
                    </p>
                </div>
            </div>

            {/* Download Buttons */}
            <div className="flex justify-center space-x-4">
                <button
                    onClick={downloadAsPNG}
                    disabled={downloading}
                    className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
                >
                    <Download className="w-5 h-5" />
                    <span>Download PNG</span>
                </button>
                <button
                    onClick={downloadAsPDF}
                    disabled={downloading}
                    className="flex items-center space-x-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
                >
                    <Download className="w-5 h-5" />
                    <span>Download PDF</span>
                </button>
            </div>
        </div>
    );
}
