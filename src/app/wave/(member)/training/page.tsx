"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    Calendar,
    Users,
    Clock,
    Loader2,
    CheckCircle,
    XCircle,
    Video,
    User,
} from "lucide-react";
import { checkWaveMembershipAction, getUserTrainingRegistrationsAction } from "@/app/actions/wave-member";
import { getWaveTrainingEventsAction, registerForTrainingAction, type WaveTrainingEvent } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";
import BackButton from "@/components/ui/BackButton";

export default function WaveTrainingPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const { data: session } = useSession();

    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<WaveTrainingEvent[]>([]);
    const [registeredEventIds, setRegisteredEventIds] = useState<Set<string>>(new Set());
    const [registeringId, setRegisteringId] = useState<string | null>(null);

    useEffect(() => {
        loadTrainingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadTrainingData() {
        setLoading(true);
        try {
            // Check membership
            const membership = await checkWaveMembershipAction();
            if (!membership.enrolled) {
                router.push("/wave");
                return;
            }

            // Load events
            const eventsResult = await getWaveTrainingEventsAction();
            if (eventsResult.success && eventsResult.data) {
                setEvents(eventsResult.data);
            }

            // Load user's registrations
            const regsResult = await getUserTrainingRegistrationsAction();
            if (regsResult.success && regsResult.registrations) {
                const eventIds = new Set(
                    regsResult.registrations.map((reg: any) => reg.eventId)
                );
                setRegisteredEventIds(eventIds);
            }
        } catch (error) {
            showToast("Failed to load training events", "error");
        } finally {
            setLoading(false);
        }
    }

    async function handleRegister(eventId: string) {
        if (!eventId) return;

        const userId = session?.user?.id;
        if (!userId) {
            showToast("You must be logged in to register", "error");
            return;
        }

        setRegisteringId(eventId);
        try {
            const result = await registerForTrainingAction(userId, eventId);

            if (result.success) {
                showToast("Successfully registered for training!", "success");
                loadTrainingData();
            } else {
                showToast(result.error || "Failed to register", "error");
            }
        } catch (error) {
            showToast("Registration failed", "error");
        } finally {
            setRegisteringId(null);
        }
    }

    function getEventStatusColor(status: string) {
        switch (status) {
            case "upcoming":
                return "bg-blue-100 text-blue-700";
            case "ongoing":
                return "bg-emerald-100 text-emerald-800";
            case "completed":
                return "bg-gray-100 text-gray-700";
            case "cancelled":
                return "bg-red-100 text-red-700";
            default:
                return "bg-gray-100 text-gray-700";
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-emerald-700" />
            </div>
        );
    }

    const upcomingEvents = events.filter((e) => e.status === "upcoming");
    const ongoingEvents = events.filter((e) => e.status === "ongoing");
    const completedEvents = events.filter((e) => e.status === "completed");

    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <BackButton fallbackPath="/wave/dashboard" />
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Training Events
                    </h1>
                    <p className="text-gray-600">
                        Register for workshops, webinars, and field trips to grow your skills
                    </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600">Upcoming</h3>
                            <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{upcomingEvents.length}</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600">Enrolled</h3>
                            <CheckCircle className="w-5 h-5 text-emerald-700" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{registeredEventIds.size}</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600">Completed</h3>
                            <Calendar className="w-5 h-5 text-gray-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{completedEvents.length}</p>
                    </div>
                </div>

                {/* Upcoming Events */}
                {upcomingEvents.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4">
                            Upcoming Training
                        </h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {upcomingEvents.map((event) => {
                                const isRegistered = event.id && registeredEventIds.has(event.id);
                                const isFull = event.currentParticipants >= event.maxParticipants;
                                const isRegistering = registeringId === event.id;

                                return (
                                    <div
                                        key={event.id}
                                        className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100"
                                    >
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-4">
                                            <div>
                                                <h3 className="text-xl font-bold text-gray-900 mb-1">
                                                    {event.title}
                                                </h3>
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getEventStatusColor(event.status)}`}>
                                                    {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Description */}
                                        <p className="text-gray-600 mb-4">
                                            {event.description}
                                        </p>

                                        {/* Details */}
                                        <div className="space-y-3 mb-4">
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <User className="w-4 h-4 text-emerald-700" />
                                                <span className="font-medium">Instructor:</span> {event.instructor}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Calendar className="w-4 h-4 text-emerald-700" />
                                                <span className="font-medium">Date:</span>{" "}
                                                {new Date(event.date).toLocaleDateString("en-US", {
                                                    weekday: "long",
                                                    year: "numeric",
                                                    month: "long",
                                                    day: "numeric",
                                                })}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Clock className="w-4 h-4 text-blue-600" />
                                                <span className="font-medium">Duration:</span> {event.duration}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Users className="w-4 h-4 text-emerald-700" />
                                                <span className="font-medium">Capacity:</span> {event.currentParticipants}/{event.maxParticipants} enrolled
                                            </div>

                                            {event.meetingLink && (
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Video className="w-4 h-4 text-red-600" />
                                                    <span className="font-medium">Format:</span> Online
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Button */}
                                        {isRegistered ? (
                                            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-emerald-800 font-semibold">
                                                <CheckCircle className="w-5 h-5" />
                                                You're Registered
                                            </div>
                                        ) : isFull ? (
                                            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 font-semibold">
                                                <XCircle className="w-5 h-5" />
                                                Event Full
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => event.id && handleRegister(event.id)}
                                                disabled={isRegistering}
                                                className="w-full px-4 py-3 bg-emerald-700 text-white font-semibold rounded-xl hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {isRegistering ? (
                                                    <>
                                                        <Loader2 className="w-5 h-5 animate-spin" />
                                                        Registering...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Calendar className="w-5 h-5" />
                                                        Register Now
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Ongoing Events */}
                {ongoingEvents.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4">
                            Currently Ongoing
                        </h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {ongoingEvents.map((event) => (
                                <div
                                    key={event.id}
                                    className="bg-green-50 rounded-2xl shadow-lg p-6 border-2 border-green-200"
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-emerald-800 font-semibold text-sm">LIVE NOW</span>
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                                        {event.title}
                                    </h3>
                                    <p className="text-gray-600 mb-4">{event.description}</p>
                                    {event.meetingLink && (
                                        <a
                                            href={event.meetingLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-green-700 transition"
                                        >
                                            <Video className="w-4 h-4" />
                                            Join Now
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {events.length === 0 && (
                    <div className="bg-white rounded-2xl shadow-lg p-12 text-center border border-gray-100">
                        <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">
                            No Training Events
                        </h3>
                        <p className="text-gray-600">
                            Check back soon for upcoming workshops, webinars, and training sessions!
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
