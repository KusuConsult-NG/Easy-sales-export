"use server";

import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    updateDoc,
    serverTimestamp,
    orderBy,
    getDoc, // Added getDoc
} from "firebase/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logAuditAction } from "./audit";
import { createNotificationAction } from "@/app/actions/notifications"; // Added createNotificationAction

/**
 * Admin Server Actions
 * 
 * Handles admin-only operations for WAVE applications, withdrawal processing,
 * and user management.
 */

type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

// ============================================
// Approve/Reject WAVE Application
// ============================================

export async function approveWaveApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const applicationRef = doc(db, COLLECTIONS.WAVE_APPLICATIONS, applicationId);
        await updateDoc(applicationRef, {
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Log audit
        await logAuditAction("wave_approve", applicationId, "application", {
            adminId: session.user.id,
        });

        return {
            error: null,
            success: true,
            message: "WAVE application approved successfully",
        };
    } catch (error: any) {
        console.error("Approve WAVE application error:", error);
        return { error: "Failed to approve application", success: false };
    }
}

export async function rejectWaveApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const applicationRef = doc(db, COLLECTIONS.WAVE_APPLICATIONS, applicationId);
        await updateDoc(applicationRef, {
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Log audit
        await logAuditAction("wave_reject", applicationId, "application", {
            reason,
            adminId: session.user.id,
        });

        return {
            error: null,
            success: true,
            message: "WAVE application rejected",
        };
    } catch (error: any) {
        console.error("Reject WAVE application error:", error);
        return { error: "Failed to reject application", success: false };
    }
}

// ============================================
// Process Withdrawal Request
// ============================================

export async function processWithdrawalAction(
    withdrawalId: string,
    action: "approve" | "reject",
    reasoning?: string // Changed 'notes' to 'reasoning'
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const withdrawalRef = doc(db, COLLECTIONS.WITHDRAWALS, withdrawalId);
        const withdrawalDoc = await getDoc(withdrawalRef); // Added getDoc

        if (!withdrawalDoc.exists()) { // Added check for existence
            return { error: "Withdrawal request not found", success: false };
        }

        const withdrawalData = withdrawalDoc.data(); // Added retrieval of withdrawal data

        await updateDoc(withdrawalRef, {
            status: action === "approve" ? "completed" : "rejected", // Reverted status logic to original
            processedBy: session.user.id,
            processedAt: serverTimestamp(),
            adminNotes: reasoning || "", // Changed 'notes' to 'adminNotes' and used 'reasoning'
            updatedAt: serverTimestamp(),
        });

        // Create notification for user
        await createNotificationAction({
            userId: withdrawalData.userId,
            type: action === "approve" ? "success" : "warning",
            title: action === "approve" ? "Withdrawal Approved" : "Withdrawal Rejected",
            message: action === "approve"
                ? `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} has been approved.`
                : `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} was rejected. ${reasoning || ''}`,
            link: "/cooperatives",
            linkText: "View Dashboard",
        });

        // Log audit (kept original logAuditAction, assuming createAuditLog was a typo or not fully intended replacement)
        await logAuditAction(
            action === "approve" ? "withdrawal_approve" : "withdrawal_reject",
            withdrawalId,
            "withdrawal",
            { notes: reasoning, adminId: session.user.id } // Used 'reasoning' for notes
        );

        return {
            error: null,
            success: true,
            message: `Withdrawal ${action === "approve" ? "approved" : "rejected"} successfully`,
        };
    } catch (error: any) {
        console.error("Process withdrawal error:", error);
        return { error: "Failed to process withdrawal", success: false };
    }
}

// ============================================
// User Verification Toggle
// ============================================

