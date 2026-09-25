"use client";

/**
 *   #921 THREE STATES WERE WRITTEN AND TWO WERE DRAWN.
 *
 *   The circle's class came from a nested ternary whose first two branches were
 *   byte-identical:
 *
 *       currentStep > step.id  ? "bg-green-600 text-white"
 *     : currentStep === step.id ? "bg-green-600 text-white"
 *     :                           "bg-slate-200 text-slate-500"
 *
 *   Somebody set out to distinguish done / here / still to come and ended with
 *   done-or-here / still to come. Measured under jsdom on a three-step wizard at
 *   step 2: the completed circle and the current circle carried the same class
 *   string exactly, and the only difference between them was a tick where the
 *   other had a numeral.
 *
 *   THAT MATTERS ON THE SCREEN THAT USES IT. MarketplaceOnboardingClient draws
 *   up to six of these — a seller gets Account Type, Business Profile, Product
 *   Interests, Terms, Verification, Bank Account — and the step you are on is
 *   the one question a progress bar exists to answer.
 *
 *   NOT A NEW DESIGN. The platform already decided what "current" looks like, in
 *   components/onboarding/StepIndicator, which the export onboarding wizard uses:
 *   a ring around the filled circle. That idiom is adopted here rather than
 *   invented, and the colour is left as this wizard's green — the sibling's
 *   orange is its own screen's palette, and changing marketplace's would be a
 *   design decision nobody asked for.
 *
 *   THE TWO COMPONENTS ARE NOT MERGED, and their contracts say why: this one
 *   keys on a numeric step id and a numeric `currentStep`, the sibling on a
 *   string id plus a per-step `completed` flag. Folding either into the other
 *   changes a live wizard's data shape. Their disagreement is pinned instead, in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see.
 */

import { CheckCircle } from "lucide-react";

interface Step {
    id: number;
    title: string;
    description?: string;
}

interface StepIndicatorProps {
    steps: Step[];
    currentStep: number;
}

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
    return (
        <div className="flex items-center justify-between mb-8">
            {steps.map((step, index) => (
                <div key={step.id} className="flex-1">
                    <div className="flex items-center">
                        <div className="flex flex-col items-center flex-1">
                            <div
                                aria-current={currentStep === step.id ? "step" : undefined}
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${currentStep > step.id
                                        ? "bg-green-600 text-white"
                                        : currentStep === step.id
                                            ? "bg-green-600 text-white ring-4 ring-green-100"
                                            : "bg-slate-200 text-slate-500"
                                    }`}
                            >
                                {currentStep > step.id ? (
                                    <CheckCircle className="w-5 h-5" />
                                ) : (
                                    step.id
                                )}
                            </div>
                            <div className="mt-2 text-center">
                                <p className={`text-sm font-semibold ${currentStep >= step.id
                                        ? "text-slate-900"
                                        : "text-slate-500"
                                    }`}>
                                    {step.title}
                                </p>
                                {step.description && (
                                    <p className="text-xs text-slate-500 hidden md:block">
                                        {step.description}
                                    </p>
                                )}
                            </div>
                        </div>
                        {index < steps.length - 1 && (
                            <div
                                className={`h-1 flex-1 mx-2 rounded-full transition-all ${currentStep > step.id
                                        ? "bg-green-600"
                                        : "bg-slate-200"
                                    }`}
                            />
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
