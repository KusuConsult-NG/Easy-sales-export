"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Calendar,
    Users,
    Clock,
    MapPin,
    Loader2,
    CheckCircle,
    XCircle,
    Video,
    User,
    AlertCircle,
} from "lucide-react";
import { checkWaveMembershipAction, getUserTrainingRegistrationsAction } from "@/app/actions/wave-member";
import { getWaveTrainingEventsAction, registerForTrainingAction, type WaveTrainingEvent } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";

export default function WaveTrainingPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<WaveTrainingEvent[]>([]);
    const [registeredEventIds, setRegisteredEventIds] = useState<Set<string>>(new Set());
    const [registeringId, setRegisteringId] = useState<string | null>(null);

    useEffect(() => {
        loadTrainingData();
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
            const eventsData = await getWaveTrainingEventsAction();
            setEvents(eventsData);

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

        setRegisteringId(eventId);
        try {
            const result = await registerForTrainingAction(await getUserId(), eventId);

            if (result.success) {
                showToast("Successfully registered for training!", "success");
                // Refresh data
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

    async function getUserId(): Promise<string> {
        // This would come from session in real implementation
        return "current-user-id";
    }

    function getEventStatusColor(status: string) {
        switch (status) {
            case "upcoming":
                return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
            case "ongoing":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
            case "completed":
                return "bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300";
            case "cancelled":
                return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
            default:
                return "bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300";
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-pink-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-pink-600" />
            </div>
        );
    }

    const upcomingEvents = events.filter((e) => e.status === "upcoming");
    const ongoingEvents = events.filter((e) => e.status === "ongoing");
    const completedEvents = events.filter((e) => e.status === "completed");

    return (
        <div className="min-h-screen bg-linear-to-br from-pink-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/wave/dashboard")}
                        className="text-pink-600 hover:text-pink-700 font-semibold mb-4 flex items-center gap-2"
                    >
                        ← Back to Dashboard
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Training Events
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Register for workshops, webinars, and field trips to grow your skills
                    </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Upcoming</h3>
                            <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{upcomingEvents.length}</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Enrolled</h3>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{registeredEventIds.size}</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Completed</h3>
                            <Calendar className="w-5 h-5 text-gray-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{completedEvents.length}</p>
                    </div>
                </div>

                {/* Upcoming Events */}
                {upcomingEvents.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
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
                                        className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700"
                                    >
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-4">
                                            <div>
                                                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                                                    {event.title}
                                                </h3>
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getEventStatusColor(event.status)}`}>
                                                    {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Description */}
                                        <p className="text-gray-600 dark:text-gray-400 mb-4">
                                            {event.description}
                                        </p>

                                        {/* Details */}
                                        <div className="space-y-3 mb-4">
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <User className="w-4 h-4 text-pink-600" />
                                                <span className="font-medium">Instructor:</span> {event.instructor}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <Calendar className="w-4 h-4 text-purple-600" />
                                                <span className="font-medium">Date:</span>{" "}
                                                {new Date(event.date).toLocaleDateString("en-US", {
                                                    weekday: "long",
                                                    year: "numeric",
                                                    month: "long",
                                                    day: "numeric",
                                                })}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <Clock className="w-4 h-4 text-blue-600" />
                                                <span className="font-medium">Duration:</span> {event.duration}
                                            </div>

                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <Users className="w-4 h-4 text-green-600" />
                                                <span className="font-medium">Capacity:</span> {event.currentParticipants}/{event.maxParticipants} enrolled
                                            </div>

                                            {event.meetingLink && (
                                                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                    <Video className="w-4 h-4 text-red-600" />
                                                    <span className="font-medium">Format:</span> Online
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Button */}
                                        {isRegistered ? (
                                            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-300 font-semibold">
                                                <CheckCircle className="w-5 h-5" />
                                                You're Registered
                                            </div>
                                        ) : isFull ? (
                                            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 font-semibold">
                                                <XCircle className="w-5 h-5" />
                                                Event Full
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => event.id && handleRegister(event.id)}
                                                disabled={isRegistering}
                                                className="w-full px-4 py-3 bg-pink-600 text-white font-semibold rounded-xl hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
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
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                            Currently Ongoing
                        </h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {ongoingEvents.map((event) => (
                                <div
                                    key={event.id}
                                    className="bg-green-50 dark:bg-green-900/10 rounded-2xl shadow-lg p-6 border-2 border-green-200 dark:border-green-800"
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-green-700 dark:text-green-300 font-semibold text-sm">LIVE NOW</span>
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                                        {event.title}
                                    </h3>
                                    <p className="text-gray-600 dark:text-gray-400 mb-4">{event.description}</p>
                                    {event.meetingLink && (
                                        <a
                                            href={event.meetingLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition"
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
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 text-center border border-gray-100 dark:border-gray-700">
                        <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                            No Training Events
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400">
                            Check back soon for upcoming workshops, webinars, and training sessions!
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
