"use client";

import { useEffect, useRef, useState } from "react";
import { Video, Mic, MicOff, VideoOff, PhoneOff, Users } from "lucide-react";
import { classroomRoomName } from "@/lib/classroom-room";

/**
 *   #188 THE CLASSROOM WAS A PUBLIC ROOM WITH A GUESSABLE NAME.
 *
 *        This component opens a room on meet.jit.si — a public instance with
 *        no JWT — and the name was built HERE from a prop every caller derived
 *        from an identifier on the URL:
 *
 *            roomName: `EasySalesExport-${roomName}`
 *            ...where roomName was `academy-${courseId}`
 *                                 or `wave-training-${eventId}`
 *
 *        so `EasySalesExport-academy-<courseId>` was the room for any paid live
 *        class, and the course id is in the catalogue link. Anyone could type
 *        it into meet.jit.si and be in the class with no account.
 *
 *        THE PROP IS NOW A SERVER-MINTED SECRET (`roomKey`), reached only
 *        through the readers that already apply the entitlement check, and this
 *        component REFUSES anything that is not one — see classroomRoomName. A
 *        caller that passes a derived name gets the closed-classroom notice,
 *        not a public room. That refusal is the point: the previous version
 *        would happily open whatever it was handed.
 *
 *        THE MODERATOR TURNS THE LOBBY ON. This code did the opposite —
 *        `executeCommand("toggleLobby", false)` on the moderator path, and
 *        nothing ever turned it on — so the one gate the public instance offers
 *        was explicitly disabled.
 *
 *        WHAT REMAINS OPEN: meet.jit.si does not authenticate participants, so
 *        somebody GIVEN the key by an entitled learner can still reach the
 *        lobby. Only a JWT tenant binds a participant to an account, and that
 *        is a hosting decision. CLASSROOM_JWT_IS_NOT_CONFIGURED in
 *        lib/classroom-room.ts is the marker for that work.
 */
interface VideoClassroomProps {
    /** The server-minted room key. Not a course id, an event id, or a title. */
    roomKey: string;
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
    roomKey,
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

    /** null unless `roomKey` is a real minted key — see lib/classroom-room.ts. */
    const fullRoomName = classroomRoomName(roomKey);

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
                    // Built by the shared rule, which returns null for anything
                    // that is not a minted key. The guard above means it cannot
                    // be null here.
                    roomName: fullRoomName as string,
                    width: "100%",
                    height: "100%",
                    parentNode: jitsiContainerRef.current,
                    configOverwrite: {
                        startWithAudioMuted: false,
                        startWithVideoMuted: false,
                        enableWelcomePage: false,
                        disableInviteFunctions: !isModeratorRef.current,
                        enableClosePage: false,
                        hideConferenceSubject: !subjectRef.current,
                        // NOT the room key. The subject is rendered in the
                        // Jitsi title bar and is visible to everybody in the
                        // call, including a guest — putting the credential
                        // there would hand it to the person it is meant to
                        // keep out.
                        subject: subjectRef.current || "Easy Sales Export live class",
                        // A person lands on the prejoin screen rather than
                        // being dropped straight into the room. It is where
                        // the lobby's "waiting to be admitted" state is shown.
                        prejoinPageEnabled: true,
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

                // #188. THIS TURNED THE LOBBY OFF.
                //
                // `executeCommand("toggleLobby", false)` on the moderator path,
                // and nothing anywhere turned it on — so the one gate a public
                // meet.jit.si room offers was explicitly disabled, and anybody
                // who reached the room was simply in it.
                //
                // Only a moderator can enable the lobby, which is why this is
                // on the moderator branch. Whoever arrives after it waits to be
                // admitted by the instructor. It is a compensating control, not
                // authentication: see CLASSROOM_JWT_IS_NOT_CONFIGURED.
                if (isModeratorRef.current) {
                    apiRef.current.executeCommand("toggleLobby", true);
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

        if (!fullRoomName) {
            // A caller with no usable key must NOT get a room under a name
            // this component made up. The made-up name was the defect.
            setError(
                "This classroom is not open. Ask the instructor to start the class, "
                + "or check that your plan includes this course.",
            );
            setIsLoading(false);
            return () => { active = false; };
        }

        loadJitsiScript();

        // Cleanup
        return () => {
            active = false;
            if (apiRef.current) {
                apiRef.current.dispose();
                apiRef.current = null;
            }
        };
    }, [fullRoomName]);

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
                        {/* The room key is a credential; it is not printed. */}
                        <p className="text-slate-400 text-sm mt-2">
                            <Users className="w-4 h-4 inline mr-1" />
                            Setting up your classroom
                        </p>
                    </div>
                </div>
            )}
            <div ref={jitsiContainerRef} className="w-full h-full" />
        </div>
    );
}
