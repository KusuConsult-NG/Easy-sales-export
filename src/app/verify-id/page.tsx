"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, Upload, CheckCircle, XCircle, AlertCircle, Loader2, ScanLine, StopCircle } from "lucide-react";
import { verifyDigitalIDQR, type QRVerificationResult } from "@/lib/digital-id";
import { logger } from '@/lib/logger';

export default function VerifyIDPage() {
    const [qrData, setQrData] = useState<string>("");
    const [verifying, setVerifying] = useState(false);
    const [result, setResult] = useState<QRVerificationResult | null>(null);
    const [cameraActive, setCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [scanStatus, setScanStatus] = useState<string>("");

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const runVerify = (data: string) => {
        if (!data.trim()) return;
        setVerifying(true);
        setResult(null);
        const verificationResult = verifyDigitalIDQR(data);
        setResult(verificationResult);
        setVerifying(false);
        logger.info("Digital ID verification attempt", {
            timestamp: new Date().toISOString(),
            result: verificationResult.valid ? "valid" : "invalid",
        });
    };

    // ── Camera scanning ─────────────────────────────────────────────────────────
    const startCamera = useCallback(async () => {
        setCameraError(null);
        setScanStatus("Starting camera…");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setCameraActive(true);
            setScanStatus("Scanning — hold QR code steady…");

            // Scan every 300ms
            const jsQR = (await import("jsqr")).default;
            scanIntervalRef.current = setInterval(() => {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;

                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);

                if (code?.data) {
                    setScanStatus("QR code detected!");
                    stopCamera();
                    setQrData(code.data);
                    runVerify(code.data);
                }
            }, 300);
        } catch (err: any) {
            setCameraError(err.name === "NotAllowedError"
                ? "Camera permission denied. Please allow camera access and try again."
                : "Camera not available. Use file upload instead."
            );
            setScanStatus("");
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stopCamera = useCallback(() => {
        if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setCameraActive(false);
        setScanStatus("");
    }, []);

    useEffect(() => () => stopCamera(), [stopCamera]);

    // ── Image file upload ────────────────────────────────────────────────────────
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setResult(null);
        setVerifying(true);
        setScanStatus("Reading image…");
        try {
            const jsQR = (await import("jsqr")).default;
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);

            if (code?.data) {
                setQrData(code.data);
                runVerify(code.data);
            } else {
                setResult({ valid: false, error: "No QR code found in the uploaded image." });
                setVerifying(false);
            }
        } catch (err) {
            logger.error("Failed to decode QR from image", err instanceof Error ? err : undefined);
            setResult({ valid: false, error: "Failed to process image." });
            setVerifying(false);
        }
        setScanStatus("");
    };

    const handleManualVerify = () => runVerify(qrData);

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <CheckCircle className="w-10 h-10 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900">Verify Digital ID</h1>
                    </div>
                    <p className="text-slate-600">Scan a QR code with your camera, upload an image, or paste the code manually</p>
                </div>

                {/* Camera Scanner */}
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        <ScanLine className="w-5 h-5 text-blue-600" />
                        Camera Scanner
                    </h2>

                    {/* Video preview */}
                    <div className={`relative rounded-xl overflow-hidden bg-slate-900 mb-4 ${!cameraActive ? 'hidden' : ''}`} style={{ aspectRatio: '16/9' }}>
                        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                        <canvas ref={canvasRef} className="hidden" />
                        {/* Scan overlay */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-56 h-56 border-4 border-blue-400 rounded-xl opacity-80 animate-pulse" />
                        </div>
                        {scanStatus && (
                            <div className="absolute bottom-4 left-0 right-0 text-center">
                                <span className="bg-black/60 text-white text-sm px-4 py-2 rounded-full">{scanStatus}</span>
                            </div>
                        )}
                    </div>

                    {cameraError && (
                        <div className="flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <p className="text-sm">{cameraError}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        {!cameraActive ? (
                            <button
                                onClick={startCamera}
                                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                            >
                                <Camera className="w-4 h-4" />
                                Start Camera
                            </button>
                        ) : (
                            <button
                                onClick={stopCamera}
                                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition"
                            >
                                <StopCircle className="w-4 h-4" />
                                Stop Camera
                            </button>
                        )}
                    </div>
                </div>

                {/* Upload + Manual */}
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6 space-y-6">
                    <h2 className="text-lg font-semibold text-slate-900">Other Verification Methods</h2>

                    {/* Upload QR Image */}
                    <div>
                        <label className="flex text-sm font-medium text-slate-900 mb-2 items-center gap-2">
                            <Upload className="w-4 h-4" /> Upload QR Code Image
                        </label>
                        <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition">
                            <Upload className="w-7 h-7 text-slate-400 mb-1" />
                            <p className="text-sm text-slate-500"><span className="font-semibold">Click to upload</span> JPG, PNG</p>
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                        </label>
                    </div>

                    {/* Manual Input */}
                    <div>
                        <label className="block text-sm font-medium text-slate-900 mb-2">Or Paste QR Data Manually</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={qrData}
                                onChange={(e) => setQrData(e.target.value)}
                                placeholder="Paste encrypted QR data…"
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                            <button
                                onClick={handleManualVerify}
                                disabled={verifying || !qrData.trim()}
                                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Result */}
                {verifying && (
                    <div className="flex items-center gap-3 bg-white rounded-lg shadow-sm p-6 mb-6">
                        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                        <span className="text-slate-700 font-medium">Verifying…</span>
                    </div>
                )}

                {result && !verifying && (
                    <div className={`rounded-lg p-6 mb-6 ${result.valid ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
                        <div className="flex items-start space-x-3">
                            {result.valid
                                ? <CheckCircle className="w-6 h-6 text-emerald-600 mt-1" />
                                : <XCircle className="w-6 h-6 text-red-600 mt-1" />
                            }
                            <div className="flex-1">
                                <h3 className={`text-lg font-semibold mb-3 ${result.valid ? "text-emerald-900" : "text-red-900"}`}>
                                    {result.valid ? "✓ Valid Member ID" : "✗ Invalid QR Code"}
                                </h3>
                                {result.valid && result.payload ? (
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                        {[
                                            ["Member Number", result.payload.memberNumber],
                                            ["Name", result.payload.fullName],
                                            ["Email", result.payload.email],
                                            ["Role", result.payload.role?.replace("_", " ")],
                                            ["Valid Until", new Date(result.payload.expiresAt).toLocaleDateString()],
                                        ].map(([label, value]) => (
                                            <div key={label}>
                                                <dt className="font-semibold text-emerald-800">{label}</dt>
                                                <dd className="text-emerald-700 capitalize">{value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                ) : (
                                    <p className="text-red-700">{result.error || "Invalid QR code format"}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Guidelines */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                        <div>
                            <h3 className="font-semibold text-blue-900 mb-1">Verification Guidelines</h3>
                            <ul className="text-sm text-blue-800 space-y-1">
                                <li>• All verification attempts are logged for security</li>
                                <li>• QR codes expire after 1 year from issue date</li>
                                <li>• Only authenticated users can access this page</li>
                                <li>• Contact support if you encounter issues</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
