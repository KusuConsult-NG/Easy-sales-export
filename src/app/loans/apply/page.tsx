"use client";

import { LoanWizard } from "@/components/loans/LoanWizard";
import { submitLoanApplication } from "@/app/actions/loan-actions";
import { useRouter } from "next/navigation";

export default function ApplyForLoanPage() {
    const router = useRouter();

    /**
     *   #287 A REFUSED APPLICATION USED TO PRODUCE NOTHING AT ALL.
     *
     *        This handler was:
     *
     *            if (result.success) { router.push(...) }
     *            // If not success, error handling should be done in the component
     *
     *        and the component had no error handling. So "not signed in",
     *        "validation error", and "you already have an open application"
     *        (#288) all rendered as: the button says Submitting…, then says
     *        Submit Application again, and nothing else happens. The applicant
     *        has no way to tell a refusal from a network hiccup, and pressing
     *        the button again — the only thing that dead control suggests — can
     *        never work.
     *
     *        Throwing rather than returning is what makes the silence
     *        impossible. LoanWizard now catches and renders the message beside
     *        the button; a `void` return could go on being ignored by writing
     *        no code, which is exactly how this survived.
     */
    async function handleLoanSubmit(data: any) {
        const result = await submitLoanApplication(data);

        if (!result.success) {
            throw new Error(result.error || "Your application could not be submitted.");
        }

        router.push(`/loans/success?id=${result.data?.loanId}`);
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50">
            <LoanWizard
                onSubmit={handleLoanSubmit}
                onCancel={() => router.push('/loans')}
            />
        </div>
    );
}
