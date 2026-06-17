"use client";
 
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, ArrowLeft, BookOpen, Users, PhoneOff, Loader2, AlertCircle, CloudUpload, Square } from "lucide-react";
import { getCourseByIdAction, endAcademyLiveSessionAction, getLiveSessionsAction } from "@/app/actions/academy";
import { toast } from "sonner";
 
interface Props {
    params: Promise<{ courseId: string }>;
}
 
export default function AdminAcademyLivePage({ params }: Props) {
    const { courseId } = use(params);
    const router = useRouter();
    const { data: session, status } = useSession();
 
    const [course, setCourse] = useState<any>(null);
    const [liveSession, setLiveSession] = useState<any>(null);
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
            formData.append("folder", "academy-live-sessions");
            formData.append("documentType", "session-video");
            
            xhr.send(formData);
        });
    }
 
    async function handleUploadRecording() {
        if (!recordingBlob) return;
        setIsUploading(true);
        setUploadProgress(0);
        
        try {
            const fileName = `academy-session-${courseId}.webm`;
            const videoUrl = await uploadFileWithProgress(recordingBlob, fileName);
            
            const result = await endAcademyLiveSessionAction(courseId, videoUrl);
            
            if (result.success) {
                toast.success("Recording uploaded successfully and published for students.");
                setShowUploadModal(false);
                setRecordingBlob(null);
                setEnded(true);
                router.push("/admin/academy");
            } else {
                toast.error(result.error || "Failed to update academy live session with video");
            }
        } catch (err: any) {
            console.error("Upload error:", err);
            toast.error(err.message || "Failed to upload recording");
        } finally {
            setIsUploading(false);
        }
    }
 
    async function startRecording() {
        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser" },
                audio: true
            });
 
            let tracks = [...displayStream.getTracks()];
            
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                tracks = [...tracks, ...micStream.getAudioTracks()];
            } catch (micErr) {
                console.warn("Microphone access denied or failed:", micErr);
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
                a.download = `academy-session-${courseId}-${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
 
                setShowUploadModal(true);
            };
 
            displayStream.getVideoTracks()[0].onended = () => {
                if (recorder.state !== "inactive") {
                    recorder.stop();
                }
            };
 
            recorder.start(1000);
            setMediaRecorder(recorder);
            setIsRecording(true);
            toast.success("Recording started. Please share your browser tab with system audio enabled.");
        } catch (err: any) {
            console.error("Recording start error:", err);
            toast.error(err.message || "Failed to start recording.");
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
 
        async function loadCourse() {
            try {
                const result = await getCourseByIdAction(courseId);
                if (result.success && result.data) {
                    setCourse(result.data);
                } else {
                    // Fallback: render room with minimal info
                    setCourse({ id: courseId, title: courseId.replace(/-/g, " "), instructor: "Easy Sales Academy" });
                }
 
                // Load active live session link if it exists
                const liveRes = await getLiveSessionsAction(courseId);
                if (liveRes.success && liveRes.data) {
                    const active = (liveRes.data as any[]).find((s: any) => s.status === "live");
                    if (active) {
                        setLiveSession(active);
                    }
                }
            } catch {
                setCourse({ id: courseId, title: "Live Class", instructor: "Easy Sales Academy" });
            } finally {
                setIsLoading(false);
            }
        }
 
        loadCourse();
    }, [status, courseId, router]);
 
    async function handleEndSession() {
        const confirmed = confirm("End the live session? Students will no longer be able to join.");
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
            const result = await endAcademyLiveSessionAction(courseId);
            if (result.success) {
                toast.success("Live session ended successfully.");
                setEnded(true);
                if (!isRecording && !recordingBlob && !showUploadModal && !isUploading) {
                    setTimeout(() => router.push("/admin/academy"), 2000);
                }
            } else {
                toast.error(result.error || "Failed to end session");
            }
        } catch {
            toast.error("An error occurred ending the session");
        } finally {
            setIsEnding(false);
        }
    }
 
    function handleMeetingLeft() {
        router.push("/admin/academy");
    }
 
    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold">Setting up live classroom...</p>
                </div>
            </div>
        );
    }
 
    if (ended && !showUploadModal && !isUploading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center text-white">
                    <BookOpen className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Session Ended</h2>
                    <p className="text-slate-400">Redirecting back to Academy Management...</p>
                </div>
            </div>
        );
    }
 
    const roomName = `academy-${courseId}`;
    const userName = session?.user?.name || session?.user?.email || "Instructor";
    const userEmail = session?.user?.email || undefined;
 
    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Admin Broadcast Header */}
            <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/admin/academy")}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Academy
                    </button>
                    <div className="hidden md:flex items-center gap-3">
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-bold text-sm">LIVE</span>
                        <span className="text-slate-300 text-sm font-medium truncate max-w-xs">
                            {course?.title || "Live Class"}
                        </span>
                    </div>
                </div>
 
                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 bg-purple-900/40 border border-purple-700/50 rounded-lg px-3 py-1.5">
                        <Users className="w-4 h-4 text-purple-400" />
                        <span className="text-purple-300 text-xs font-semibold">Instructor (Moderator)</span>
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
                        End Class
                    </button>
                </div>
            </div>
 
            {/* Course Info Bar */}
            {course && (
                <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-2 flex items-center gap-6 text-xs text-slate-400 shrink-0">
                    <span className="flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        Course: <span className="text-slate-200 font-medium ml-1">{course.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Instructor: <span className="text-slate-200 font-medium ml-1">{course.instructor || "Admin"}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Students at <strong>/academy/live/{courseId}</strong> will see this session live
                    </span>
                </div>
            )}
 
            {/* Video Room — full remaining height */}
            <div className="flex-1 p-4">
                <div className="h-[calc(100vh-200px)] min-h-[600px]">
                    {liveSession?.customMeetingLink ? (
                        <div className="flex items-center justify-center h-full bg-slate-800 rounded-xl border border-slate-700">
                            <div className="text-center p-8 max-w-lg">
                                <Video className="w-16 h-16 text-purple-500 mx-auto mb-4 animate-pulse" />
                                <h3 className="text-2xl font-bold text-white mb-2">
                                    Google Meet / External Live Call
                                </h3>
                                <p className="text-slate-400 mb-6">
                                    This live classroom is configured to run externally. Click below to join and host the call.
                                </p>
                                <div className="space-y-4 flex flex-col items-center">
                                    <a
                                        href={liveSession.customMeetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white font-semibold rounded-xl transition shadow-lg hover:shadow-primary/20 transform hover:-translate-y-0.5"
                                    >
                                        <Video className="w-5 h-5" />
                                        Launch External Call
                                    </a>
                                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                        Note: Students visiting the live classroom page will be presented with a direct button to join this exact external call URL.
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
                            subject={`Academy: ${course?.title || courseId}`}
                            onMeetingEnd={handleMeetingLeft}
                        />
                    )}
                </div>
            </div>
 
            {/* Upload Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full text-center space-y-6 shadow-2xl">
                        <div className="w-16 h-16 bg-purple-900/40 border border-purple-700/50 rounded-full flex items-center justify-center mx-auto">
                            <Video className="w-8 h-8 text-purple-400" />
                        </div>
                        
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-white">Upload Academy Class Recording</h3>
                            <p className="text-sm text-slate-400">
                                Your live class session has been recorded and saved locally. Would you like to upload it to the platform so students can stream it later?
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
                                        className="bg-linear-to-r from-purple-500 to-indigo-500 h-full transition-all duration-300"
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
                                        router.push("/admin/academy");
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
                                className="flex-1 py-3 bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
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
