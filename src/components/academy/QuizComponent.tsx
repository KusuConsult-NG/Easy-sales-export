"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Award, Loader2 } from "lucide-react";
import { submitQuizScoreAction, type Quiz } from "@/app/actions/academy";
import { useToast } from "@/contexts/ToastContext";

interface QuizComponentProps {
    quiz: Quiz;
    moduleId: string;
    courseId: string;
    userId: string;
    existingScore?: number;
    onComplete: () => void;
}

export default function QuizComponent({
    quiz,
    moduleId,
    courseId,
    userId,
    existingScore,
    onComplete,
}: QuizComponentProps) {
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [submitted, setSubmitted] = useState(false);
    const [score, setScore] = useState<number | null>(existingScore || null);
    const [submitting, setSubmitting] = useState(false);
    const { showToast } = useToast();

    async function handleSubmit() {
        if (Object.keys(answers).length !== quiz.questions.length) {
            showToast("Please answer all questions before submitting", "warning");
            return;
        }

        setSubmitting(true);

        // Calculate score
        let correct = 0;
        quiz.questions.forEach((q) => {
            if (answers[q.id] === q.correctAnswer) {
                correct++;
            }
        });

        const calculatedScore = Math.round((correct / quiz.questions.length) * 100);
        setScore(calculatedScore);

        // Submit to backend
        await submitQuizScoreAction(userId, courseId, moduleId, calculatedScore);

        setSubmitted(true);
        setSubmitting(false);

        // Refresh parent
        onComplete();
    };

    function handleRetry() {
        setAnswers({});
        setSubmitted(false);
        setScore(null);
    };

    const passed = score !== null && score >= quiz.passingScore;

    return (
        <div className="space-y-6">
            {/* Questions */}
            {quiz.questions.map((question, qIndex) => (
                <div key={question.id} className="p-6 bg-slate-50 rounded-xl">
                    <p className="font-semibold text-slate-900 mb-4">
                        {qIndex + 1}. {question.question}
                    </p>
                    <div className="space-y-3">
                        {question.options.map((option, optIndex) => {
                            const isCorrect = optIndex === question.correctAnswer;
                            const isSelected = answers[question.id] === optIndex;
                            const showFeedback = submitted;

                            return (
                                <label
                                    key={optIndex}
                                    className={`block p-4 rounded-lg border-2 transition cursor-pointer ${showFeedback
                                        ? isCorrect
                                            ? 'border-green-500 bg-green-50'
                                            : isSelected
                                                ? 'border-red-500 bg-red-50'
                                                : 'border-slate-200'
                                        : isSelected
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-slate-200 hover:border-blue-300'
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="radio"
                                                name={question.id}
                                                value={optIndex}
                                                checked={isSelected}
                                                onChange={() =>
                                                    !submitted && setAnswers({ ...answers, [question.id]: optIndex })
                                                }
                                                disabled={submitted}
                                                className="w-4 h-4"
                                            />
                                            <span className="text-slate-900">{option}</span>
                                        </div>
                                        {showFeedback && isCorrect && (
                                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                        )}
                                        {showFeedback && !isCorrect && isSelected && (
                                            <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                                        )}
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Submit/Results */}
            {!submitted ? (
                <button
                    onClick={handleSubmit}
                    disabled={
                        submitting || Object.keys(answers).length !== quiz.questions.length
                    }
                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Submitting...</span>
                        </>
                    ) : (
                        <span>Submit Quiz</span>
                    )}
                </button>
            ) : (
                <div className="text-center p-8 bg-slate-50 rounded-xl">
                    <Award
                        className={`w-20 h-20 mx-auto mb-4 ${passed ? "text-green-600" : "text-red-600"
                            }`}
                    />
                    <h3 className="text-3xl font-bold text-slate-900 mb-2">
                        {passed ? "Quiz Passed! 🎉" : "Quiz Failed"}
                    </h3>
                    <p className="text-xl text-slate-600 mb-1">
                        Your Score: <span className="font-bold">{score}%</span>
                    </p>
                    <p className="text-sm text-slate-500 mb-6">
                        Passing score: {quiz.passingScore}%
                    </p>

                    {passed ? (
                        <p className="text-green-600 font-medium">
                            Great job! You can proceed to the next module.
                        </p>
                    ) : (
                        <button
                            onClick={handleRetry}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                        >
                            Try Again
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
