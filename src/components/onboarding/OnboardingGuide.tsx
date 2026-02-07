import { ReactNode } from "react";
import { ArrowRight, CheckCircle, Lock } from "lucide-react";
import Link from "next/link";

type OnboardingStep = {
    title: string;
    description: string;
    completed: boolean;
    action?: {
        label: string;
        href: string;
    };
};

type OnboardingGuideProps = {
    title: string;
    description: string;
    icon: ReactNode;
    steps: OnboardingStep[];
    primaryAction?: {
        label: string;
        href: string;
    };
    imageSrc?: string;
};

export default function OnboardingGuide({
    title,
    description,
    icon,
    steps,
    primaryAction,
    imageSrc,
}: OnboardingGuideProps) {
    const allStepsCompleted = steps.every(step => step.completed);
    const completedSteps = steps.filter(step => step.completed).length;

    return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
            <div className="max-w-4xl w-full">
                <div className="bg-gradient-to-br from-primary/5 to-primary/10 dark:from-slate-800 dark:to-slate-900 rounded-3xl p-8 md:p-12 border border-primary/20 dark:border-slate-700 shadow-2xl">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                        {/* Left: Content */}
                        <div>
                            {/* Icon and Title */}
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center shadow-lg">
                                    {icon}
                                </div>
                                <div>
                                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                                        {title}
                                    </h1>
                                    {steps.length > 0 && (
                                        <p className="text-sm text-primary font-semibold mt-1">
                                            {completedSteps} of {steps.length} completed
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Description */}
                            <p className="text-slate-600 dark:text-slate-300 mb-8 text-lg">
                                {description}
                            </p>

                            {/* Steps */}
                            {steps.length > 0 && (
                                <div className="space-y-4 mb-8">
                                    {steps.map((step, index) => (
                                        <div
                                            key={index}
                                            className={`flex items-start gap-3 p-4 rounded-xl transition-all ${step.completed
                                                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                                                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                                }`}
                                        >
                                            <div
                                                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${step.completed
                                                        ? "bg-green-600 dark:bg-green-500"
                                                        : "bg-slate-200 dark:bg-slate-700"
                                                    }`}
                                            >
                                                {step.completed ? (
                                                    <CheckCircle className="w-5 h-5 text-white" />
                                                ) : (
                                                    <Lock className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                                    {step.title}
                                                </h3>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    {step.description}
                                                </p>
                                                {!step.completed && step.action && (
                                                    <Link
                                                        href={step.action.href}
                                                        className="inline-flex items-center gap-2 mt-3 text-sm font-semibold text-primary hover:underline"
                                                    >
                                                        {step.action.label}
                                                        <ArrowRight className="w-4 h-4" />
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Primary Action */}
                            {primaryAction && !allStepsCompleted && (
                                <Link
                                    href={primaryAction.href}
                                    className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl group"
                                >
                                    <span>{primaryAction.label}</span>
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </Link>
                            )}

                            {allStepsCompleted && (
                                <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                                    <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0" />
                                    <div>
                                        <h3 className="font-bold text-green-900 dark:text-green-100">
                                            You're all set!
                                        </h3>
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            You can now access all features of this service.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: Illustration/Image */}
                        <div className="hidden lg:block">
                            {imageSrc ? (
                                <img
                                    src={imageSrc}
                                    alt={title}
                                    className="w-full h-auto rounded-2xl shadow-2xl"
                                />
                            ) : (
                                <div className="w-full aspect-square bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl flex items-center justify-center">
                                    <div className="w-32 h-32 bg-gradient-to-br from-primary to-primary/80 rounded-full opacity-20" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
