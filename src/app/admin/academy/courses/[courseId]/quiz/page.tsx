"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, X, Save, Eye } from "lucide-react";

type QuestionType = "mcq-single" | "mcq-multiple" | "true-false" | "short-answer";

type Answer = {
    id: string;
    text: string;
    isCorrect: boolean;
};

type Question = {
    id: string;
    type: QuestionType;
    question: string;
    points: number;
    answers?: Answer[];
    correctAnswer?: string;
};

type QuizData = {
    courseId: string;
    title: string;
    description: string;
    passingScore: number;
    timeLimit: number;
    maxAttempts: number;
    shuffleQuestions: boolean;
    shuffleAnswers: boolean;
    questions: Question[];
};

export default function QuizBuilderPage({ params }: { params: { courseId: string } }) {
    const router = useRouter();
    const [isSaving, setIsSaving] = useState(false);

    const [quizData, setQuizData] = useState<QuizData>({
        courseId: params.courseId,
        title: "",
        description: "",
        passingScore: 70,
        timeLimit: 0,
        maxAttempts: 3,
        shuffleQuestions: false,
        shuffleAnswers: false,
        questions: [],
    });

    const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
    const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);

    const questionTypes: { value: QuestionType; label: string }[] = [
        { value: "mcq-single", label: "Multiple Choice (Single Answer)" },
        { value: "mcq-multiple", label: "Multiple Choice (Multiple Answers)" },
        { value: "true-false", label: "True/False" },
        { value: "short-answer", label: "Short Answer" },
    ];

    const createNewQuestion = (type: QuestionType): Question => {
        const baseQuestion = {
            id: Date.now().toString(),
            type,
            question: "",
            points: 1,
        };

        if (type === "mcq-single" || type === "mcq-multiple") {
            return {
                ...baseQuestion,
                answers: [
                    { id: "1", text: "", isCorrect: false },
                    { id: "2", text: "", isCorrect: false },
                ],
            };
        } else if (type === "true-false") {
            return {
                ...baseQuestion,
                answers: [
                    { id: "true", text: "True", isCorrect: false },
                    { id: "false", text: "False", isCorrect: false },
                ],
            };
        } else {
            return {
                ...baseQuestion,
                correctAnswer: "",
            };
        }
    };

    const addQuestion = (type: QuestionType) => {
        const newQuestion = createNewQuestion(type);
        setEditingQuestion(newQuestion);
        setIsQuestionModalOpen(true);
    };

    const saveQuestion = () => {
        if (!editingQuestion) return;

        const existingIndex = quizData.questions.findIndex(q => q.id === editingQuestion.id);

        if (existingIndex >= 0) {
            const updated = [...quizData.questions];
            updated[existingIndex] = editingQuestion;
            setQuizData({ ...quizData, questions: updated });
        } else {
            setQuizData({
                ...quizData,
                questions: [...quizData.questions, editingQuestion],
            });
        }

        setIsQuestionModalOpen(false);
        setEditingQuestion(null);
    };

    const deleteQuestion = (id: string) => {
        if (confirm("Delete this question?")) {
            setQuizData({
                ...quizData,
                questions: quizData.questions.filter(q => q.id !== id),
            });
        }
    };

    const editQuestion = (question: Question) => {
        setEditingQuestion({ ...question });
        setIsQuestionModalOpen(true);
    };

    const addAnswer = () => {
        if (!editingQuestion || !editingQuestion.answers) return;

        setEditingQuestion({
            ...editingQuestion,
            answers: [
                ...editingQuestion.answers,
                { id: Date.now().toString(), text: "", isCorrect: false },
            ],
        });
    };

    const updateAnswer = (answerId: string, field: "text" | "isCorrect", value: string | boolean) => {
        if (!editingQuestion || !editingQuestion.answers) return;

        const updatedAnswers = editingQuestion.answers.map(ans => {
            if (ans.id === answerId) {
                return { ...ans, [field]: value };
            }
            // For single-choice MCQ, uncheck other answers
            if (field === "isCorrect" && value && editingQuestion.type === "mcq-single") {
                return { ...ans, isCorrect: false };
            }
            return ans;
        });

        setEditingQuestion({
            ...editingQuestion,
            answers: updatedAnswers,
        });
    };

    const deleteAnswer = (answerId: string) => {
        if (!editingQuestion || !editingQuestion.answers) return;

        setEditingQuestion({
            ...editingQuestion,
            answers: editingQuestion.answers.filter(ans => ans.id !== answerId),
        });
    };

    const handleSaveQuiz = async () => {
        if (!quizData.title || quizData.questions.length === 0) {
            alert("Please add a title and at least one question");
            return;
        }

        setIsSaving(true);
        try {
            const response = await fetch("/api/admin/academy/quiz/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(quizData),
            });

            const data = await response.json();

            if (data.success) {
                alert("Quiz saved successfully!");
                router.push(`/admin/academy/courses/${params.courseId}`);
            } else {
                alert(data.message || "Failed to save quiz");
            }
        } catch (error) {
            alert("An error occurred while saving the quiz");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-6xl mx-auto px-4">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Quiz Builder
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Create an interactive quiz for your course
                    </p>
                </div>

                <div className="space-y-6">
                    {/* Quiz Settings */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                            Quiz Settings
                        </h2>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Quiz Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={quizData.title}
                                        onChange={(e) => setQuizData({ ...quizData, title: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="e.g., Module 1 Assessment"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Passing Score (%)
                                    </label>
                                    <input
                                        type="number"
                                        value={quizData.passingScore}
                                        onChange={(e) => setQuizData({ ...quizData, passingScore: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        min="0"
                                        max="100"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    Description
                                </label>
                                <textarea
                                    value={quizData.description}
                                    onChange={(e) => setQuizData({ ...quizData, description: e.target.value })}
                                    rows={3}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Brief description of this quiz..."
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Time Limit (minutes, 0 = unlimited)
                                    </label>
                                    <input
                                        type="number"
                                        value={quizData.timeLimit}
                                        onChange={(e) => setQuizData({ ...quizData, timeLimit: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        min="0"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Max Attempts
                                    </label>
                                    <input
                                        type="number"
                                        value={quizData.maxAttempts}
                                        onChange={(e) => setQuizData({ ...quizData, maxAttempts: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        min="1"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        id="shuffleQuestions"
                                        checked={quizData.shuffleQuestions}
                                        onChange={(e) => setQuizData({ ...quizData, shuffleQuestions: e.target.checked })}
                                        className="w-5 h-5 text-primary rounded focus:ring-2 focus:ring-primary"
                                    />
                                    <label htmlFor="shuffleQuestions" className="text-sm font-semibold text-slate-900 dark:text-white">
                                        Shuffle Questions
                                    </label>
                                </div>

                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        id="shuffleAnswers"
                                        checked={quizData.shuffleAnswers}
                                        onChange={(e) => setQuizData({ ...quizData, shuffleAnswers: e.target.checked })}
                                        className="w-5 h-5 text-primary rounded focus:ring-2 focus:ring-primary"
                                    />
                                    <label htmlFor="shuffleAnswers" className="text-sm font-semibold text-slate-900 dark:text-white">
                                        Shuffle Answers
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Questions */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                Questions ({quizData.questions.length})
                            </h2>
                            <div className="relative group">
                                <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all flex items-center gap-2">
                                    <Plus className="w-5 h-5" />
                                    Add Question
                                </button>
                                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                                    {questionTypes.map(type => (
                                        <button
                                            key={type.value}
                                            onClick={() => addQuestion(type.value)}
                                            className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-600 first:rounded-t-lg last:rounded-b-lg transition-colors"
                                        >
                                            {type.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {quizData.questions.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-slate-500 dark:text-slate-400 mb-4">
                                    No questions added yet. Click "Add Question" to get started.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {quizData.questions.map((question, index) => (
                                    <div
                                        key={question.id}
                                        className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <span className="px-3 py-1 bg-primary/20 text-primary text-xs font-bold rounded-full">
                                                        Q{index + 1}
                                                    </span>
                                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                                        {questionTypes.find(t => t.value === question.type)?.label}
                                                    </span>
                                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                                        {question.points} point{question.points !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                                    {question.question || "(No question text)"}
                                                </p>
                                                {question.answers && (
                                                    <div className="text-xs text-slate-600 dark:text-slate-400">
                                                        {question.answers.filter(a => a.isCorrect).length} correct answer(s)
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => editQuestion(question)}
                                                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                                >
                                                    <Eye className="w-4 h-4 text-primary" />
                                                </button>
                                                <button
                                                    onClick={() => deleteQuestion(question.id)}
                                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4 text-red-600" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Save Button */}
                    <div className="flex gap-4">
                        <button
                            onClick={handleSaveQuiz}
                            disabled={isSaving || !quizData.title || quizData.questions.length === 0}
                            className="flex-1 px-8 py-4 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isSaving ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="w-5 h-5" />
                                    Save Quiz
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Question Editor Modal */}
                {isQuestionModalOpen && editingQuestion && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-3xl w-full my-8">
                            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {questionTypes.find(t => t.value === editingQuestion.type)?.label}
                                </h2>
                                <button
                                    onClick={() => setIsQuestionModalOpen(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Question Text *
                                    </label>
                                    <textarea
                                        value={editingQuestion.question}
                                        onChange={(e) => setEditingQuestion({ ...editingQuestion, question: e.target.value })}
                                        rows={3}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="Enter your question here..."
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Points
                                    </label>
                                    <input
                                        type="number"
                                        value={editingQuestion.points}
                                        onChange={(e) => setEditingQuestion({ ...editingQuestion, points: Number(e.target.value) })}
                                        className="w-32 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        min="1"
                                    />
                                </div>

                                {/* Answers Section */}
                                {editingQuestion.type !== "short-answer" && editingQuestion.answers && (
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <label className="block text-sm font-semibold text-slate-900 dark:text-white">
                                                Answer Options
                                            </label>
                                            {editingQuestion.type !== "true-false" && (
                                                <button
                                                    onClick={addAnswer}
                                                    className="px-3 py-1 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-lg transition-all flex items-center gap-1"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Add Option
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            {editingQuestion.answers.map((answer, idx) => (
                                                <div key={answer.id} className="flex items-center gap-3">
                                                    <input
                                                        type={editingQuestion.type === "mcq-single" ? "radio" : "checkbox"}
                                                        checked={answer.isCorrect}
                                                        onChange={(e) => updateAnswer(answer.id, "isCorrect", e.target.checked)}
                                                        className="w-5 h-5 text-primary rounded focus:ring-2 focus:ring-primary"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={answer.text}
                                                        onChange={(e) => updateAnswer(answer.id, "text", e.target.value)}
                                                        disabled={editingQuestion.type === "true-false"}
                                                        className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                                                        placeholder={`Option ${idx + 1}`}
                                                    />
                                                    {editingQuestion.type !== "true-false" && (editingQuestion.answers?.length ?? 0) > 2 && (
                                                        <button
                                                            onClick={() => deleteAnswer(answer.id)}
                                                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4 text-red-600" />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                            {editingQuestion.type === "mcq-single"
                                                ? "Select the radio button for the correct answer"
                                                : "Check all correct answers"}
                                        </p>
                                    </div>
                                )}

                                {/* Short Answer */}
                                {editingQuestion.type === "short-answer" && (
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            Correct Answer (for reference)
                                        </label>
                                        <input
                                            type="text"
                                            value={editingQuestion.correctAnswer || ""}
                                            onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="Expected answer (manual grading required)"
                                        />
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                            Short answer questions require manual grading
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex gap-4">
                                <button
                                    onClick={saveQuestion}
                                    disabled={!editingQuestion.question}
                                    className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    <Check className="w-5 h-5" />
                                    Save Question
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
