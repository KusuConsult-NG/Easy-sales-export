"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

type QuestionType = "mcq-single" | "mcq-multiple" | "true-false" | "short-answer";

type Answer = {
    id: string;
    text: string;
    isCorrect?: boolean;
};

type Question = {
    id: string;
    type: QuestionType;
    question: string;
    points: number;
    answers?: Answer[];
};

type QuizData = {
    id: string;
    title: string;
    description: string;
    passingScore: number;
    timeLimit: number;
    maxAttempts: number;
    shuffleQuestions: boolean;
    shuffleAnswers: boolean;
    questions: Question[];
};

export default function StudentQuizPage({ params }: { params: { courseId: string } }) {
    const router = useRouter();
    const [quiz, setQuiz] = useState<QuizData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [attemptNumber, setAttemptNumber] = useState(1);

    useEffect(() => {
        fetchQuiz();
    }, []);

    useEffect(() => {
        if (hasStarted && timeRemaining !== null && timeRemaining > 0) {
            const timer = setInterval(() => {
                setTimeRemaining(prev => {
                    if (prev === null || prev <= 1) {
                        handleAutoSubmit();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [hasStarted, timeRemaining]);

    const fetchQuiz = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/academy/quiz/${params.courseId}`);
            const data = await response.json();

            if (data.success) {
                let quizData = data.quiz;

                // Shuffle questions if enabled
                if (quizData.shuffleQuestions) {
                    quizData.questions = shuffleArray([...quizData.questions]);
                }

                // Shuffle answers if enabled
                if (quizData.shuffleAnswers) {
                    quizData.questions = quizData.questions.map((q: Question) => {
                        if (q.answers && q.type !== "true-false") {
                            return { ...q, answers: shuffleArray([...q.answers]) };
                        }
                        return q;
                    });
                }

                setQuiz(quizData);
                setAttemptNumber(data.attemptNumber || 1);
            }
        } catch (error) {
            console.error("Failed to fetch quiz:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const shuffleArray = <T,>(array: T[]): T[] => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const startQuiz = () => {
        setHasStarted(true);
        if (quiz?.timeLimit && quiz.timeLimit > 0) {
            setTimeRemaining(quiz.timeLimit * 60); // Convert minutes to seconds
        }
    };

    const handleAnswerChange = (questionId: string, answer: string | string[]) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: answer
        }));
    };

    const handleMultipleChoice = (questionId: string, answerId: string, isMultiple: boolean) => {
        if (isMultiple) {
            const current = (answers[questionId] as string[]) || [];
            const updated = current.includes(answerId)
                ? current.filter(id => id !== answerId)
                : [...current, answerId];
            handleAnswerChange(questionId, updated);
        } else {
            handleAnswerChange(questionId, answerId);
        }
    };

    const handleAutoSubmit = async () => {
        if (!quiz) return;
        await submitQuiz(true);
    };

    const submitQuiz = async (autoSubmit = false) => {
        if (!quiz) return;

        setIsSubmitting(true);
        try {
            const response = await fetch("/api/academy/quiz/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    quizId: quiz.id,
                    courseId: params.courseId,
                    answers,
                    attemptNumber,
                    autoSubmit,
                }),
            });

            const data = await response.json();

            if (data.success) {
                router.push(`/academy/courses/${params.courseId}/quiz/results?attemptId=${data.attemptId}`);
            } else {
                alert(data.message || "Failed to submit quiz");
            }
        } catch (error) {
            alert("An error occurred while submitting the quiz");
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading quiz...</p>
                </div>
            </div>
        );
    }

    if (!quiz) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Quiz Not Found</h2>
                    <p className="text-slate-600 dark:text-slate-400">This quiz doesn't exist or has been removed.</p>
                </div>
            </div>
        );
    }

    if (!hasStarted) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12">
                <div className="max-w-3xl mx-auto px-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8">
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">
                            {quiz.title}
                        </h1>
                        {quiz.description && (
                            <p className="text-slate-600 dark:text-slate-400 mb-8">
                                {quiz.description}
                            </p>
                        )}

                        <div className="space-y-4 mb-8">
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">Questions</span>
                                <span className="text-sm text-slate-600 dark:text-slate-400">{quiz.questions.length}</span>
                            </div>
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">Passing Score</span>
                                <span className="text-sm text-slate-600 dark:text-slate-400">{quiz.passingScore}%</span>
                            </div>
                            {quiz.timeLimit > 0 && (
                                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <span className="text-sm font-semibold text-slate-900 dark:text-white">Time Limit</span>
                                    <span className="text-sm text-slate-600 dark:text-slate-400">{quiz.timeLimit} minutes</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">Attempt</span>
                                <span className="text-sm text-slate-600 dark:text-slate-400">{attemptNumber} of {quiz.maxAttempts}</span>
                            </div>
                        </div>

                        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-8">
                            <h3 className="text-sm font-bold text-blue-900 dark:text-blue-200 mb-2">Instructions</h3>
                            <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
                                <li>Answer all questions to the best of your ability</li>
                                {quiz.timeLimit > 0 && <li>The quiz will auto-submit when time runs out</li>}
                                <li>You can navigate between questions using the navigation buttons</li>
                                <li>Your answers are saved automatically</li>
                            </ul>
                        </div>

                        <button
                            onClick={startQuiz}
                            className="w-full px-8 py-4 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all"
                        >
                            Start Quiz
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const currentQuestion = quiz.questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / quiz.questions.length) * 100;
    const answeredQuestions = Object.keys(answers).length;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header with Timer */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                                {quiz.title}
                            </h1>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                Question {currentQuestionIndex + 1} of {quiz.questions.length}
                            </p>
                        </div>
                        {timeRemaining !== null && (
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${timeRemaining < 60
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                    : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                                }`}>
                                <Clock className="w-5 h-5" />
                                <span className="font-mono font-bold text-lg">
                                    {formatTime(timeRemaining)}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-4">
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                            <div
                                className="bg-primary h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                            {answeredQuestions} of {quiz.questions.length} answered
                        </p>
                    </div>
                </div>

                {/* Question */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 mb-6">
                    <div className="mb-6">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="px-4 py-2 bg-primary/20 text-primary font-bold rounded-lg">
                                Q{currentQuestionIndex + 1}
                            </span>
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                                {currentQuestion.points} point{currentQuestion.points !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <p className="text-xl font-semibold text-slate-900 dark:text-white leading-relaxed">
                            {currentQuestion.question}
                        </p>
                    </div>

                    {/* Answer Options */}
                    <div className="space-y-3">
                        {currentQuestion.type === "short-answer" ? (
                            <textarea
                                value={(answers[currentQuestion.id] as string) || ""}
                                onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                                rows={5}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Type your answer here..."
                            />
                        ) : (
                            currentQuestion.answers?.map((answer) => {
                                const isMultiple = currentQuestion.type === "mcq-multiple";
                                const isSelected = isMultiple
                                    ? ((answers[currentQuestion.id] as string[]) || []).includes(answer.id)
                                    : answers[currentQuestion.id] === answer.id;

                                return (
                                    <button
                                        key={answer.id}
                                        onClick={() => handleMultipleChoice(currentQuestion.id, answer.id, isMultiple)}
                                        className={`w-full p-4 text-left rounded-lg border-2 transition-all ${isSelected
                                                ? 'border-primary bg-primary/10 dark:bg-primary/20'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-primary/50 bg-slate-50 dark:bg-slate-900'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-5 h-5 rounded ${isMultiple ? 'rounded-md' : 'rounded-full'} border-2 flex items-center justify-center ${isSelected
                                                    ? 'border-primary bg-primary'
                                                    : 'border-slate-300 dark:border-slate-600'
                                                }`}>
                                                {isSelected && (
                                                    <CheckCircle className="w-4 h-4 text-white" fill="currentColor" />
                                                )}
                                            </div>
                                            <span className="text-slate-900 dark:text-white font-medium">
                                                {answer.text}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between gap-4">
                    <button
                        onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentQuestionIndex === 0}
                        className="px-6 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <ChevronLeft className="w-5 h-5" />
                        Previous
                    </button>

                    {currentQuestionIndex < quiz.questions.length - 1 ? (
                        <button
                            onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                            className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl transition-all flex items-center gap-2"
                        >
                            Next
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    ) : (
                        <button
                            onClick={() => submitQuiz(false)}
                            disabled={isSubmitting}
                            className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="w-5 h-5" />
                                    Submit Quiz
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
