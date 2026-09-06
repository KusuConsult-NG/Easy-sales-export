"use client";

import { useState, useEffect, useCallback, use } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    BookOpen, Clock, Users, PlayCircle, Award, CheckCircle,
    ArrowRight, Loader2, Calendar
} from "lucide-react";
import {
    getCourseByIdAction,
    enrollInCourseAction,
    getUserProgressAction,
    initializeCoursePaymentAction,
    type Course,
    type UserProgress
} from "@/app/actions/academy";
import { useToast } from "@/contexts/ToastContext";
import { checkCourseAccess, isPurchasedCourse } from "@/lib/academy-plan";
import { formatCurrency } from "@/lib/utils";



interface CourseDetailPageProps {
    params: Promise<{ courseId: string }>;
}

export default function CourseDetailPage(props: CourseDetailPageProps) {
    // Next.js 16: params is now a Promise, must unwrap with React.use()
    const params = use(props.params);
    const courseId = params.courseId;

    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);
    /** #315 — the course could not be READ, which is not the same as absent. */
    const [loadFailed, setLoadFailed] = useState(false);
    /**
     * #378 — the learner's plan does not open this course, and it has a price,
     * so it can be bought on its own instead of them being sent away.
     */
    const [mustPurchase, setMustPurchase] = useState(false);
    const [purchasing, setPurchasing] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy");
            return;
        }
    }, [status, router]);

    useEffect(() => {
        let mounted = true;

        async function fetchCourse() {
            if (status !== "authenticated" || !session?.user) return;

            setLoading(true);
            try {
                const [courseReq, progressReq] = await Promise.all([
                    getCourseByIdAction(courseId),
                    getUserProgressAction(session.user.id, courseId),
                ]);

                if (mounted) {
                    if (courseReq.data) {
                        const userPlan = (session.user as any)?.serviceRegistrations?.academy?.plan || "free";
                        // #378 A course bought outright opens on the strength of
                        // that, not of the plan. The flag lives on the progress
                        // row, which is already loaded above.
                        const purchased = isPurchasedCourse(progressReq.data);
                        const hasAccess = checkCourseAccess(userPlan, courseReq.data.tier || "free", purchased);
                        const price = Number(courseReq.data.price ?? 0);

                        if (!hasAccess) {
                            /**
                             *   #378 A PRICED COURSE OFFERS ITSELF INSTEAD OF
                             *        EJECTING THE LEARNER.
                             *
                             *        This redirected everyone whose plan did not
                             *        cover the tier to /academy/application — the
                             *        whole-plan upgrade — including for courses
                             *        carrying a `price`, which #368 recorded as
                             *        "charged by nothing a learner can reach".
                             *        The initiator that charges it correctly
                             *        existed all along and had no caller.
                             *
                             *        A course with no price still redirects: there
                             *        is nothing to offer, and upgrading the plan
                             *        really is the only way in.
                             */
                            if (price > 0) {
                                setCourse(courseReq.data);
                                setProgress(progressReq.data || null);
                                setMustPurchase(true);
                                return;
                            }
                            showToast("Upgrade your subscription to access this course", "error");
                            router.push("/academy/application");
                            return;
                        }

                        setMustPurchase(false);
                        setCourse(courseReq.data);

                        if (!progressReq.data) {
                            // Automatically enroll in the background if they have access but no progress document yet
                            const enrollResult = await enrollInCourseAction(session.user.id, courseId);
                            if (enrollResult.success) {
                                const newProgressReq = await getUserProgressAction(session.user.id, courseId);
                                setProgress(newProgressReq.data || null);
                            } else {
                                // The refusal was thrown away — #315.
                                //
                                // enrollInCourseAction returns two carefully
                                // distinguished messages here, written that way
                                // by an earlier fix precisely so a learner can
                                // tell "your package does not cover this course"
                                // from "you have not chosen a package at all".
                                // handleEnroll below shows them. This path,
                                // which is the one that runs on page load,
                                // discarded both and left the learner looking at
                                // a course they appear not to be enrolled on
                                // with no reason given.
                                //
                                // Reachable despite the access check above: that
                                // check reads the plan cached on the session,
                                // and the server reads the live one.
                                setProgress(null);
                                showToast(enrollResult.error || "Could not enrol you on this course", "error");
                            }
                        } else {
                            setProgress(progressReq.data || null);
                        }
                    } else {
                        // Was an empty `else { // Handle not found }`. A course
                        // that could not be read left `course` null, and the
                        // render below says "Course Not Found" — so a failed
                        // request told the learner the course does not exist.
                        // #307's shape.
                        setLoadFailed(!!courseReq.error);
                    }
                }
            } catch (error) {
                logger.error("Error:", error);
                if (mounted) setLoadFailed(true);
            } finally {
                if (mounted) setLoading(false);
            }
        }

        fetchCourse();

        return () => { mounted = false; };
        // router and showToast were missing. Both are stable — useRouter's
        // instance is, and showToast is useCallback-memoised in ToastContext —
        // so naming them changes no behaviour and stops the effect closing over
        // stale copies.
    }, [courseId, session, status, router, showToast]);


    // Function to manually refresh data
    const loadCourse = useCallback(async () => {
        if (!session?.user) return;
        const [courseReq, progressReq] = await Promise.all([
            getCourseByIdAction(courseId),
            getUserProgressAction(session.user.id, courseId),
        ]);
        if (courseReq.data) {
            setCourse(courseReq.data);
            setProgress(progressReq.data || null);
        } else {
            // #315 — this refreshed the page after a successful enrolment and
            // said nothing when the refresh itself failed, leaving the learner
            // on stale state with a success toast beside it.
            showToast(courseReq.error || "Could not reload this course", "error");
        }
    }, [courseId, session, showToast]);



    async function handleEnroll() {
        if (!session?.user) return;

        setEnrolling(true);
        const result = await enrollInCourseAction(session.user.id, courseId);

        if (result.success) {
            await loadCourse(); // Refresh to show enrollment
            showToast("Successfully enrolled in course!", "success");
        } else {
            showToast(result.error || "Failed to enroll", "error");
        }

        setEnrolling(false);
    }

    /**
     *   #378 THE BUTTON THAT CHARGES FOR ONE COURSE.
     *
     *        initializeCoursePaymentAction has existed all along and had no
     *        caller (#368). It takes only the courseId and reads the price from
     *        the course document, so nothing the browser sends can decide what
     *        the learner is charged — which is why it is the one of the two
     *        initiators that gets wired.
     */
    async function handlePurchase() {
        if (!course) return;

        setPurchasing(true);
        try {
            const result = await initializeCoursePaymentAction(courseId);
            const authorizationUrl = (result as any)?.data?.authorizationUrl;

            if (result.success && authorizationUrl) {
                window.location.href = authorizationUrl;
                return;
            }

            // Said out loud rather than swallowed — #315's class. A learner
            // left on a button that did nothing has no way to tell a refusal
            // from a dead control.
            showToast(result.error || "Could not start the payment. Please try again.", "error");
        } catch {
            showToast("Could not reach the payment service. Please try again.", "error");
        } finally {
            setPurchasing(false);
        }
    }

    function handleStartLearning() {
        if (!course || !course.modules.length) return;

        // Navigate to first lesson of first module
        const firstModule = course.modules[0];
        const firstLesson = firstModule?.lessons?.[0];

        if (firstLesson) {
            router.push(`/academy/${courseId}/lesson/${firstLesson.id}`);
        }
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="text-center">
                    {/* #315 — a failed request used to render as "Course Not
                        Found", which tells the learner the course does not
                        exist when what happened is that we could not read it. */}
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                        {loadFailed ? "We could not load this course" : "Course Not Found"}
                    </h2>
                    {loadFailed && (
                        <p className="text-slate-600 mb-4 max-w-sm mx-auto text-sm">
                            This is a problem reaching the server, not a missing course.
                            Try again in a moment.
                        </p>
                    )}
                    <button
                        onClick={() => router.push("/academy")}
                        className="text-blue-500 hover:text-blue-600 font-medium"
                    >
                        ← Back to Academy
                    </button>
                </div>
            </div>
        );
    }

    const isEnrolled = progress !== null;
    const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const completedLessons = progress?.completedLessons?.length || 0;
    const progressPercent = progress?.overallProgress || 0;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header Section */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8">
                    <div className="bg-linear-to-r from-blue-600 to-cyan-600 p-8 text-white">
                        <button
                            onClick={() => router.push("/academy")}
                            className="mb-4 text-white/90 hover:text-white text-sm font-medium"
                        >
                            ← Back to Academy
                        </button>

                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-medium mb-3">
                                    {course.level.charAt(0).toUpperCase() + course.level.slice(1)}
                                </div>
                                <h1 data-testid="course-title" className="text-4xl font-bold mb-3">{course.title}</h1>
                                <p className="text-lg text-white/90 mb-4">{course.description}</p>

                                <div className="flex flex-wrap items-center gap-4 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        <span>{course.instructor}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        <span>{course.duration}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="w-4 h-4" />
                                        <span>{course.modules.length} Modules • {totalLessons} Lessons</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Enrollment/Progress Section */}
                    <div className="p-8 border-t border-slate-200">
                        {/*
                          *   #378 THE PER-COURSE PURCHASE, WHICH THE PRODUCT
                          *        HAD NO WAY TO OFFER.
                          *
                          *        `course.price` was charged by nothing a learner
                          *        could reach (#368), and this screen redirected
                          *        anyone whose plan did not cover the tier to the
                          *        whole-plan upgrade. The learner now sees the
                          *        price and can buy this one course.
                          */}
                        {mustPurchase ? (
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                <div>
                                    <h3 className="font-semibold text-slate-900 mb-1">
                                        Buy this course
                                    </h3>
                                    <p className="text-sm text-slate-600">
                                        Your current package does not include this course. Buy it on its own
                                        for lifetime access, or upgrade your package to open every course at
                                        this tier.
                                    </p>
                                </div>
                                <div className="flex flex-col items-stretch md:items-end gap-2 shrink-0">
                                    <span className="text-2xl font-bold text-slate-900 md:text-right">
                                        {formatCurrency(Number(course.price ?? 0))}
                                    </span>
                                    <button
                                        onClick={handlePurchase}
                                        disabled={purchasing}
                                        className="px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                                    >
                                        {purchasing ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Starting payment...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Award className="w-5 h-5" />
                                                <span>Buy this course</span>
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => router.push("/academy/application")}
                                        className="text-sm text-slate-600 hover:text-slate-900 underline underline-offset-2"
                                    >
                                        Upgrade my package instead
                                    </button>
                                </div>
                            </div>
                        ) : isEnrolled ? (
                            <div>
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-slate-600">
                                            Course Progress
                                        </span>
                                        <span className="text-sm font-bold text-blue-600">
                                            {progressPercent}%
                                        </span>
                                    </div>
                                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-linear-to-r from-blue-500 to-cyan-500 transition-all duration-500"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-2">
                                        {completedLessons} of {totalLessons} lessons completed
                                    </p>
                                </div>

                                <button
                                    onClick={handleStartLearning}
                                    className="w-full md:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                                >
                                    <PlayCircle className="w-5 h-5" />
                                    <span>{progressPercent > 0 ? "Continue Learning" : "Start Learning"}</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-900 mb-1">
                                        Start your learning journey
                                    </h3>
                                    <p className="text-sm text-slate-600">
                                        Enroll now to access all course materials
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnroll}
                                    disabled={enrolling}
                                    className="px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl transition flex items-center gap-2"
                                >
                                    {enrolling ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            <span>Enrolling...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Award className="w-5 h-5" />
                                            <span>Enroll Now</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Course Modules */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6">
                        Course Modules
                    </h2>

                    <div className="space-y-6">
                        {course.modules.map((module, moduleIndex) => {
                            const moduleCompleted = progress?.completedModules?.includes(module.id) || false;
                            const quizScore = progress?.quizScores?.[module.id];

                            return (
                                <div
                                    key={module.id}
                                    data-testid="module-item"
                                    className={`border-2 rounded-xl p-6 ${moduleCompleted
                                        ? "border-green-200 bg-green-50"
                                        : "border-slate-200"
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="text-sm font-bold text-blue-600">
                                                    Module {moduleIndex + 1}
                                                </span>
                                                {moduleCompleted && (
                                                    <div className="flex items-center gap-1 text-green-600">
                                                        <CheckCircle className="w-4 h-4" />
                                                        <span className="text-xs font-medium">Completed</span>
                                                    </div>
                                                )}
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-900 mb-2">
                                                {module.title}
                                            </h3>
                                            <p className="text-sm text-slate-600">
                                                {module.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Lessons List */}
                                    <div className="space-y-2 mb-4">
                                        {module.lessons.map((lesson, lessonIndex) => {
                                            const lessonCompleted = progress?.completedLessons?.includes(lesson.id) || false;

                                            return (
                                                <button
                                                    key={lesson.id}
                                                    onClick={() => isEnrolled && router.push(`/academy/${courseId}/lesson/${lesson.id}`)}
                                                    disabled={!isEnrolled}
                                                    className={`w-full flex items-center justify-between p-4 rounded-lg transition ${isEnrolled
                                                        ? "hover:bg-slate-50"
                                                        : "opacity-50 cursor-not-allowed"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {lessonCompleted ? (
                                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                                        ) : (
                                                            <PlayCircle className="w-5 h-5 text-slate-400" />
                                                        )}
                                                        <div className="text-left">
                                                            <p className="text-sm font-medium text-slate-900">
                                                                {lesson.title}
                                                            </p>
                                                            <p className="text-xs text-slate-500">
                                                                {lesson.duration}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <ArrowRight className="w-4 h-4 text-slate-400" />
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Quiz Info */}
                                    {module.quiz && (
                                        <div className="pt-4 border-t border-slate-200">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium text-slate-900">
                                                        Module Quiz
                                                    </p>
                                                    <p className="text-xs text-slate-500">
                                                        {module.quiz.questions.length} questions • Passing score: {module.quiz.passingScore}%
                                                    </p>
                                                </div>
                                                {quizScore !== undefined && (
                                                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${quizScore >= module.quiz.passingScore
                                                        ? "bg-green-100 text-green-700"
                                                        : "bg-red-100 text-red-700"
                                                        }`}>
                                                        Score: {quizScore}%
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
