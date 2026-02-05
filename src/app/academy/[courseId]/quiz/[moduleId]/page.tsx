"use client";

import { useState, useEffect } from "react";
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

interface QuizPageProps {
    params: { courseId: string; moduleId: string };
}

export default function QuizPage({ params }: QuizPageProps) {
    const router = useRouter();
    const { data: session, status } = useSession();
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

    const { courseId, moduleId } = params;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            loadQuiz();
        }
    }, [status, session, courseId, moduleId]);

    async function loadQuiz() {
        setLoading(true);

        const courseData = await getCourseByIdAction(courseId);

        if (!courseData) {
            setLoading(false);
            return;
        }

        // Find module and quiz
        const module = courseData.modules.find(m => m.id === moduleId);

        setCourse(courseData);
        setCurrentModule(module || null);
        setQuiz(module?.quiz || null);
        setLoading(false);
    }

    function handleSelectAnswer(questionId: string, answerIndex: number) {
        setSelectedAnswers(prev => ({
            ...prev,
            [questionId]: answerIndex
        }));
    }

    async function handleSubmitQuiz() {
        if (!session?.user || !quiz || !currentModule) return;

        // Calculate score
        let correctAnswers = 0;
        quiz.questions.forEach(question => {
            if (selectedAnswers[question.id] === question.correctAnswer) {
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

        if (result.success) {
            setPassed(result.passed || false);
            setQuizCompleted(true);
        } else {
            alert(result.error || "Failed to submit quiz");
        }

        setSubmitting(false);
    }

    function handleRetry() {
        setSelectedAnswers({});
        setScore(null);
        setPassed(false);
        setQuizCompleted(false);
        setQuizStarted(false);
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course || !currentModule || !quiz) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
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
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
                <div className="max-w-2xl mx-auto">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
                        {passed ? (
                            <>
                                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Trophy className="w-12 h-12 text-green-600 dark:text-green-400" />
                                </div>
                                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                                    Congratulations! 🎉
                                </h1>
                                <p className="text-lg text-slate-600 dark:text-slate-400 mb-6">
                                    You passed the quiz!
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
                                </div>
                                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                                    Not Quite There
                                </h1>
                                <p className="text-lg text-slate-600 dark:text-slate-400 mb-6">
                                    You need {quiz.passingScore}% to pass. Keep studying!
                                </p>
                            </>
                        )}

                        {/* Score Display */}
                        <div className={`inline-block px-8 py-4 rounded-2xl mb-8 ${passed
                                ? "bg-green-100 dark:bg-green-900/30"
                                : "bg-red-100 dark:bg-red-900/30"
                            }`}>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                Your Score
                            </p>
                            <p className={`text-5xl font-bold ${passed
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-red-600 dark:text-red-400"
                                }`}>
                                {score}%
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Passing score: {quiz.passingScore}%
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
                                onClick={() => router.push(`/academy/${courseId}`)}
                                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-xl transition"
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
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
                <div className="max-w-2xl mx-auto">
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="mb-6 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm font-medium flex items-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Course
                    </button>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8">
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">
                            {currentModule.title} - Quiz
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400 mb-8">
                            Test your knowledge of this module
                        </p>

                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 mb-8">
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                                Quiz Information
                            </h3>
                            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                                <p>📝 <strong>{quiz.questions.length}</strong> questions</p>
                                <p>🎯 Passing score: <strong>{quiz.passingScore}%</strong></p>
                                <p>⏱️ No time limit - take your time</p>
                                <p>🔄 You can retake the quiz if you don't pass</p>
                            </div>
                        </div>

                        <button
                            onClick={() => setQuizStarted(true)}
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
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                <button
                    onClick={() => router.push(`/academy/${courseId}`)}
                    className="mb-6 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm font-medium flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Course
                </button>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-6">
                    <div className="flex items-center justify-between mb-6">
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {currentModule.title} - Quiz
                        </h1>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                            {Object.keys(selectedAnswers).length} / {quiz.questions.length} answered
                        </div>
                    </div>

                    {/* Questions */}
                    <div className="space-y-8">
                        {quiz.questions.map((question, questionIndex) => (
                            <div key={question.id} className="pb-6 border-b border-slate-200 dark:border-slate-700 last:border-0">
                                <p className="font-semibold text-slate-900 dark:text-white mb-4">
                                    <span className="text-blue-600 dark:text-blue-400 mr-2">
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
                                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedAnswers[question.id] === optionIndex
                                                        ? "border-blue-500 bg-blue-500"
                                                        : "border-slate-300 dark:border-slate-600"
                                                    }`}>
                                                    {selectedAnswers[question.id] === optionIndex && (
                                                        <div className="w-2 h-2 bg-white rounded-full" />
                                                    )}
                                                </div>
                                                <span className="text-slate-900 dark:text-white">
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
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            Please answer all questions before submitting
                        </p>
                    </div>
                )}

                <button
                    onClick={handleSubmitQuiz}
                    disabled={!allQuestionsAnswered || submitting}
                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
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
        </div>
    );
}
