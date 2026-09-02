"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { refuseExportStatusChange, hasExportAdminAccess, EXPORT_WINDOW_ALL_STATUSES } from "@/lib/export-window-status";
import { claimIdempotencyKey } from "@/lib/wallet-ledger";
import { revalidatePath, revalidateTag } from "next/cache";
import { parseCurrencyStringToFloat } from "@/lib/utils";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import type { ExportWindow } from "@/lib/types/firestore";
import { exportWindowSchema } from "@/lib/types/export-actions";
import type { CreateExportActionState, UpdateStatusActionState } from "@/lib/types/export-actions";

/**
 * Flush the public opportunity feed.
 *
 * TWO CACHE TAGS THAT NOTHING COULD EVER TRIGGER.
 *
 * actions/export-investments.ts — the reader behind /export/windows and
 * /export/windows/{id} — declares them:
 *
 *     { revalidate: 60,   tags: ["export-opportunities"] }
 *     { revalidate: 3600, tags: [`export-opportunity-${id}`] }
 *
 * and `revalidateTag` appears nowhere in this codebase for either. A tag with
 * no writer is a `revalidate` interval wearing a tag's clothes, so the
 * single-opportunity entry lived its full HOUR: a window an admin closed, or
 * whose ROI or description they corrected, kept serving the old copy to the
 * public page with no way to flush it.
 *
 * The invest action re-reads the window and refuses a status that is not open,
 * so this cost a visitor a filled-in form and a refusal rather than a bad
 * investment — but the page was telling them something the server would not
 * honour.
 *
 * Called from the three actions that change a window. Best-effort: the write
 * has already committed by this point, and failing the action over a cache key
 * would report a failure that did not happen.
 *
 * `"max"` is the second argument this version of Next.js requires — the
 * one-argument form is deprecated (node_modules/next/dist/docs, revalidateTag).
 * It marks the tag stale and serves stale-while-revalidate, so the next visitor
 * to /export/windows refreshes it rather than every tagged page revalidating at
 * once. `updateTag` would expire it immediately; that is for read-your-own-
 * writes, and the admin closing a window is not the person browsing the public
 * feed.
 */
