"use client";

import { useEffect, useRef, useState } from "react";
import { Video, Mic, MicOff, VideoOff, PhoneOff, Users } from "lucide-react";

interface VideoClassroomProps {
    roomName: string;
    userName: string;
    userEmail?: string;
    isModerator?: boolean;
    subject?: string;
    onMeetingEnd?: () => void;
}

declare global {
    interface Window {
        JitsiMeetExternalAPI: any;
    }
}

export default function VideoClassroom({
    roomName,
    userName,
    userEmail,
    isModerator = false,
    subject,
    onMeetingEnd
}: VideoClassroomProps) {
    const jitsiContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string>("");

    useEffect(() => {
        // Load Jitsi Meet API
        const loadJitsiScript = () => {
            if (window.JitsiMeetExternalAPI) {
                initializeJitsi();
                return;
            }

            const script = document.createElement("script");
            script.src = "https://meet.jit.si/external_api.js";
            script.async = true;
            script.onload = () => initializeJitsi();
            script.onerror = () => {
                setError("Failed to load video conferencing. Please refresh the page.");
                setIsLoading(false);
            };
            document.body.appendChild(script);
        };

        const initializeJitsi = () => {
            if (!jitsiContainerRef.current || apiRef.current) return;

            try {
                const domain = "meet.jit.si";
                const options = {
                    roomName: `EasySalesExport-${roomName}`,
                    width: "100%",
                    height: "100%",
                    parentNode: jitsiContainerRef.current,
                    configOverwrite: {
                        startWithAudioMuted: false,
                        startWithVideoMuted: false,
                        enableWelcomePage: false,
                        prejoinPageEnabled: false,
                        disableInviteFunctions: !isModerator,
                        enableClosePage: false,
                        hideConferenceSubject: !subject,
                        subject: subject || `Easy Sales Export - ${roomName}`,
                    },
                    interfaceConfigOverwrite: {
                        TOOLBAR_BUTTONS: [
                            "microphone",
                            "camera",
                            "closedcaptions",
                            "desktop",
                            "fullscreen",
                            "fodeviceselection",
                            "hangup",
                            "profile",
                            "chat",
                            "recording",
                            "livestreaming",
                            "etherpad",
                            "sharedvideo",
                            "settings",
                            "raisehand",
                            "videoquality",
                            "filmstrip",
                            "stats",
                            "shortcuts",
                            "tileview",
                            "help",
                        ],
                        SHOW_JITSI_WATERMARK: false,
                        SHOW_WATERMARK_FOR_GUESTS: false,
                        DEFAULT_BACKGROUND: "#1e293b",
                        DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
                    },
                    userInfo: {
                        displayName: userName,
                        email: userEmail,
                    },
                };

                apiRef.current = new window.JitsiMeetExternalAPI(domain, options);

                // Set moderator role
                if (isModerator) {
                    apiRef.current.executeCommand("toggleLobby", false);
                }

                // Event listeners
                apiRef.current.addListener("videoConferenceJoined", () => {
                    setIsLoading(false);
                    console.log("Joined video conference");
                });

                apiRef.current.addListener("videoConferenceLeft", () => {
                    console.log("Left video conference");
                    onMeetingEnd?.();
                });

                apiRef.current.addListener("readyToClose", () => {
                    apiRef.current?.dispose();
                    onMeetingEnd?.();
                });

            } catch (err) {
                console.error("Failed to initialize Jitsi:", err);
                setError("Failed to start video call. Please try again.");
                setIsLoading(false);
            }
        };

        loadJitsiScript();

        // Cleanup
        return () => {
            if (apiRef.current) {
                apiRef.current.dispose();
                apiRef.current = null;
            }
        };
    }, [roomName, userName, userEmail, isModerator, subject, onMeetingEnd]);

    if (error) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-100 dark:bg-slate-900 rounded-xl">
                <div className="text-center p-8">
                    <VideoOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                        Connection Error
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden shadow-2xl">
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-white font-semibold">Connecting to video call...</p>
                        <p className="text-slate-400 text-sm mt-2">
                            <Users className="w-4 h-4 inline mr-1" />
                            Setting up room: {roomName}
                        </p>
                    </div>
                </div>
            )}
            <div ref={jitsiContainerRef} className="w-full h-full" />
        </div>
    );
}
