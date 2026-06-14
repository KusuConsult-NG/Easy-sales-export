"use client";

import { useState, useEffect, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ArrowLeft, CheckCircle, XCircle, Loader2, Trophy,
    AlertTriangle, RefreshCw
} from "lucide-react";
import {
    getCourseByIdAction,
    submitQuizScoreAction,
    type Course,
    type CourseModule,
    type Quiz
} from "@/app/actions/academy";
import { useToast } from "@/contexts/ToastContext";

interface QuizPageProps {
    params: Promise<{ courseId: string; moduleId: string }>;
}

export default function QuizPage(props: QuizPageProps) {
    // Next.js 16: params is now a Promise, must unwrap with React.use()
    const params = use(props.params);
    const { courseId, moduleId } = params;

    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const [course, setCourse] = useState<Course | null>(null);
    const [currentModule, setCurrentModule] = useState<CourseModule | null>(null);
    const [quiz, setQuiz] = useState<Quiz | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [quizStarted, setQuizStarted] = useState(false);
    const [quizCompleted, setQuizCompleted] = useState(false);
    const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
    const [score, setScore] = useState<number | null>(null);
    const [passed, setPassed] = useState<boolean>(false);

    // Timer & Anti-Cheat States
    const [timeLeft, setTimeLeft] = useState<number>(600);
    const [strikes, setStrikes] = useState<number>(0);
    const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
    const [warningStrikeCount, setWarningStrikeCount] = useState<number>(0);

    const lastStrikeTime = useRef<number>(0);
    const strikesRef = useRef<number>(0);
    strikesRef.current = strikes;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy");
            return;
        }
    }, [status, router]);

    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            loadQuiz();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session, courseId, moduleId]);

    // Resume quiz if timer is already in localStorage
    useEffect(() => {
        if (quiz && currentModule) {
            const storedEnd = localStorage.getItem(`quiz_timer_end_${moduleId}`);
            if (storedEnd) {
                const end = parseInt(storedEnd, 10);
                if (end > Date.now()) {
                    setQuizStarted(true);
                } else {
                    localStorage.removeItem(`quiz_timer_end_${moduleId}`);
                    localStorage.removeItem(`quiz_strikes_${moduleId}`);
                }
            }
        }
    }, [quiz, currentModule, moduleId]);

    // Timer Tick and Initialization
    useEffect(() => {
        if (!quizStarted || !moduleId || !quiz || quizCompleted) return;

        let timerEnd = localStorage.getItem(`quiz_timer_end_${moduleId}`);
        if (!timerEnd) {
            const newEnd = Date.now() + 600 * 1000;
            localStorage.setItem(`quiz_timer_end_${moduleId}`, newEnd.toString());
            timerEnd = newEnd.toString();
        }
        const endTime = parseInt(timerEnd, 10);

        const storedStrikes = localStorage.getItem(`quiz_strikes_${moduleId}`);
        const initialStrikes = storedStrikes ? parseInt(storedStrikes, 10) : 0;
        setStrikes(initialStrikes);

        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(interval);
                handleAutoSubmit("Time is up! Submitting your quiz automatically.");
            }
        }, 1000);

        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quizStarted, moduleId, quiz, quizCompleted]);

    // Anti-Cheat Listeners
    useEffect(() => {
        if (!quizStarted || !moduleId || !quiz || quizCompleted) return;

        const handleStrike = () => {
            const now = Date.now();
            if (now - lastStrikeTime.current < 2000) {
                // Cooldown to prevent double strike registrations
                return;
            }
            lastStrikeTime.current = now;

            const nextStrikes = strikesRef.current + 1;
            setStrikes(nextStrikes);
            localStorage.setItem(`quiz_strikes_${moduleId}`, nextStrikes.toString());

            if (nextStrikes >= 3) {
                handleAutoSubmit("Quiz auto-submitted due to multiple window focus losses.");
            } else {
                setWarningStrikeCount(nextStrikes);
                setShowWarningModal(true);
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                handleStrike();
            }
        };

        const handleBlur = () => {
            handleStrike();
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("blur", handleBlur);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("blur", handleBlur);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quizStarted, moduleId, quiz, quizCompleted]);

    async function loadQuiz() {
        setLoading(true);

        const courseReq = await getCourseByIdAction(courseId);

        if (!courseReq.success || !courseReq.data) {
            setLoading(false);
            return;
        }
        
        const courseData = courseReq.data;

        // Find module and quiz
        const courseModule = courseData.modules.find((m: CourseModule) => m.id === moduleId);

        setCourse(courseData);
        setCurrentModule(courseModule || null);
        setQuiz(courseModule?.quiz || null);
        setLoading(false);
    }

    function handleSelectAnswer(questionId: string, answerIndex: number) {
        setSelectedAnswers(prev => ({
            ...prev,
            [questionId]: answerIndex
        }));
    }

    async function submitQuiz(answers: Record<string, number> = selectedAnswers) {
        if (!session?.user || !quiz || !currentModule) return;

        // Calculate score
        let correctAnswers = 0;
        quiz.questions.forEach(question => {
            if (answers[question.id] === question.correctAnswer) {
                correctAnswers++;
            }
        });

        const percentage = Math.round((correctAnswers / quiz.questions.length) * 100);
        setScore(percentage);

        // Submit to backend
        setSubmitting(true);
        const result = await submitQuizScoreAction(
            session.user.id,
            courseId,
            moduleId,
            percentage
        );

        if (result.success && result.data) {
            setPassed(result.data.passed || false);
            setQuizCompleted(true);
            localStorage.removeItem(`quiz_timer_end_${moduleId}`);
            localStorage.removeItem(`quiz_strikes_${moduleId}`);
        } else {
            showToast(result.error || "Failed to submit quiz", "error");
        }

        setSubmitting(false);
    }

    async function handleSubmitQuiz() {
        await submitQuiz();
    }

    async function handleAutoSubmit(reason: string) {
        showToast(reason, "warning");
        await submitQuiz();
    }

    function handleRetry() {
        setSelectedAnswers({});
        setScore(null);
        setPassed(false);
        setQuizCompleted(false);
        setQuizStarted(false);
        localStorage.removeItem(`quiz_timer_end_${moduleId}`);
        localStorage.removeItem(`quiz_strikes_${moduleId}`);
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course || !currentModule || !quiz) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                        Quiz Not Found
                    </h2>
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="text-blue-500 hover:text-blue-600 font-medium"
                    >
                        ← Back to Course
                    </button>
                </div>
            </div>
        );
    }

    const allQuestionsAnswered = quiz.questions.every(q => selectedAnswers[q.id] !== undefined);

    // Quiz completed screen
    if (quizCompleted && score !== null) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
                <div className="max-w-2xl mx-auto">
                    <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                        {passed ? (
                            <>
                                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Trophy className="w-12 h-12 text-green-600" />
                                </div>
                                <h1 className="text-3xl font-bold text-slate-900 mb-3">
                                    Congratulations! 🎉
                                </h1>
                                <p className="text-lg text-slate-600 mb-6">
                                    You passed the quiz!
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <XCircle className="w-12 h-12 text-red-600" />
                                </div>
                                <h1 className="text-3xl font-bold text-slate-900 mb-3">
                                    Not Quite There
                                </h1>
                                <p className="text-lg text-slate-600 mb-6">
                                    You need {quiz.passingScore ?? 95}% to pass. Keep studying!
                                </p>
                            </>
                        )}

                        {/* Score Display */}
                        <div className={`inline-block px-8 py-4 rounded-2xl mb-8 ${passed
                            ? "bg-green-100"
                            : "bg-red-100"
                            }`}>
                            <p className="text-sm font-medium text-slate-600 mb-1">
                                Your Score
                            </p>
                            <p className={`text-5xl font-bold ${passed
                                ? "text-green-600"
                                : "text-red-600"
                                }`}>
                                {score}%
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Passing score: {quiz.passingScore ?? 95}%
                            </p>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-3">
                            {!passed && (
                                <button
                                    onClick={handleRetry}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                                >
                                    <RefreshCw className="w-5 h-5" />
                                    Retry Quiz
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    localStorage.removeItem(`quiz_timer_end_${moduleId}`);
                                    localStorage.removeItem(`quiz_strikes_${moduleId}`);
                                    router.push(`/academy/${courseId}`);
                                }}
                                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold rounded-xl transition"
                            >
                                Back to Course
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Quiz start screen
    if (!quizStarted) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
                <div className="max-w-2xl mx-auto">
                    <button
                        onClick={() => {
                            localStorage.removeItem(`quiz_timer_end_${moduleId}`);
                            localStorage.removeItem(`quiz_strikes_${moduleId}`);
                            router.push(`/academy/${courseId}`);
                        }}
                        className="mb-6 text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Course
                    </button>

                    <div className="bg-white rounded-2xl shadow-xl p-8">
                        <h1 className="text-3xl font-bold text-slate-900 mb-4">
                            {currentModule.title} - Quiz
                        </h1>
                        <p className="text-slate-600 mb-8">
                            Test your knowledge of this module.
                        </p>

                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
                            <h3 className="font-semibold text-slate-900 mb-4">
                                Quiz Information
                            </h3>
                            <div className="space-y-2 text-sm text-slate-600">
                                <p>📝 <strong>{quiz.questions.length}</strong> questions</p>
                                <p>🎯 Passing score: <strong>{quiz.passingScore ?? 95}%</strong></p>
                                <p>⏱️ Time limit: <strong>10 minutes</strong> (strictly monitored)</p>
                                <p>⚠️ Anti-cheat protection active: window focus loss or tab switching will log strikes.</p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setQuizStarted(true);
                                const newEnd = Date.now() + 600 * 1000;
                                localStorage.setItem(`quiz_timer_end_${moduleId}`, newEnd.toString());
                                setTimeLeft(600);
                                setStrikes(0);
                                localStorage.setItem(`quiz_strikes_${moduleId}`, "0");
                            }}
                            className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                        >
                            Start Quiz
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Quiz questions screen
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto">
                <button
                    onClick={() => {
                        localStorage.removeItem(`quiz_timer_end_${moduleId}`);
                        localStorage.removeItem(`quiz_strikes_${moduleId}`);
                        router.push(`/academy/${courseId}`);
                    }}
                    className="mb-6 text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Course
                </button>

                <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">
                                {currentModule.title} - Quiz
                            </h1>
                            <p className="text-xs text-slate-500 mt-1">
                                Complete all questions to finish.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                                <span className="text-xs font-semibold text-slate-700">
                                    Strikes: {strikes}/3
                                </span>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-700">
                                    Time Left: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                                </span>
                            </div>
                            <div className="text-xs text-slate-600 font-medium bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg">
                                {Object.keys(selectedAnswers).length} / {quiz.questions.length} answered
                            </div>
                        </div>
                    </div>

                    {/* Questions */}
                    <div className="space-y-8">
                        {quiz.questions.map((question, questionIndex) => (
                            <div key={question.id} className="pb-6 border-b border-slate-200 last:border-0">
                                <p className="font-semibold text-slate-900 mb-4">
                                    <span className="text-blue-600 mr-2">
                                        {questionIndex + 1}.
                                    </span>
                                    {question.question}
                                </p>

                                <div className="space-y-3">
                                    {question.options.map((option, optionIndex) => (
                                        <button
                                            key={optionIndex}
                                            onClick={() => handleSelectAnswer(question.id, optionIndex)}
                                            className={`w-full text-left px-4 py-3 rounded-xl border-2 transition ${selectedAnswers[question.id] === optionIndex
                                                ? "border-blue-500 bg-blue-50"
                                                : "border-slate-200 hover:border-slate-300"
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedAnswers[question.id] === optionIndex
                                                    ? "border-blue-500 bg-blue-500"
                                                    : "border-slate-300"
                                                    }`}>
                                                    {selectedAnswers[question.id] === optionIndex && (
                                                        <div className="w-2 h-2 bg-white rounded-full" />
                                                    )}
                                                </div>
                                                <span className="text-slate-900">
                                                    {option}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Submit Button */}
                {!allQuestionsAnswered && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-yellow-800">
                            Please answer all questions before submitting
                        </p>
                    </div>
                )}

                <button
                    onClick={handleSubmitQuiz}
                    disabled={!allQuestionsAnswered || submitting}
                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Submitting...</span>
                        </>
                    ) : (
                        <>
                            <CheckCircle className="w-5 h-5" />
                            <span>Submit Quiz</span>
                        </>
                    )}
                </button>
            </div>

            {/* Dark Glassmorphic Strike Warning Modal */}
            {showWarningModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md transition-all duration-300">
                    <div className="bg-slate-900/80 border border-slate-700/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl max-w-md w-full text-center text-white relative animate-in fade-in zoom-in-95 duration-200 mx-4">
                        <div className="w-16 h-16 bg-amber-500/20 border border-amber-500/30 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle className="w-10 h-10 text-amber-500 animate-bounce" />
                        </div>
                        <h2 className="text-2xl font-bold mb-3 tracking-wide">Anti-Cheat Warning</h2>
                        <p className="text-slate-300 mb-6 text-sm leading-relaxed">
                            You have switched tabs or lost focus from the quiz window. This is flagged as suspicious behavior. 
                            <br />
                            <span className="text-amber-400 font-semibold text-base block mt-2">Strike {warningStrikeCount} of 3</span>
                        </p>
                        <div className="bg-slate-800/50 border border-slate-700/30 rounded-xl p-4 mb-6">
                            <p className="text-xs text-slate-400">
                                Switching tabs or losing focus again will result in automatic submission of your quiz with your current answers.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowWarningModal(false)}
                            className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-bold rounded-xl transition-all duration-200 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30"
                        >
                            I Understand
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
