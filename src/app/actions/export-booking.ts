"use server";

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { auth } from '@/lib/auth';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { incrementWithinCeiling } from "@/lib/wallet-ledger";
import { serializeDocs } from "@/lib/firestore-serialize";
import { requireAdmin } from "@/lib/require-admin";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { debitJsonbBalanceWithFloor } from "@/lib/wallet-ledger";
import { getTableName } from "@/lib/supabase-db";
import { createAdminAuditLog } from "@/lib/audit-log";
import { createNotification } from "@/infrastructure/notifications/service";

/**
 *   #348 THE BOOKING WIZARD ASKED FOR FOUR SCREENS AND SENT THREE FIELDS.
 *
 *        BookingWizard.tsx validates the member through four stages —
 *        refusing to advance without moisture and foreign-matter percentages,
 *        a declared Phytosanitary Certificate, a port, a vessel, and UPLOADS
 *        of the Bill of Lading and Certificate of Origin. Then handleConfirm
 *        sent:
 *
 *            createBookingAction({ exportWindowId, quantity, totalPrice })
 *
 *        Everything from stages 2, 3 and 4 was discarded at the call site,
 *        including both files. The member selected two documents, watched them
 *        be accepted, and nothing was uploaded anywhere — there was no upload
 *        code in the component at all. The booking row carried none of it, so
 *        the export team had a reserved slot and no idea what was in it or how
 *        it was shipping.
 *
 *        The fields are part of the payload now, validated here rather than
 *        only in the browser, and the two documents are uploaded before the
 *        booking is sent so the row references real files.
 */
export interface CreateBookingData { exportWindowId: string;
    quantity: number;
    totalPrice: number;
    /** Stage 2 — quality declaration. Percentages, 0-100. */
    moisturePercent?: number;
    foreignMatterPercent?: number;
    hasPhytosanitaryCertificate?: boolean;
    /** Stage 3 — logistics. */
    shippingTerms?: string;
    portOfOrigin?: string;
    vessel?: string;
    /** Stage 4 — uploaded document URLs, not the files themselves. */
    billOfLadingUrl?: string;
    certificateOfOriginUrl?: string; }

/** A percentage the member declared: 0-100, or undefined if unusable. */
function percentOrUndefined(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
    return n;
}

/**
 * Create an export booking in Firestore
 */
