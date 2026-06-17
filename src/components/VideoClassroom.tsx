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

    const onMeetingEndRef = useRef(onMeetingEnd);
    const userNameRef = useRef(userName);
    const userEmailRef = useRef(userEmail);
    const subjectRef = useRef(subject);
    const isModeratorRef = useRef(isModerator);

    useEffect(() => {
        onMeetingEndRef.current = onMeetingEnd;
        userNameRef.current = userName;
        userEmailRef.current = userEmail;
        subjectRef.current = subject;
        isModeratorRef.current = isModerator;
    }, [onMeetingEnd, userName, userEmail, subject, isModerator]);

    useEffect(() => {
        let active = true;

        // Load Jitsi Meet API
        function loadJitsiScript() {
            if (window.JitsiMeetExternalAPI) {
                if (active) initializeJitsi();
                return;
            }

            const script = document.createElement("script");
            script.src = "https://meet.jit.si/external_api.js";
            script.async = true;
            script.onload = () => {
                if (active) initializeJitsi();
            };
            script.onerror = () => {
                if (active) {
                    setError("Failed to load video conferencing. Please refresh the page.");
                    setIsLoading(false);
                }
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
                        disableInviteFunctions: !isModeratorRef.current,
                        enableClosePage: false,
                        hideConferenceSubject: !subjectRef.current,
                        subject: subjectRef.current || `Easy Sales Export - ${roomName}`,
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
                        displayName: userNameRef.current,
                        email: userEmailRef.current,
                    },
                };

                apiRef.current = new window.JitsiMeetExternalAPI(domain, options);

                // Hide custom loading screen once the iframe is successfully added to the DOM
                // so Jitsi's native loading state, permission prompts, and join button are interactive.
                if (active) setIsLoading(false);

                // Set moderator role
                if (isModeratorRef.current) {
                    apiRef.current.executeCommand("toggleLobby", false);
                }

                // Event listeners
                apiRef.current.addListener("videoConferenceJoined", () => {
                    if (active) setIsLoading(false);
                });

                apiRef.current.addListener("videoConferenceLeft", () => {
                    onMeetingEndRef.current?.();
                });

                apiRef.current.addListener("readyToClose", () => {
                    apiRef.current?.dispose();
                    apiRef.current = null;
                    onMeetingEndRef.current?.();
                });

            } catch (err) {
                console.error("Failed to initialize Jitsi:", err);
                if (active) {
                    setError("Failed to start video call. Please try again.");
                    setIsLoading(false);
                }
            }
        };

        loadJitsiScript();

        // Cleanup
        return () => {
            active = false;
            if (apiRef.current) {
                apiRef.current.dispose();
                apiRef.current = null;
            }
        };
    }, [roomName]);

    if (error) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-100 rounded-xl">
                <div className="text-center p-8">
                    <VideoOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                        Connection Error
                    </h3>
                    <p className="text-slate-600">{error}</p>
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