function revalidateExportOpportunities(windowId?: string): void {
    try {
        revalidateTag("export-opportunities", "max");
        if (windowId) revalidateTag(`export-opportunity-${windowId}`, "max");
    } catch (err) {
        logger.error("[export] failed to revalidate the opportunity cache", err);
    }
}

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

        /**
         * COMPLIANCE IS CHECKED BEFORE THE KEY IS CLAIMED.
         *
         * The claim used to come first, and both compliance checks below THREW
         * — so a submission that failed KYC burned the idempotency key and
         * never released it. ExportWindowModal generates the key once, when the
         * modal OPENS, and never regenerates it:
         *
         *     useEffect(() => { if (isOpen) setIdempotencyKey(crypto.randomUUID()) }, [isOpen])
         *
         * So the member read "You must complete KYC verification", completed
         * their KYC, pressed Create again in the same open modal — and got
         * "Duplicate transaction detected. Please wait." A message telling them
         * to wait for something that would never resolve, escapable only by
         * closing and reopening the modal, which nothing on the screen suggests.
         *
         * These are reads with no side effects, so they cost nothing to run
         * first. The key is claimed immediately before the write it protects,
         * which is the only place it protects anything.
         */
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        if (!userData?.isVerified) {
            return { error: "Compliance Error: You must complete KYC verification to create Export Windows.", success: false as const, data: null };
        }

        const exportReg = userData?.serviceRegistrations?.export;
        const serviceNumber = exportReg?.registrationNumber || userData?.cacNumber;

        if (!serviceNumber && exportReg?.status !== "approved") {
            return { error: "Compliance Error: Missing Export Service Registration (NEPC/CAC).", success: false as const, data: null };
        }

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
                // export_windows holds two entities. This is the SHIPMENT one —
                // a private export request moving pending → in_transit →
                // delivered → completed. Stamped so the status rule does not
                // have to infer it. See lib/export-window-status.ts.
                windowKind: "shipment" as const,
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
        revalidateExportOpportunities();

        return { error: null, success: true as const, message: `Export window created successfully! Order ID: ${finalOrderId }`,
            meta: null
        , data: { orderId: finalOrderId } };
    } catch (error: any) { logger.error("Create export window error:", error);

        /**
         * THE GUARD COVERED ONE OF THE TWO CALLS IT WAS WRITTEN FOR.
         *
         *     if (error.message && error.message.includes("Duplicate") || error.message.includes("Compliance"))
         *
         * groups as `(A && B) || C`, so whenever `error.message` was undefined
         * the first half was falsy and the SECOND `.includes` ran on undefined
         * — a TypeError, thrown from inside the catch block, which turns a
         * handled failure into an unhandled rejection out of a server action.
         * The `error.message &&` was plainly meant to protect both.
         *
         * Read from a single normalised string now, so there is nothing to get
         * the precedence of. The compliance messages are returned rather than
         * thrown as of this change, so this branch only still catches a
         * "Duplicate" raised from deeper down.
         */
        const message = typeof error?.message === "string" ? error.message : "";

        if (message.includes("Duplicate") || message.includes("Compliance")) {
            return { error: message, success: false as const, data: null };
        }

        if (error?.name === "ZodError") { return { error: "Please fill in all required fields correctly", success: false as const, data: null };
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
            // The document itself, so the legal vocabulary is chosen by which
            // entity this is — an aggregation window's statuses are open /
            // closed / completed, not the shipment four.
            window: data,
        });
        if (refusal) {
            return { error: refusal, success: false as const, data: null };
        }

        // Prevent duplicate status updates to avoid multiple completion emails
        //
        // This was a read of `data.status` followed by an unguarded update, and
        // the comment above states exactly what that costs: two callers landing
        // together both read a status that is not yet `newStatus`, both pass,
        // and both proceed to email EVERY investor a statement of their returns.
        // The check existed for the emails and did not survive concurrency —
        // which is the only condition it was there for.
        //
        // Claimed instead, so exactly one caller wins and only the winner
        // notifies. `fromAny` is every status a window can hold except the
        // target: export_windows carries two vocabularies, because it holds two
        // different entities — see lib/export-window-status.ts.
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.EXPORT_WINDOWS,
            id: exportId,
            fromAny: EXPORT_WINDOW_ALL_STATUSES.filter((s) => s !== newStatus),
            to: newStatus,
            patch: { updatedAt: FieldValue.serverTimestamp() },
        });

        if (!claim.claimed) {
            if (claim.status === newStatus) {
                return { error: `Status is already ${newStatus}`, success: false as const };
            }
            if (claim.exists === false) {
                return { error: "Export window not found", success: false as const, data: null };
            }
            return {
                error: `This export is '${claim.status ?? "in an unrecorded state"}' and cannot be moved to ${newStatus}.`,
                success: false as const,
                data: null,
            };
        }

        // When a window completes, email all investors with their returns
        if (newStatus === "completed") { try {
                const { sendExportWindowCompleteEmail } = await import("@/lib/email-notifications");
                const slotsSnap = await db.collection(COLLECTIONS.EXPORT_SLOTS)
                    .where("exportId", "==", exportId)
                    .where("status", "==", "active")
                    .get();

                const windowTitle = data?.title || "Export Window";
                const roi = data?.roi || data?.returnRate || "N/A";

                /**
                 * A FAILED EMAIL LEFT THAT INVESTOR'S SLOT OPEN FOR EVER.
                 *
                 * Each callback emailed the investor and THEN marked the slot
                 * completed, so an email that threw skipped the write beside it.
                 * The status transition had already been claimed by then, so
                 * there was no second chance: calling the action again returns
                 * "Status is already completed". That investor's slot stayed
                 * `status: "active"` permanently while the window said settled,
                 * with nothing in between to reconcile them.
                 *
                 * The slot closes FIRST now. The money outcome is not contingent
                 * on a mail server.
                 *
                 * CORRECTION TO MY OWN FIRST NOTE HERE, kept because the mistake
                 * is instructive: I wrote that Promise.all "abandons the rest",
                 * and mutation-testing disproved it — .map() has already started
                 * every promise, so a rejection abandons only the AWAIT, not the
                 * work. Every investor was in fact emailed. What Promise.all
                 * really cost was VISIBILITY: the aggregate rejection went to the
                 * catch below, which logs one generic line, so nobody could tell
                 * which investors had been missed or how many. allSettled counts
                 * and names them.
                 */
                const outcomes = await Promise.allSettled(slotsSnap.docs.map(async (slotDoc) => {
                    const slot = slotDoc.data();
                    if (!slot.userId) return;

                    const userDoc = await db.collection(COLLECTIONS.USERS).doc(slot.userId).get();
                    const userEmail = userDoc.data()?.email;
                    const userName = userDoc.data()?.name || userDoc.data()?.displayName || "Investor";

                    // The slot closes whether or not the notification lands.
                    // Emailing first and marking second meant a mail failure
                    // left the slot open with no second chance at either.
                    await slotDoc.ref.update({ status: "completed", completedAt: FieldValue.serverTimestamp() });

                    if (!userEmail) return;

                    await sendExportWindowCompleteEmail(
                        userEmail,
                        userName,
                        windowTitle,
                        slot.amount || 0,
                        slot.expectedReturn || 0,
                        String(roi)
                    );
                }));

                const failures = outcomes.filter((o) => o.status === "rejected");
                if (failures.length > 0) {
                    logger.error(
                        `[Export Complete] ${failures.length} of ${outcomes.length} investor slots on window ` +
                        `${exportId} did not settle cleanly. The window is already 'completed' and this action ` +
                        `cannot be re-run, so these need reconciling by hand.`,
                        failures.map((f) => (f as PromiseRejectedResult).reason)
                    );
                }

                logger.info(
                    `[Export Complete] Settled ${outcomes.length - failures.length} of ${outcomes.length} ` +
                    `investor slots for window: ${exportId}`
                );
            } catch (emailErr) { logger.error("[Export Complete] Failed to notify investors:", emailErr);
                // Don't block the status update on email failure
            }
        }

        revalidateExportOpportunities(exportId);

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

        revalidateExportOpportunities(exportId);

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

        /**
         * THE DATE FILTER MATCHED NOTHING. EVER.
         *
         * It ran in memory, over serialized documents, and compared like this:
         *
         *     const createdDate = exp.createdAt;                 // an ISO STRING
         *     return createdDate >= new Date(fromDate)           // string >= Date
         *
         * serializeDoc turns a Timestamp into an ISO string, and `>=` between a
         * string and a Date coerces the Date to a number and then the string to
         * a number — `Number("2026-05-01T00:00:00.000Z")` is NaN. Every
         * comparison with NaN is false, in BOTH directions. So filtering the
         * export window list by any date returned an empty list, always, and it
         * looked exactly like having no windows in that range.
         *
         * The filter belongs in the query anyway. The note this replaces —
         * "date filtering + pagination is complex in NoSQL without composite
         * indexes" — described Firestore; this runs on Postgres through
         * PostgREST, where a range predicate beside an equality and an order is
         * ordinary. admin/_academy.ts already filters this way.
         *
         * dateRangeStart / dateRangeEnd are the shared helpers from #33, which
         * exists because a hand-rolled boundary put the query in UTC and the
         * backstop in local time.
         */
        if (fromDate) {
            exportsQuery = exportsQuery.where("createdAt", ">=", dateRangeStart(fromDate));
        }
        if (toDate) {
            exportsQuery = exportsQuery.where("createdAt", "<=", dateRangeEnd(toDate));
        }

        // Apply sorting
        exportsQuery = exportsQuery.orderBy("createdAt", "desc");

        // Apply Cursor
        if (lastId) { const lastDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastId).get();
            if (lastDoc.exists) {
                exportsQuery = exportsQuery.startAfter(lastDoc);
            }
        }

        // One extra row, so "is there more" is observed rather than guessed.
        // `snapshot.docs.length === limit` is true on the LAST page whenever the
        // total is an exact multiple of the page size, and the caller then asked
        // for a page that does not exist. Same correction as #216.
        exportsQuery = exportsQuery.limit(limit + 1);

        const snapshot = await exportsQuery.get();

        const hasMore = snapshot.docs.length > limit;
        const pageDocs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

        const exports = serializeDocs<ExportWindow>(pageDocs);

        const lastDocId = hasMore && pageDocs.length > 0
            ? pageDocs[pageDocs.length - 1].id
            : null;

        return { error: null, success: true as const, data: exports, meta: { cursor: lastDocId, hasMore }
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

        /**
         * The third gate in this file, and the only one that disagreed.
         *
         * A hand-written `admin || super_admin` read from the session TOKEN.
         * The two WRITE actions above both resolve roles from the database and
         * ask hasExportAdminAccess, which recognises `export_admin` — so an
         * export administrator could settle a window and edit its details, and
         * could not open it. Both of those comments record fixing exactly this
         * divergence; the read was left behind.
         */
        const viewerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const viewerRoles: string[] = viewerDoc.data()?.roles ?? [];

        if (data.userId !== session.user.id && !hasExportAdminAccess(viewerRoles)) {
            return { error: "Unauthorized to view this export", success: false as const, data: null };
        }

        const exportWindow = serializeDoc<ExportWindow>(exportDoc.id, data);

        return { error: null, success: true as const, data: exportWindow, export: exportWindow // For compatibility
 };
    } catch (error: any) { logger.error("Get export details error:", error);
        return { error: "Failed to fetch export details", success: false as const, data: null };
    }
}
