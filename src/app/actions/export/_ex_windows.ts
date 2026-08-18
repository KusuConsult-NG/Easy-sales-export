"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { refuseExportStatusChange, hasExportAdminAccess } from "@/lib/export-window-status";
import { claimIdempotencyKey } from "@/lib/wallet-ledger";
import { revalidatePath } from "next/cache";
import { parseCurrencyStringToFloat } from "@/lib/utils";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import type { ExportWindow } from "@/lib/types/firestore";
import { exportWindowSchema } from "@/lib/types/export-actions";
import type { CreateExportActionState, UpdateStatusActionState } from "@/lib/types/export-actions";

// ============================================
// Create Export Window Action
// ============================================

export async function createExportWindowAction(
    prevState: CreateExportActionState,
    formData: FormData
): Promise<CreateExportActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired", data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to create an export window", success: false as const, data: null };
        }

        const idempotencyKey = formData.get("idempotencyKey") as string;
        if (!idempotencyKey) { return { error: "Missing security token. Please refresh the page.", success: false as const, data: null };
        }

        // Extract and validate form data
        const exportData = { commodity: (formData.get("commodity") as string | null)?.trim() ?? "",
            quantity: (formData.get("quantity") as string | null)?.trim() ?? "",
            amount: (() => { const raw = formData.get("amount") as string | null; const n = raw ? parseCurrencyStringToFloat(raw) : NaN; return isNaN(n) ? -1 : n; })(),
            deliveryDate: (formData.get("deliveryDate") as string | null)?.trim() || undefined,
            destination: (formData.get("destination") as string | null)?.trim() || undefined };

        // Validate with Zod
        const validatedData = exportWindowSchema.parse(exportData);

        let finalOrderId = "";

        // The idempotency key used to be read here and written at the end, with
        // the window creation in between, so two submissions carrying the same
        // key both read "absent" and both created a window. It is claimed now —
        // insert-if-absent, decided by Postgres. See migration 019.
        const keyClaim = await claimIdempotencyKey({
            key: idempotencyKey,
            userId: session.user.id,
            action: "create_export_window",
        });

        if (!keyClaim.claimed) {
            return { error: "Duplicate transaction detected. Please wait.", success: false as const, data: null };
        }

        await (async () => {
            // 1. Check if user is verified (KYC)
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
            const userDoc = await userRef.get();
            const userData = userDoc.data();

            if (!userData?.isVerified) { throw new Error("Compliance Error: You must complete KYC verification to create Export Windows.");
            }

            // 2. Check for Service Registration (CAC/NEPC)
            const exportReg = userData?.serviceRegistrations?.export;
            const serviceNumber = exportReg?.registrationNumber || userData?.cacNumber;

            if (!serviceNumber && userData?.serviceRegistrations?.export?.status !== "approved") { throw new Error("Compliance Error: Missing Export Service Registration (NEPC/CAC).");
            }

            // Generate unique order ID
            const orderId = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
            finalOrderId = orderId;

            // Calculate escrow release date (30 days after delivery)
            let escrowReleaseDate = null;
            if (validatedData.deliveryDate) { const deliveryDate = new Date(validatedData.deliveryDate);
                escrowReleaseDate = new Date(deliveryDate);
                escrowReleaseDate.setDate(escrowReleaseDate.getDate() + 30);
            }

            // Save to Firestore
            const exportWindowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc();
            await exportWindowRef.set({ orderId,
                commodity: validatedData.commodity,
                quantity: validatedData.quantity,
                amount: validatedData.amount,
                destination: validatedData.destination || "other",
                status: "pending",
                userId: session.user.id,
                orderDate: FieldValue.serverTimestamp(),
                deliveryDate: validatedData.deliveryDate ? new Date(validatedData.deliveryDate) : null,
                escrowReleaseDate: escrowReleaseDate,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() });

            // (The idempotency key row is written by claimIdempotencyKey above.)
        })();

        revalidatePath("/export");
        // /dashboard/export is not a route — the export dashboard is at
        // /export/dashboard (the (app) segment is a route group and does not
        // appear in the URL). revalidatePath on a path with no route behind it
        // is a silent no-op, so this invalidated nothing.
        revalidatePath("/export/dashboard");

        return { error: null, success: true as const, message: `Export window created successfully! Order ID: ${finalOrderId }`,
            meta: null
        , data: { orderId: finalOrderId } };
    } catch (error: any) { logger.error("Create export window error:", error);

        if (error.message && error.message.includes("Duplicate") || error.message.includes("Compliance")) {
            return { error: error.message, success: false as const, data: null };
        }

        if (error.name === "ZodError") { return { error: "Please fill in all required fields correctly", success: false as const, data: null };
        }

        return { error: "Failed to create export window. Please try again.", success: false as const, data: null };
    }
}


