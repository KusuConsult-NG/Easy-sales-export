import { LoanWizard } from "@/components/loans/LoanWizard";
import { submitLoanApplication } from "@/app/actions/loan-actions";
import { redirect } from "next/navigation";

export default function ApplyForLoanPage() {
    async function handleLoanSubmit(data: any) {
        "use server";
        const result = await submitLoanApplication(data);

        if (result.success) {
            redirect(`/loans/success?id=${result.loanId}`);
        }
        // If not success, error handling should be done in the component
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
            <LoanWizard
                onSubmit={handleLoanSubmit}
                onCancel={() => redirect('/loans')}
            />
        </div>
    );
}
