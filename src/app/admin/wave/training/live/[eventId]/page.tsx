"use client";

import { useState, useEffect, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, ArrowLeft, Users, Clock, PhoneOff, Loader2, AlertCircle, CloudUpload, Square } from "lucide-react";
import { getWaveTrainingEventsAction, endWaveLiveSessionAction, updateTrainingEventAction } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";

interface Props {
    params: Promise<{ eventId: string }>;
}

export default function AdminWaveLivePage({ params }: Props) {
    const { eventId } = use(params);
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [event, setEvent] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEnding, setIsEnding] = useState(false);
    const [ended, setEnded] = useState(false);

    // Recording & Upload States
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Timer effect for recording duration
    useEffect(() => {
        let interval: any;
        if (isRecording) {
            interval = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } else {
            setRecordingTime(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [
            h > 0 ? h : null,
            String(m).padStart(2, '0'),
            String(s).padStart(2, '0')
        ].filter(Boolean).join(':');
    };

    function uploadFileWithProgress(blob: Blob, fileName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/upload", true);
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    setUploadProgress(percentComplete);
                }
            };
            
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response.success && response.url) {
                            resolve(response.url);
                        } else {
                            reject(new Error(response.error || "Upload failed"));
                        }
                    } catch (e) {
                        reject(new Error("Failed to parse response"));
                    }
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            };
            
            xhr.onerror = () => reject(new Error("Network error during upload"));
            
            const formData = new FormData();
            formData.append("file", blob, fileName);
            formData.append("folder", "wave-training-sessions");
            formData.append("documentType", "session-video");
            
            xhr.send(formData);
        });
    }

    async function handleUploadRecording() {
        if (!recordingBlob) return;
        setIsUploading(true);
        setUploadProgress(0);
        
        try {
            const fileName = `wave-session-${eventId}.webm`;
            const videoUrl = await uploadFileWithProgress(recordingBlob, fileName);
            
            const result = await updateTrainingEventAction(eventId, {
                videoUrl,
                status: "completed"
            });
            
            if (result.success) {
                showToast("Recording uploaded successfully and published for students.", "success");
                setShowUploadModal(false);
                setRecordingBlob(null);
                router.push("/admin/wave/training");
            } else {
                showToast(result.error || "Failed to update training event with video", "error");
            }
        } catch (err: any) {
            console.error("Upload error:", err);
            showToast(err.message || "Failed to upload recording", "error");
        } finally {
            setIsUploading(false);
        }
    }

    function mixAudioStreams(displayStream: MediaStream, micStream: MediaStream | null): MediaStreamTrack | null {
        try {
            const displayAudioTracks = displayStream.getAudioTracks();
            const micAudioTracks = micStream ? micStream.getAudioTracks() : [];

            if (displayAudioTracks.length === 0 && micAudioTracks.length === 0) {
                return null;
            }

            // If only one stream has audio, return its first track directly
            if (displayAudioTracks.length === 0) {
                return micAudioTracks[0];
            }
            if (micAudioTracks.length === 0) {
                return displayAudioTracks[0];
            }

            // Both streams have audio, mix them using Web Audio API
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            
            const displaySource = audioCtx.createMediaStreamSource(new MediaStream([displayAudioTracks[0]]));
            const micSource = audioCtx.createMediaStreamSource(new MediaStream([micAudioTracks[0]]));
            
            const destination = audioCtx.createMediaStreamDestination();
            
            displaySource.connect(destination);
            micSource.connect(destination);
            
            // Keep references to prevent garbage collection during recording
            (destination as any)._audioCtx = audioCtx;
            (destination as any)._displaySource = displaySource;
            (destination as any)._micSource = micSource;

            return destination.stream.getAudioTracks()[0];
        } catch (err) {
            console.error("Failed to mix audio streams:", err);
            // Fallback to first available track
            const displayAudio = displayStream.getAudioTracks()[0];
            const micAudio = micStream ? micStream.getAudioTracks()[0] : null;
            return displayAudio || micAudio || null;
        }
    }

    async function startRecording() {
        try {
            let displayStream: MediaStream;
            try {
                displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { displaySurface: "browser" },
                    audio: true
                });
            } catch (firstErr) {
                console.warn("Failed to get display media with audio, trying without display audio:", firstErr);
                displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true
                });
            }

            let micStream: MediaStream | null = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (micErr) {
                console.warn("Microphone access denied or failed:", micErr);
            }

            const videoTrack = displayStream.getVideoTracks()[0];
            const mixedAudioTrack = mixAudioStreams(displayStream, micStream);

            const tracks: MediaStreamTrack[] = [];
            if (videoTrack) tracks.push(videoTrack);
            if (mixedAudioTrack) tracks.push(mixedAudioTrack);

            // Clean up unused display audio tracks if they weren't mixed directly
            displayStream.getAudioTracks().forEach(track => {
                if (track !== mixedAudioTrack) track.stop();
            });
            // Clean up unused mic tracks
            if (micStream) {
                micStream.getAudioTracks().forEach(track => {
                    if (track !== mixedAudioTrack) track.stop();
                });
            }

            const stream = new MediaStream(tracks);
            
            let options = { mimeType: 'video/webm;codecs=vp9,opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'video/webm;codecs=vp8,opus' };
            }
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'video/webm' };
            }

            const recorder = new MediaRecorder(stream, options);
            const chunks: Blob[] = [];

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());

                const blob = new Blob(chunks, { type: 'video/webm' });
                setRecordingBlob(blob);
                setIsRecording(false);
                setMediaRecorder(null);

                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `wave-session-${eventId}-${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);

                setShowUploadModal(true);
            };

            if (videoTrack) {
                videoTrack.onended = () => {
                    if (recorder.state !== "inactive") {
                        recorder.stop();
                    }
                };
            }

            recorder.start(1000);
            setMediaRecorder(recorder);
            setIsRecording(true);
            showToast("Recording started. Please share your browser tab with system audio enabled.", "success");
        } catch (err: any) {
            console.error("Recording start error:", err);
            showToast(err.message || "Failed to start recording.", "error");
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
    }

    useEffect(() => {
        if (status === "loading") return;
        if (status === "unauthenticated") {
            router.push("/auth/login");
            return;
        }

        // Load event details
        async function loadEvent() {
            try {
                // Fetch events and find the matching one
                const result = await getWaveTrainingEventsAction(undefined, 100);
                if (result.success && result.data) {
                    const found = (result.data as any[]).find((e: any) => e.id === eventId);
                    setEvent(found || null);
                }
            } catch (err) {
                // Fallback: render the room with minimal info
                setEvent({ id: eventId, title: "WAVE Live Training", instructor: "Admin" });
            } finally {
                setIsLoading(false);
            }
        }

        loadEvent();
    }, [status, eventId, router]);

    async function handleEndSession() {
        const confirmed = confirm("End the live session? Users will no longer be able to join.");
        if (!confirmed) return;

        setIsEnding(true);

        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            try {
                mediaRecorder.stop();
            } catch (err) {
                console.error("Error stopping recorder on session end:", err);
            }
        }

        try {
            const result = await endWaveLiveSessionAction(eventId);
            if (result.success) {
                showToast("Live session ended successfully.", "success");
                setEnded(true);
                if (!isRecording && !recordingBlob && !showUploadModal && !isUploading) {
                    setTimeout(() => router.push("/admin/wave/training"), 2000);
                }
            } else {
                showToast(result.error || "Failed to end session", "error");
            }
        } catch {
            showToast("An error occurred ending the session", "error");
        } finally {
            setIsEnding(false);
        }
    }

    function handleMeetingLeft() {
        // User left the Jitsi room — offer to end the session
        router.push("/admin/wave/training");
    }

    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold">Setting up live broadcast...</p>
                </div>
            </div>
        );
    }

    if (ended && !showUploadModal && !isUploading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center text-white">
                    <Video className="w-16 h-16 text-pink-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Session Ended</h2>
                    <p className="text-slate-400">Redirecting back to Training Management...</p>
                </div>
            </div>
        );
    }

    const roomName = `wave-training-${eventId}`;
    const userName = session?.user?.name || session?.user?.email || "Admin";
    const userEmail = session?.user?.email || undefined;

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Admin Broadcast Header */}
            <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/admin/wave/training")}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Events
                    </button>
                    <div className="hidden md:flex items-center gap-3">
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-bold text-sm">LIVE</span>
                        <span className="text-slate-300 text-sm font-medium truncate max-w-xs">
                            {event?.title || "WAVE Training Session"}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg px-3 py-1.5">
                        <Users className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-300 text-xs font-semibold">Trainer (Moderator)</span>
                    </div>
                    
                    {/* Screen Recorder Button */}
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors border ${
                            isRecording 
                                ? "bg-red-950/40 border-red-700 text-red-400 hover:bg-red-950/60" 
                                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full bg-red-500 ${isRecording ? 'animate-pulse' : ''}`} />
                        {isRecording ? `Recording (${formatTime(recordingTime)})` : "Record Session"}
                    </button>

                    <button
                        onClick={handleEndSession}
                        disabled={isEnding}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                        {isEnding ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <PhoneOff className="w-4 h-4" />
                        )}
                        End Session
                    </button>
                </div>
            </div>

            {/* Session Info Bar */}
            {event && (
                <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-2 flex items-center gap-6 text-xs text-slate-400 shrink-0">
                    <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Instructor: <span className="text-slate-200 font-medium ml-1">{event.instructor || "Admin"}</span>
                    </span>
                    {event.duration && (
                        <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Duration: <span className="text-slate-200 font-medium ml-1">{event.duration}</span>
                        </span>
                    )}
                    <span className="flex items-center gap-1.5 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Users at <strong>/wave/live-training</strong> will see this session live
                    </span>
                </div>
            )}

            {/* Video Room — full remaining height */}
            <div className="flex-1 p-4">
                <div className="h-[calc(100vh-200px)] min-h-[600px]">
                    {event?.meetingLink && event.meetingLink.startsWith("http") ? (
                        <div className="flex items-center justify-center h-full bg-slate-800 rounded-xl border border-slate-700">
                            <div className="text-center p-8 max-w-lg">
                                <Video className="w-16 h-16 text-pink-500 mx-auto mb-4 animate-pulse" />
                                <h3 className="text-2xl font-bold text-white mb-2">
                                    Google Meet / External Live Call
                                </h3>
                                <p className="text-slate-400 mb-6">
                                    This live session is configured to run externally. Click below to join and host the call.
                                </p>
                                <div className="space-y-4 flex flex-col items-center">
                                    <a
                                        href={event.meetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-8 py-4 bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-xl transition shadow-lg hover:shadow-pink-600/20 transform hover:-translate-y-0.5"
                                    >
                                        <Video className="w-5 h-5" />
                                        Launch External Call
                                    </a>
                                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                        Note: Cohort members visiting the live training page will be presented with a direct button to join this exact external call URL.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <VideoClassroom
                            roomName={roomName}
                            userName={userName}
                            userEmail={userEmail}
                            isModerator={true}
                            subject={event?.title || "WAVE Live Training"}
                            onMeetingEnd={handleMeetingLeft}
                        />
                    )}
                </div>
            </div>

            {/* Upload Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full text-center space-y-6 shadow-2xl">
                        <div className="w-16 h-16 bg-pink-900/40 border border-pink-700/50 rounded-full flex items-center justify-center mx-auto">
                            <Video className="w-8 h-8 text-pink-400" />
                        </div>
                        
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-white">Upload Training Recording</h3>
                            <p className="text-sm text-slate-400">
                                Your session has been recorded and saved locally. Would you like to upload it to the platform so students can stream it?
                            </p>
                        </div>

                        {isUploading && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-semibold text-slate-300">
                                    <span>Uploading to Cloudinary...</span>
                                    <span>{Math.round(uploadProgress)}%</span>
                                </div>
                                <div className="w-full bg-slate-700 h-2.5 rounded-full overflow-hidden">
                                    <div 
                                        className="bg-linear-to-r from-pink-500 to-rose-500 h-full transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                disabled={isUploading}
                                onClick={() => {
                                    setShowUploadModal(false);
                                    setRecordingBlob(null);
                                    if (ended) {
                                        router.push("/admin/wave/training");
                                    }
                                }}
                                className="flex-1 py-3 border border-slate-600 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-semibold rounded-xl transition"
                            >
                                Keep Local Only
                            </button>
                            <button
                                type="button"
                                disabled={isUploading || !recordingBlob}
                                onClick={handleUploadRecording}
                                className="flex-1 py-3 bg-linear-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <CloudUpload className="w-4 h-4" />
                                        Upload & Publish
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