export async function toggleUserVerificationAction(
    userId: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        // Get current user doc
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userSnapshot = await getDocs(
            query(collection(db, COLLECTIONS.USERS), where("__name__", "==", userId))
        );

        if (userSnapshot.empty) {
            return { error: "User not found", success: false };
        }

        const currentData = userSnapshot.docs[0].data();
        const newVerificationStatus = !currentData.isVerified;

        await updateDoc(userRef, {
            isVerified: newVerificationStatus,
            verifiedBy: session.user.id,
            verifiedAt: newVerificationStatus ? serverTimestamp() : null,
            updatedAt: serverTimestamp(),
        });

        // Log audit
        await logAuditAction(
            newVerificationStatus ? "user_verify" : "user_unverify",
            userId,
            "user",
            { adminId: session.user.id }
        );

        return {
            error: null,
            success: true,
            message: `User ${newVerificationStatus ? "verified" : "unverified"} successfully`,
        };
    } catch (error: any) {
        console.error("Toggle user verification error:", error);
        return { error: "Failed to update verification status", success: false };
    }
}

// ============================================
// Get WAVE Applications (Admin)
// ============================================

export async function getWaveApplicationsAction(
    statusFilter?: "pending" | "approved" | "rejected"
): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        let applicationsQuery = query(
            collection(db, COLLECTIONS.WAVE_APPLICATIONS),
            orderBy("createdAt", "desc")
        );

        if (statusFilter) {
            applicationsQuery = query(
                collection(db, COLLECTIONS.WAVE_APPLICATIONS),
                where("status", "==", statusFilter),
                orderBy("createdAt", "desc")
            );
        }

        const snapshot = await getDocs(applicationsQuery);
        const applications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
            reviewedAt: doc.data().reviewedAt?.toDate(),
        }));

        return {
            error: null,
            success: true,
            data: applications,
        };
    } catch (error: any) {
        console.error("Get WAVE applications error:", error);
        return { error: "Failed to fetch applications", success: false };
    }
}

// ============================================
// Get Pending Withdrawals (Admin)
// ============================================

export async function getPendingWithdrawalsAction(): Promise<{
    error: string | null;
    success: boolean;
    data?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const withdrawalsQuery = query(
            collection(db, COLLECTIONS.WITHDRAWALS),
            where("status", "==", "pending"),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(withdrawalsQuery);
        const withdrawals = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

        return {
            error: null,
            success: true,
            data: withdrawals,
        };
    } catch (error: any) {
        console.error("Get pending withdrawals error:", error);
        return { error: "Failed to fetch withdrawals", success: false };
    }
}

// ============================================
// Land Verification (Admin)
// ============================================

export async function getPendingLandListings(): Promise<{
    error: string | null;
    success: boolean;
    listings?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const listingsQuery = query(
            collection(db, "land_listings"),
            where("verificationStatus", "==", "pending"),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(listingsQuery);
        const listings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

        return {
            error: null,
            success: true,
            listings,
        };
    } catch (error: any) {
        console.error("Get pending land listings error:", error);
        return { error: "Failed to fetch land listings", success: false };
    }
}

export async function verifyLandListing(
    listingId: string,
    decision: "approved" | "rejected",
    reason: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        // Update listing status
        const listingRef = doc(db, "land_listings", listingId);
        await updateDoc(listingRef, {
            verificationStatus: decision,
            verifiedBy: session.user.id,
            verifiedAt: serverTimestamp(),
            rejectionReason: decision === "rejected" ? reason : null,
            updatedAt: serverTimestamp(),
        });

        // Get listing data for email
        const listingSnapshot = await getDocs(
            query(collection(db, "land_listings"), where("__name__", "==", listingId))
        );

        if (!listingSnapshot.empty) {
            const listingData = listingSnapshot.docs[0].data();

            // Send email notification via Resend
            if (process.env.RESEND_API_KEY) {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);

                const emailSubject = decision === "approved"
                    ? "Land Listing Approved"
                    : "Land Listing Requires Updates";

                const emailContent = decision === "approved"
                    ? `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #10b981;">Land Listing Approved!</h2>
                            <p>Great news! Your land listing has been approved and is now live on Easy Sales Export.</p>
                            <p><strong>Listing:</strong> ${listingData.title}</p>
                            <p><strong>Location:</strong> ${listingData.location?.lga}, ${listingData.location?.state}</p>
                            <p>Your listing is now visible to potential buyers. You'll receive notifications when buyers express interest.</p>
                        </div>
                    `
                    : `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #ef4444;">Land Listing Requires Updates</h2>
                            <p>Your land listing was reviewed but requires some updates before it can be published.</p>
                            <p><strong>Listing:</strong> ${listingData.title}</p>
                            <p><strong>Reason:</strong></p>
                            <p style="background: #fef2f2; padding: 12px; border-left: 4px solid #ef4444;">${reason}</p>
                            <p>Please update your listing and resubmit for review.</p>
                        </div>
                    `;

                // Security: Don't send if email is missing
                if (!listingData.ownerEmail) {
                    console.error(`Missing ownerEmail forland listing ${listingId}`);
                } else {
                    await resend.emails.send({
                        from: "Easy Sales Export <noreply@easysalesexport.com>",
                        to: listingData.ownerEmail,
                        subject: emailSubject,
                        html: emailContent,
                    });
                }
            }
        }

        // Log audit
        await logAuditAction(
            decision === "approved" ? "land_approve" : "land_reject",
            listingId,
            "land_listing",
            { adminId: session.user.id, reason: decision === "rejected" ? reason : null }
        );

        return {
            error: null,
            success: true,
            message: `Land listing ${decision} successfully`,
        };
    } catch (error: any) {
        console.error("Verify land listing error:", error);
        return { error: "Failed to verify land listing", success: false };
    }
}