// ============================================
// Update Export Status Action
// ============================================

export async function updateExportStatusAction(
    exportId: string,
    newStatus: "pending" | "in_transit" | "delivered" | "completed"
): Promise<UpdateStatusActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) { return { error: "Export window not found", success: false as const, data: null };
        }

        const data = exportDoc.data();

        // The same rule the other updateExportStatusAction applies.
        //
        // This one checked ownership-or-admin and nothing else: any of the four
        // statuses could be set from any other, by the window's owner as readily
        // as by an admin. And this endpoint does strictly MORE than change a
        // field — on "completed" it emails every investor a statement of their
        // returns and marks every one of their slots completed. So an owner
        // could settle their own export, tell every investor it had paid out,
        // and close their slots, with no admin involved.
        //
        // Two further divergences from the hardened sibling, both fixed by using
        // the shared rule: roles came from the session TOKEN rather than the
        // database, and `export_admin` was not recognised at all — so a genuine
        // export administrator was refused here and allowed there.
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];

        const refusal = refuseExportStatusChange({
            callerId: session.user.id,
            callerRoles,
            ownerId: data?.userId,
            currentStatus: data?.status,
            newStatus,
        });
        if (refusal) {
            return { error: refusal, success: false as const, data: null };
        }

        // Prevent duplicate status updates to avoid multiple completion emails
        if (data?.status === newStatus) {
            return { error: `Status is already ${newStatus}`, success: false as const };
        }

        // Update status
        await exportRef.update({ status: newStatus,
            updatedAt: FieldValue.serverTimestamp() });

        // When a window completes, email all investors with their returns
        if (newStatus === "completed") { try {
                const { sendExportWindowCompleteEmail } = await import("@/lib/email-notifications");
                const slotsSnap = await db.collection(COLLECTIONS.EXPORT_SLOTS)
                    .where("exportId", "==", exportId)
                    .where("status", "==", "active")
                    .get();

                const windowTitle = data?.title || "Export Window";
                const roi = data?.roi || data?.returnRate || "N/A";

                await Promise.all(slotsSnap.docs.map(async (slotDoc) => { const slot = slotDoc.data();
                    if (!slot.userId) return;

                    // Fetch user email
                    const userDoc = await db.collection(COLLECTIONS.USERS).doc(slot.userId).get();
                    const userEmail = userDoc.data()?.email;
                    const userName = userDoc.data()?.name || userDoc.data()?.displayName || "Investor";

                    if (!userEmail) return;

                    await sendExportWindowCompleteEmail(
                        userEmail,
                        userName,
                        windowTitle,
                        slot.amount || 0,
                        slot.expectedReturn || 0,
                        String(roi)
                    );

                    // Mark slot as completed
                    await slotDoc.ref.update({ status: "completed", completedAt: FieldValue.serverTimestamp() });
                }));

                logger.info(`[Export Complete] Notified investors for window: ${exportId}`);
            } catch (emailErr) { logger.error("[Export Complete] Failed to notify investors:", emailErr);
                // Don't block the status update on email failure
            }
        }

        return { error: null, success: true as const, message: `Status updated to ${newStatus }`,
            meta: null
        , data: null };
    } catch (error: any) { logger.error("Update export status error:", error);
        return { error: "Failed to update status", success: false as const, data: null };
    }
}


// ============================================
// Update Export Window Details Action
// ============================================

