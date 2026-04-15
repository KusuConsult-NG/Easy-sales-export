"use client";

import { LoanWizard } from "@/components/loans/LoanWizard";
import { submitLoanApplication } from "@/app/actions/loan-actions";
import { useRouter } from "next/navigation";

export default function ApplyForLoanPage() {
    const router = useRouter();

    async function handleLoanSubmit(data: any) {
        const result = await submitLoanApplication(data);

        if (result.success) {
            router.push(`/loans/success?id=${result.data?.loanId}`);
        }
        // If not success, error handling should be done in the component
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