// ============================================
// Loan Application Management (Admin)
// ============================================

export async function getPendingLoanApplications(): Promise<{
    error: string | null;
    success: boolean;
    applications?: any[];
}> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        const loansQuery = query(
            collection(db, "loan_applications"),
            where("status", "==", "pending"),
            orderBy("appliedAt", "desc")
        );

        const snapshot = await getDocs(loansQuery);
        const applications = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                appliedAt: data.appliedAt?.toDate() || new Date(),
            };
        });

        return {
            error: null,
            success: true,
            applications,
        };
    } catch (error: any) {
        console.error("Get pending loan applications error:", error);
        return { error: "Failed to fetch loan applications", success: false };
    }
}

export async function approveLoanApplication(
    applicationId: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        // Get loan data for validation
        const loanSnapshot = await getDocs(
            query(collection(db, "loan_applications"), where("__name__", "==", applicationId))
        );

        if (loanSnapshot.empty) {
            return { error: "Loan application not found", success: false };
        }

        const loanData = loanSnapshot.docs[0].data();

        // Validate tier eligibility
        const tierMultiplier = loanData.tier === "Premium" ? 5 : 2.5;
        const maxLoanAmount = loanData.contributionAmount * tierMultiplier;

        if (loanData.amount > maxLoanAmount) {
            return {
                error: `Loan amount exceeds maximum for ${loanData.tier} tier (₦${maxLoanAmount.toLocaleString()})`,
                success: false,
            };
        }

        // Update loan status
        const loanRef = doc(db, "loan_applications", applicationId);
        await updateDoc(loanRef, {
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Send approval email
        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);

            // Security: Don't send if email is missing
            if (!loanData.userEmail) {
                console.error(`Missing userEmail for loan application ${applicationId}`);
            } else {
                await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: loanData.userEmail,
                    subject: "Loan Application Approved!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #10b981;">Congratulations! Your Loan is Approved</h2>
                            <p>Great news! Your loan application has been approved by our admin team.</p>
                        
                        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #059669; margin-top: 0;">Loan Details:</h3>
                            <p><strong>Amount:</strong> ₦${loanData.amount.toLocaleString()}</p>
                            <p><strong>Duration:</strong> ${loanData.durationMonths} months</p>
                            <p><strong>Interest Rate:</strong> ${loanData.interestRate}% per month</p>
                            <p><strong>Monthly Payment:</strong> ₦${Math.round(loanData.monthlyPayment).toLocaleString()}</p>
                            <p><strong>Total Repayment:</strong> ₦${Math.round(loanData.totalRepayment).toLocaleString()}</p>
                        </div>

                        <p><strong>Next Steps:</strong></p>
                        <ul>
                            <li>Funds will be disbursed to your account within 2-3 business days</li>
                            <li>Your first repayment is due 30 days from disbursement</li>
                            <li>You can track your repayment schedule in your dashboard</li>
                        </ul>

                            <p>Thank you for being a valued member of our cooperative!</p>
                        </div>
                    `,
                });
            }
        }

        // Create notification for user
        await createNotificationAction({
            userId: loanData.userId,
            type: "success",
            title: "Loan Approved!",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} has been approved. Disbursement within 2-3 days.`,
            link: "/loans",
            linkText: "View Loans",
        });

        // Log audit
        await logAuditAction(
            "loan_approved",
            applicationId,
            "application",
            { adminId: session.user.id, amount: loanData.amount }
        );

        return {
            error: null,
            success: true,
            message: "Loan application approved successfully",
        };
    } catch (error: any) {
        console.error("Approve loan application error:", error);
        return { error: "Failed to approve loan application", success: false };
    }
}