export async function createBookingAction(data: CreateBookingData) { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        // Validate input. totalPrice is deliberately NOT checked here — it is
        // recalculated below and the caller's copy is discarded.
        const quantity = Number(data.quantity);
        if (!data.exportWindowId || !Number.isFinite(quantity) || quantity <= 0) {
            return { success: false as const, data: null, error: 'Invalid booking data', meta: null };
        }

        // Check if export window exists and has availability
        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.exportWindowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) { return { success: false as const, data: null, error: 'Export window not found', meta: null };
        }

        const windowData = windowDoc.data()!;

        // The price comes from the window, not from the browser.
        //
        // totalPrice arrived as a parameter and was stored as the booking's
        // money figure, checked only for being above zero. BookingWizard.tsx
        // computes it as `volume * exportWindow.slotPrice` and sends the result
        // — so the arithmetic the server recorded was the client's.
        //
        // The server has slotPrice in the very document it just read, and
        // export-aggregation.ts already does this correctly one file over:
        //   const totalCost = data.volume * windowData.slotPrice;
        //
        // A booking also RESERVES capacity through incrementWithinCeiling
        // below, so a caller-chosen price meant consuming an export window's
        // volume while recording whatever total they liked against it.
        //
        // Derived before the reservation, so a window with no usable price
        // fails without consuming volume first.
        const slotPrice = Number(windowData.slotPrice ?? 0);
        if (!Number.isFinite(slotPrice) || slotPrice <= 0) {
            return { success: false as const, data: null, error: 'This export window is not priced for booking', meta: null };
        }
        const totalPrice = slotPrice * quantity;

        // Reserve the volume under a row lock, BEFORE the booking is written.
        //
        // This read targetVolume - currentVolume, compared, and then raised
        // currentVolume — with no transaction at all, which is why every sweep
        // of the atomic-money migration missed this file: those tables are
        // ordered by runTransaction count and this file has none. Two bookings
        // for the remaining volume both passed and the window went over target.
        //
        // Migration 010 made it worse rather than better, as it did for escrow,
        // cooperative savings and stock: the increments used to lose one
        // another, which hid the overshoot.
        //
        // Reserve first, write second — the losing booker is told the volume is
        // gone rather than ending up with a booking against capacity that does
        // not exist. Same ordering as the farm-nation property reservation.
        //
        // A window with no targetVolume recorded is treated as UNBOUNDED by
        // increment_within_ceiling. That matches the old behaviour rather than
        // changing it: `quantity > (undefined - currentVolume)` is
        // `quantity > NaN`, which is false, so those windows already accepted
        // every booking. admin.ts treats a missing targetVolume as "not
        // crowdfunded", so this is a real category, not a data error.
        const reserved = await incrementWithinCeiling({
            collection: COLLECTIONS.EXPORT_WINDOWS,
            id: data.exportWindowId,
            field: "currentVolume",
            amount: quantity,
            ceilingField: "targetVolume",
        });

        if (!reserved.ok) {
            const available = reserved.reason === "at_capacity"
                ? Math.max(0, Number(windowData.targetVolume ?? 0) - Number(reserved.value ?? 0))
                : 0;
            return {
                success: false as const,
                error: reserved.reason === "at_capacity"
                    ? `Only ${available}kg available`
                    : 'Export window not found',
                data: null,
                meta: null
            };
        }

        // #348 The quality and logistics declaration, coerced here rather than
        // trusted: the browser's validation is a convenience, and these values
        // are what an export officer reads off the booking. A percentage that
        // is not a usable percentage is recorded as absent rather than as NaN
        // or as a string.
        const moisturePercent = percentOrUndefined(data.moisturePercent);
        const foreignMatterPercent = percentOrUndefined(data.foreignMatterPercent);

        // Create booking. The volume is already reserved above, so this cannot
        // oversell even if two bookings land together.
        const bookingRef = await db.collection(COLLECTIONS.EXPORT_BOOKINGS).add({
            userId: session.user.id,
            exportWindowId: data.exportWindowId,
            quantity,
            totalPrice,
            slotPriceAtBooking: slotPrice,
            status: 'pending',
            // #348 What the wizard collected and then threw away.
            ...(moisturePercent !== undefined ? { moisturePercent } : {}),
            ...(foreignMatterPercent !== undefined ? { foreignMatterPercent } : {}),
            hasPhytosanitaryCertificate: Boolean(data.hasPhytosanitaryCertificate),
            shippingTerms: String(data.shippingTerms ?? "").slice(0, 40),
            portOfOrigin: String(data.portOfOrigin ?? "").slice(0, 120),
            vessel: String(data.vessel ?? "").slice(0, 120),
            documents: {
                billOfLading: String(data.billOfLadingUrl ?? ""),
                certificateOfOrigin: String(data.certificateOfOriginUrl ?? ""),
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        await windowRef.update({ updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, data: { bookingId: bookingRef.id } };
    } catch (error) {
        logger.error('Create booking error:', error);
        return {
            success: false as const,
            error: 'Failed to create booking',
            data: null,
            meta: null
        };
    }
}

/**
 * Get user's bookings
 */
export async function getUserBookingsAction() { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        const snapshot = await db.collection(COLLECTIONS.EXPORT_BOOKINGS)
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc')
            .get();

        const bookings = serializeDocs(snapshot.docs);

        return { success: true as const, data: bookings, error: null, meta: null };
    } catch (error) { logger.error('Get bookings error:', error);
        return { success: false as const, data: null, error: 'Failed to fetch bookings', meta: null };
    }
}

/**
 *   #380 A BOOKING RESERVED CAPACITY THAT NOBODY COULD ACT ON.
 *
 *        #311 corrected the wizard's copy — it had promised an email nothing
 *        sends — and recorded the larger problem for the owner: a booking is
 *        created with `status: 'pending'`, it RESERVES VOLUME against the
 *        window's targetVolume through incrementWithinCeiling, and then
 *        NOTHING in the codebase ever writes that status again. Measured, and
 *        pinned by a test: one writer, and the only two readers are the
 *        member's own list and a dashboard count.
 *
 *        So the capacity was consumed permanently by a booking no one could
 *        confirm or cancel. A window fills with pending bookings, and the next
 *        genuine member is refused with "Only 0kg available" — for slots that
 *        were never taken up. The member is told (correctly, since #311) to
 *        message the export team; the export team had no screen to act on.
 *
 *        THE DECISION, TAKEN: give the export team the two actions the flow
 *        already implies, and make cancelling RELEASE what booking reserved.
 *        The alternative — an automatic expiry — was rejected: nothing records
 *        an agreed deadline for a booking, and inventing one would cancel
 *        bookings the team is actively arranging payment for. A person decides;
 *        the platform makes the decision possible and records it.
 *
 *        THE RELEASE LIVES HERE, BESIDE THE RESERVE, deliberately. They are one
 *        rule seen from two ends, and this codebase's recurring defect is a
 *        pair like that drifting apart in different files.
 */

/** What an export officer may set a pending booking to. */
// THE SET LIVES IN lib/server-action-values — #382. A "use server" module may
// only export async functions; an array export failed the build. Imported and
// NOT re-exported: a re-export is still a value export from this module.
import { EXPORT_BOOKING_DECISIONS, type ExportBookingDecision } from "@/lib/server-action-values";

/**
 * The bookings an export officer works from, newest first.
 *
 * Gated on export:approve_applications — the permission #375 gave the rest of
 * the export queue, held by super_admin, admin and export_admin. The member's
 * name and email are included because arranging payment is the whole point of
 * the screen; nothing else from the user row is.
 */
export async function getExportBookingsForAdminAction(): Promise<
    | { success: true; error: null; data: any[]; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> {
    try {
        const gate = await requireAdmin("export:approve_applications");
        if ("error" in gate) return { success: false as const, error: gate.error, data: null };

        const snapshot = await db.collection(COLLECTIONS.EXPORT_BOOKINGS)
            .orderBy("createdAt", "desc")
            .limit(200)
            .get();

        const bookings = serializeDocs(snapshot.docs) as any[];

        // The window title and the member's contact, resolved once per id
        // rather than once per row.
        const windowIds = Array.from(new Set(bookings.map((b) => b.exportWindowId).filter(Boolean)));
        const userIds = Array.from(new Set(bookings.map((b) => b.userId).filter(Boolean)));

        const [windowDocs, userDocs] = await Promise.all([
            Promise.all(windowIds.map((id) => db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(id).get())),
            Promise.all(userIds.map((id) => db.collection(COLLECTIONS.USERS).doc(id).get())),
        ]);

        const windows = new Map(windowDocs.map((d, i) => [windowIds[i], d.data()]));
        const users = new Map(userDocs.map((d, i) => [userIds[i], d.data()]));

        return {
            success: true as const,
            error: null,
            data: bookings.map((b) => {
                const w = windows.get(b.exportWindowId);
                const u = users.get(b.userId);
                return {
                    ...b,
                    windowTitle: w?.title ?? "(window not found)",
                    windowCommodity: w?.commodity ?? "",
                    // #151's rule: the fields the job needs, named, not the row.
                    memberName: u?.fullName ?? u?.name ?? "",
                    memberEmail: u?.email ?? "",
                    memberPhone: u?.phone ?? u?.phoneNumber ?? "",
                };
            }),
        };
    } catch (error) {
        logger.error("Get export bookings (admin) error:", error);
        return { success: false as const, error: "Failed to fetch export bookings", data: null };
    }
}

/**
 * Confirm or cancel a pending booking — and give the volume back on a cancel.
 *
 * ORDER, AND WHY: the status is CLAIMED first, then the volume is released.
 * Two officers cancelling the same booking at once must not both release it, and
 * the claim is what makes exactly one of them the winner. Releasing first and
 * writing after would let both releases land.
 *
 * The cost of that order is stated rather than hidden: if the release fails
 * after the claim, the booking is cancelled and the capacity is still held. That
 * is reported as a failure naming the window, so an operator can correct it —
 * NOT rolled back to pending, because a re-pending booking could be cancelled
 * again later and release the volume twice.
 */
export async function decideExportBookingAction(
    bookingId: string,
    decision: ExportBookingDecision,
): Promise<
    | { success: true; error: null; data: { status: ExportBookingDecision }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> {
    try {
        const gate = await requireAdmin("export:approve_applications");
        if ("error" in gate) return { success: false as const, error: gate.error, data: null };
        const adminId = (gate as { userId: string }).userId;

        if (!EXPORT_BOOKING_DECISIONS.includes(decision)) {
            return {
                success: false as const,
                error: `Unknown decision "${decision}". Allowed: ${EXPORT_BOOKING_DECISIONS.join(", ")}`,
                data: null,
            };
        }

        const bookingRef = db.collection(COLLECTIONS.EXPORT_BOOKINGS).doc(bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
            return { success: false as const, error: "Booking not found", data: null };
        }
        const booking = bookingSnap.data() as any;

        // Claimed, not checked-then-written. Only a pending booking can be
        // decided, and only one caller can decide it.
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.EXPORT_BOOKINGS,
            id: bookingId,
            fromAny: ["pending"],
            to: decision,
            patch: { decidedBy: adminId, decidedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                error: claim.status
                    ? `This booking is already '${claim.status}' and cannot be decided again`
                    : "Booking not found",
                data: null,
            };
        }

        let releasedKg = 0;
        if (decision === "cancelled") {
            const quantity = Number(booking.quantity);
            const windowId = String(booking.exportWindowId ?? "");

            if (Number.isFinite(quantity) && quantity > 0 && windowId) {
                // #380 — THIS DEBIT IS THE COMPENSATION, so it does not get one.
                //
                // Every other debitJsonbBalance* site in this codebase takes a
                // member's money and must credit it back if the writes that
                // follow fail (debit-compensation.test.ts holds that rule). This
                // one is not money: it subtracts kilograms from the window's
                // currentVolume, undoing the incrementWithinCeiling the booking
                // made above. Calling compensateJsonbDebit here would put the
                // reservation back for a booking that was just cancelled — the
                // exact defect this finding exists to fix.
                //
                // Floored at zero: a window whose currentVolume was repaired by
                // hand must not be driven negative by a release.
                const release = await debitJsonbBalanceWithFloor({
                    table: getTableName(COLLECTIONS.EXPORT_WINDOWS),
                    collection: COLLECTIONS.EXPORT_WINDOWS,
                    id: windowId,
                    field: "currentVolume",
                    amount: quantity,
                    floor: 0,
                });

                if (!release.ok) {
                    logger.error("[export-booking] CANCELLED BUT NOT RELEASED", {
                        bookingId, windowId, quantity, reason: release.reason,
                    });
                    return {
                        success: false as const,
                        error: `The booking is cancelled, but ${quantity}kg could not be released back to `
                            + `window ${windowId}. Please correct the window's current volume manually.`,
                        data: null,
                    };
                }
                releasedKg = quantity;
            }
        }

        await createAdminAuditLog({
            action: "user_update",
            userId: adminId,
            targetId: bookingId,
            targetType: "export_booking_decision",
            metadata: { decision, releasedKg, exportWindowId: booking.exportWindowId ?? null },
        });

        // The member is told. #311's whole finding was a booking screen
        // promising a message nothing sent; a decision that reaches nobody
        // would be the same defect one step later.
        if (booking.userId) {
            await createNotification({
                userId: booking.userId,
                type: "export",
                title: decision === "confirmed" ? "Export Booking Confirmed" : "Export Booking Cancelled",
                message: decision === "confirmed"
                    ? `Your booking of ${booking.quantity}kg has been confirmed by the export team.`
                    : `Your booking of ${booking.quantity}kg has been cancelled and the slot released.`,
                link: "/export/bookings",
                linkText: "View Bookings",
            }).catch((e) => logger.error("[export-booking] member notification failed:", e));
        }

        return { success: true as const, error: null, data: { status: decision } };
    } catch (error) {
        logger.error("Decide export booking error:", error);
        return { success: false as const, error: "Failed to update this booking", data: null };
    }
}
