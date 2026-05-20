Created At: 2026-05-20T07:50:00Z
Completed At: 2026-05-20T07:50:01Z
File Path: `file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/cooperative/_loans.ts`
Total Lines: 985
Total Bytes: 39630
Showing lines 1 to 800
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: "use server";
2: import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
3: 
4: import { db } from "@/lib/firebase-admin";
5: import { COLLECTIONS } from "@/lib/types/firestore";
6: import { logger } from '@/lib/logger';
7: import { FieldValue, Timestamp } from "firebase-admin/firestore";
8: import { createAdminAuditLog } from "@/lib/audit-log-admin";
9: import { calculateRepaymentSchedule, isEligibleForLoan, getTierInterestRate } from "@/lib/cooperative-tiers";
10: import { auth } from "@/lib/auth";
11: import { requireSession } from "@/lib/session-guard";
12: import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
13: import { withSafeAction, type ActionResponse } from "@/lib/safe-action";
14: 
15: export interface LoanApplication {
16:     id?: string;
17:     userId: string;
18:     userEmail: string;
19:     fullName: string;
20:     amount: number;
21:     purpose: string;
22:     durationMonths: number;
23:     status: "pending" | "approved" | "rejected" | "disbursed" | "repaid";
24:     contributionAmount: number;
25:     tier: "Member";
26:     interestRate: number;
27:     totalRepayment: number;
28:     monthlyPayment: number;
29:     documents?: string[];
30:     appliedAt: FieldValue | Timestamp;
31:     reviewedAt?: FieldValue | Timestamp;
32:     reviewedBy?: string;
33:     rejectionReason?: string;
34:     disbursedAt?: FieldValue | Timestamp;
35: }
36: 
37: /**
38:  * Submit loan application
39:  */
40: export async function submitLoanApplicationAction(formData: {
41:     userId: string;
42:
<truncated 31967 bytes>
id,
753:                 loanId,
754:                 userId: loanData.userId,
755:                 installmentNumber: i + 1,
756:                 dueDate,
757:                 principalAmount: inst.principalAmount,
758:                 interestAmount: inst.interestAmount,
759:                 totalAmount: inst.totalAmount,
760:                 paidAmount: 0,
761:                 status: "pending",
762:             });
763:         }
764: 
765:         return { error: null, success: true as const, data: { schedule: installments } };
766:     } catch (error) { 
767:         logger.error("Failed to fetch repayment schedule:", error);
768:         return { success: false as const, error: "Failed to fetch repayment schedule", data: null };
769:     }
770: }
771: 
772: export const getRepaymentScheduleAction = withSafeAction("getRepaymentScheduleAction", _getRepaymentScheduleAction);
773: 
774: /**
775:  * Calculate penalty for overdue payment (7-day grace period)
776:  */
777: function calculatePenalty(dueDate: Date, totalAmount: number): { penalty: number; daysOverdue: number } {
778:     const now = new Date();
779:     const gracePeriodDays = 7;
780:     const penaltyRatePerDay = 0.001; // 0.1% per day after grace period
781: 
782:     const daysDiff = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
783: 
784:     if (daysDiff <= gracePeriodDays) {
785:         return { penalty: 0, daysOverdue: 0 };
786:     }
787: 
788:     const daysOverdue = daysDiff - gracePeriodDays;
789:     const penalty = totalAmount * penaltyRatePerDay * daysOverdue;
790: 
791:     return { penalty: Math.round(penalty), daysOverdue };
792: }
793: 
794: /**
795:  * Submit loan repayment
796:  */
797: export async function submitRepaymentAction(data: {
798:     loanId: string;
799:     installmentId: string;
800:     userId: string;
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.