export async function rejectLoanApplication(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        // Get loan data for email
        const loanSnapshot = await getDocs(
            query(collection(db, "loan_applications"), where("__name__", "==", applicationId))
        );

        if (loanSnapshot.empty) {
            return { error: "Loan application not found", success: false };
        }

        const loanData = loanSnapshot.docs[0].data();

        // Update loan status
        const loanRef = doc(db, "loan_applications", applicationId);
        await updateDoc(loanRef, {
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: session.user.id,
            reviewedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Send rejection email
        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);

            // Security: Don't send if email is missing
            if (!loanData.userEmail) {
                console.error(`Missing userEmail for loan rejection ${applicationId}`);
            } else {
                await resend.emails.send({
                    from: "Easy Sales Export <noreply@easysalesexport.com>",
                    to: loanData.userEmail,
                    subject: "Loan Application Update",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #dc2626;">Loan Application Update</h2>
                            <p>Thank you for applying for a loan with Easy Sales Export.</p>
                            
                            <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <p>Unfortunately, we are unable to approve your loan application at this time.</p>
                                <p><strong>Reason:</strong> ${reason}</p>
                            </div>

                            <p><strong>What You Can Do:</strong></p>
                            <ul>
                                <li>Review the rejection reason carefully</li>
                                <li>Address the issues mentioned</li>
                                <li>Consider increasing your cooperative contributions for a higher tier</li>
                                <li>Reapply after making the necessary adjustments</li>
                            </ul>

                            <p>If you have any questions or need clarification, please don't hesitate to contact our support team.</p>
                            
                            <p>We look forward to supporting your financial growth in the future.</p>
                        </div>
                    `,
                });
            }
        }

        // Create notification for user
        await createNotificationAction({
            userId: loanData.userId,
            type: "warning",
            title: "Loan Application Declined",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} was not approved. Reason: ${reason}`,
            link: "/loans",
            linkText: "View Details",
        });

        // Log audit
        await logAuditAction(
            "loan_rejected",
            applicationId,
            "application",
            { adminId: session.user.id, reason }
        );

        return {
            error: null,
            success: true,
            message: "Loan application rejected",
        };
    } catch (error: any) {
        console.error("Reject loan application error:", error);
        return { error: "Failed to reject loan application", success: false };
    }
}

// ============================================
// Rate Limit Management (Admin)
// ============================================

/**
 * Unlock a rate-limited user account
 * Allows admins to manually reset login attempt counters
 */
export async function unlockUserAccount(email: string): Promise<ActionState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false };
        }

        if (!email || !email.includes("@")) {
            return { error: "Invalid email address", success: false };
        }

        // Reset rate limit
        const { resetLoginAttempts } = await import("@/lib/rate-limit");
        await resetLoginAttempts(email);

        // Log audit
        await logAuditAction(
            "user_verify", // Reusing existing action type as closest match
            email,
            "user",
            { adminId: session.user.id, action: "account_unlock", email }
        );

        return {
            error: null,
            success: true,
            message: `Account unlocked: ${email}`,
        };
    } catch (error: any) {
        console.error("Unlock account error:", error);
        return { error: "Failed to unlock account", success: false };
    }
}