export async function updateExportWindowAction(
    exportId: string,
    updateData: Partial<ExportWindow>
) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "Authentication required", success: false as const, meta: null };
        }

        // Verify Admin — through the shared list, which includes export_admin.
        //
        // This checked the session token for admin/super_admin only, while the
        // status endpoint in this same file recognises export_admin and reads
        // roles from the database. An export administrator could settle a window
        // — the larger power — and not edit its description.
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];
        if (!hasExportAdminAccess(callerRoles)) {
            return { error: "Unauthorized access", success: false as const, meta: null };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);

        // Remove undefined fields
        const cleanData = JSON.parse(JSON.stringify(updateData));
        delete cleanData.id;
        delete cleanData.createdAt;
        delete cleanData.updatedAt;

        // The fields this endpoint has no business writing.
        //
        // `cleanData` is spread into the update, so every key the caller sends
        // lands on the window. Three groups of them belong to code that holds a
        // lock or performs side effects, and writing them here silently skips
        // that:
        //
        //   fundedAmount / currentFunding / currentVolume / spotsFilled
        //     maintained by incrementWithinCeiling, which locks the row and
        //     checks the ceiling in one statement. A plain write here desyncs
        //     the counters from the payments and bookings that produced them,
        //     and the desync is invisible.
        //
        //   status
        //     updateExportStatusAction applies refuseExportStatusChange AND, on
        //     "completed", emails every investor a statement of their returns
        //     and closes their slots. Setting it here settles a window with none
        //     of that happening.
        //
        // The admin edit form sends none of these — its only `status` fields are
        // on timeline phases — so refusing them changes nothing it does.
        const PROTECTED_FIELDS = [
            "status",
            "fundedAmount",
            "currentFunding",
            "currentVolume",
            "spotsFilled",
            "participantsCount",
            "investorCount",
            "userId",
            "createdBy",
        ];
        const refused = PROTECTED_FIELDS.filter((f) => f in cleanData);
        if (refused.length > 0) {
            return {
                error: `These fields cannot be edited here: ${refused.join(", ")}. `
                    + `Use the status action for status, and the payment or booking flows for funding totals.`,
                success: false as const,
                meta: null,
            };
        }

        await exportRef.update({ ...cleanData,
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, meta: null , data: { message: "Export window updated" } };
    } catch (error: any) { logger.error("Update export window error:", error);
        return { error: "Failed to update export window", success: false as const, meta: null };
    }
}


// ============================================
// Get Export Windows Action
// ============================================

export async function getExportWindowsAction(
    statusFilter?: string,
    fromDate?: string,
    toDate?: string,
    limit: number = 20,
    lastId?: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Build query
        let exportsQuery = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId);

        // Apply status filter if provided
        if (statusFilter && statusFilter !== "all") { exportsQuery = exportsQuery.where("status", "==", statusFilter);
        }

        // Apply sorting
        exportsQuery = exportsQuery.orderBy("createdAt", "desc");

        // Apply Cursor
        if (lastId) { const lastDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastId).get();
            if (lastDoc.exists) {
                exportsQuery = exportsQuery.startAfter(lastDoc);
            }
        }

        // Apply Limit
        exportsQuery = exportsQuery.limit(limit);

        const snapshot = await exportsQuery.get();

        let exports = serializeDocs<ExportWindow>(snapshot.docs);

        // Apply client-side date filtering (Note: This breaks pagination if used with limit. 
        // For now we keep it but warn that date filtering + pagination is complex in NoSQL without composite indexes)
        if (fromDate || toDate) { exports = exports.filter(exp => {
                const createdDate = exp.createdAt;

                if (fromDate && toDate) {
                    return createdDate >= new Date(fromDate) && createdDate <= new Date(toDate);
                } else if (fromDate) { return createdDate >= new Date(fromDate);
                } else if (toDate) { return createdDate <= new Date(toDate);
                }

                return true;
            });
        }

        const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return { error: null, success: true as const, data: exports, meta: { cursor: lastDocId, hasMore: !!lastDocId }
        };
    } catch (error: any) { logger.error("Get export windows error:", error);
        return { error: "Failed to fetch export windows", success: false as const, meta: null };
    }
}


// ============================================
// Get Export Window Details Action
// ============================================

// Alias as an async wrapper — "use server" files can only export async functions, not const aliases
export async function getExportRequestByIdAction(exportId: string) { return getExportWindowDetailsAction(exportId); }


export async function getExportWindowDetailsAction(
    exportId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) { return { error: "Export window not found", success: false as const, data: null };
        }

        const data = exportDoc.data();
        if (!data) { return { error: "Export window data is missing", success: false as const, data: null };
        }

        // Verify ownership (unless admin)
        if (data.userId !== session.user.id && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) { return { error: "Unauthorized to view this export", success: false as const, data: null };
        }

        const exportWindow = serializeDoc<ExportWindow>(exportDoc.id, data);

        return { error: null, success: true as const, data: exportWindow, export: exportWindow // For compatibility
 };
    } catch (error: any) { logger.error("Get export details error:", error);
        return { error: "Failed to fetch export details", success: false as const, data: null };
    }
}
