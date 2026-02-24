"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { saveQuizAction, getQuizAction } from "@/app/actions/academy";

type Question = {
    id: string;
    text: string;
    options: {
        id: string;
        text: string;
        isCorrect: boolean;
    }[];
};

export default function QuizEditorPage() {
    const params = useParams();
    const router = useRouter();
    const courseId = params.courseId as string;
    const quizId = params.quizId as string;

    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [quizTitle, setQuizTitle] = useState("Module Quiz");
    const [questions, setQuestions] = useState<Question[]>([]);

    // Load from Firestore on mount
    useEffect(() => {
        async function load() {
            const result = await getQuizAction(quizId);
            if (result.success) {
                setQuizTitle(result.title || "Module Quiz");
                setQuestions((result.questions || []) as any);
            } else {
                toast.error(result.error || "Failed to load quiz");
            }
            setIsFetching(false);
        }
        load();
    }, [quizId]);

    const handleAddQuestion = () => {
        const newQuestion: Question = {
            id: `q-${Date.now()}`,
            text: "New Question",
            options: [
                { id: `o-${Date.now()}-1`, text: "Option A", isCorrect: false },
                { id: `o-${Date.now()}-2`, text: "Option B", isCorrect: false },
            ]
        };
        setQuestions([...questions, newQuestion]);
    };

    const handleUpdateQuestion = (qId: string, text: string) => {
        setQuestions(questions.map(q => q.id === qId ? { ...q, text } : q));
    };

    const handleUpdateOption = (qId: string, oId: string, text: string) => {
        setQuestions(questions.map(q => {
            if (q.id === qId) {
                return {
                    ...q,
                    options: q.options.map(o => o.id === oId ? { ...o, text } : o)
                };
            }
            return q;
        }));
    };

    const handleSetCorrectOption = (qId: string, oId: string) => {
        setQuestions(questions.map(q => {
            if (q.id === qId) {
                return {
                    ...q,
                    options: q.options.map(o => ({ ...o, isCorrect: o.id === oId }))
                };
            }
            return q;
        }));
    };

    const handleAddOption = (qId: string) => {
        setQuestions(questions.map(q => {
            if (q.id === qId) {
                return {
                    ...q,
                    options: [...q.options, { id: `o-${Date.now()}`, text: "New Option", isCorrect: false }]
                };
            }
            return q;
        }));
    };

    const handleDeleteQuestion = (qId: string) => {
        setQuestions(questions.filter(q => q.id !== qId));
    };

    const handleDeleteOption = (qId: string, oId: string) => {
        setQuestions(questions.map(q => {
            if (q.id === qId) {
                return { ...q, options: q.options.filter(o => o.id !== oId) };
            }
            return q;
        }));
    };

    const handleSave = async () => {
        setIsLoading(true);
        const result = await saveQuizAction(courseId, quizId, quizTitle, questions as any);
        setIsLoading(false);
        if (result.success) {
            toast.success("Quiz saved successfully");
        } else {
            toast.error(result.error || "Failed to save quiz");
        }
    };

    if (isFetching) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href={`/admin/academy/${courseId}`}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" />
                        </Link>
                        <div>
                            <input
                                type="text"
                                value={quizTitle}
                                onChange={(e) => setQuizTitle(e.target.value)}
                                className="text-2xl font-bold text-slate-900 bg-transparent border-none focus:ring-0 p-0 w-full"
                            />
                            <p className="text-sm text-slate-500">Quiz Editor</p>
                        </div>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium shadow-lg shadow-primary/20 flex items-center gap-2 transition disabled:opacity-70"
                    >
                        <Save className="w-4 h-4" />
                        Save Quiz
                    </button>
                </div>

                {/* Questions List */}
                <div className="space-y-6">
                    {questions.map((q, index) => (
                        <div key={q.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                            <div className="flex items-start gap-4 mb-4">
                                <span className="flex-none w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-600">
                                    {index + 1}
                                </span>
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        value={q.text}
                                        onChange={(e) => handleUpdateQuestion(q.id, e.target.value)}
                                        className="w-full text-lg font-medium text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-primary focus:outline-none transition-colors"
                                        placeholder="Enter question text..."
                                    />
                                </div>
                                <button
                                    onClick={() => handleDeleteQuestion(q.id)}
                                    className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Options */}
                            <div className="pl-12 space-y-3">
                                {q.options.map((opt) => (
                                    <div key={opt.id} className="flex items-center gap-3 group">
                                        <button
                                            onClick={() => handleSetCorrectOption(q.id, opt.id)}
                                            className={`flex-none w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${opt.isCorrect
                                                ? "border-green-500 bg-green-500 text-white"
                                                : "border-slate-300 text-transparent hover:border-slate-400"
                                                }`}
                                        >
                                            <CheckCircle2 className="w-3 h-3" />
                                        </button>
                                        <input
                                            type="text"
                                            value={opt.text}
                                            onChange={(e) => handleUpdateOption(q.id, opt.id, e.target.value)}
                                            className="flex-1 text-slate-900 bg-transparent border border-transparent hover:border-slate-200 rounded px-2 py-1 focus:border-primary focus:outline-none transition-colors"
                                            placeholder="Option text..."
                                        />
                                        <button
                                            onClick={() => handleDeleteOption(q.id, opt.id)}
                                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-500 rounded transition"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => handleAddOption(q.id)}
                                    className="text-sm text-primary hover:underline flex items-center gap-1 mt-2"
                                >
                                    <Plus className="w-3 h-3" />
                                    Add Option
                                </button>
                            </div>
                        </div>
                    ))}

                    <button
                        onClick={handleAddQuestion}
                        className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-primary hover:text-primary hover:bg-slate-50 transition flex items-center justify-center gap-2 font-medium"
                    >
                        <Plus className="w-5 h-5" />
                        Add Question
                    </button>
                </div>
            </div>
        </div>
    );
}
