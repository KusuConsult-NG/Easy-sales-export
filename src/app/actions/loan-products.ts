"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createAdminAuditLog } from "@/lib/audit-log";
import { FieldValue } from "@/lib/firestore-compat";

export interface LoanProduct { id?: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;
    durationMonths: number;
    isActive: boolean; }

/**
 * Reject a loan product whose numbers cannot describe a real loan.
 *
 * WHY THIS IS HERE AND NOT ONLY IN THE API ROUTE
 * ----------------------------------------------
 * There are two ways to write this collection. /api/admin/cooperative/
 * create-loan-product validates its input — required fields, minAmount <
 * maxAmount, Number() and Boolean() coercion — and stamps createdBy/createdAt.
 * These server actions did none of it: `add(data)` wrote whatever arrived.
 *
 * So the action was a bypass around the route's validation, into the same
 * collection, and the values matter because /api/cooperative/apply-loan reads
 * this product and computes the borrower's monthly payment from
 * `interestRate` and `durationMonths`.
 *
 * WHAT A BAD PRODUCT DOES DOWNSTREAM
 * ----------------------------------
 *   durationMonths: 0   the annuity denominator is (1+r)^0 - 1 = 0, so the
 *                       payment is Infinity
 *   minAmount > maxAmount   the range check can never pass, so the product is
 *                       silently unusable rather than visibly wrong
 *   negative interestRate   a negative instalment: the lender pays the borrower
 *   amounts as strings  arithmetic that mostly coerces, until it does not
 *
 * A rate of ZERO is deliberately allowed. An interest-free product is a real
 * thing a cooperative offers, and the API route rejects it only by accident —
 * `!interestRate` is true for 0. The division-by-zero it used to cause in
 * apply-loan is fixed there rather than banned here.
 */
function validateLoanProduct(
    data: Partial<LoanProduct>,
    { partial }: { partial: boolean }
): string | null {
    const required = ["name", "description", "minAmount", "maxAmount", "interestRate", "durationMonths"] as const;
    if (!partial) {
        for (const field of required) {
            if (data[field] === undefined || data[field] === null || data[field] === "") {
                return `${field} is required`;
            }
        }
    }

    if (data.name !== undefined && !String(data.name).trim()) return "name cannot be empty";
    if (data.description !== undefined && !String(data.description).trim()) return "description cannot be empty";

    for (const field of ["minAmount", "maxAmount"] as const) {
        const value = data[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            return `${field} must be a positive number`;
        }
    }

    if (data.interestRate !== undefined) {
        if (typeof data.interestRate !== "number" || !Number.isFinite(data.interestRate) || data.interestRate < 0) {
            return "interestRate must be zero or a positive number";
        }
    }

    if (data.durationMonths !== undefined) {
        if (!Number.isInteger(data.durationMonths) || data.durationMonths < 1) {
            return "durationMonths must be a whole number of months, at least 1";
        }
    }

    if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
        return "isActive must be true or false";
    }

    if (data.minAmount !== undefined && data.maxAmount !== undefined && data.minAmount >= data.maxAmount) {
        return "minAmount must be less than maxAmount";
    }

    return null;
}

/** Only the fields a loan product is allowed to carry. */
function pickProductFields(data: Partial<LoanProduct>): Partial<LoanProduct> {
    const picked: Record<string, any> = {};
    for (const field of ["name", "description", "minAmount", "maxAmount", "interestRate", "durationMonths", "isActive"] as const) {
        if (data[field] !== undefined) picked[field] = data[field];
    }
    return picked as Partial<LoanProduct>;
}

/**
 * Admin: Get paginated loan products
 */
/**
 * The four admin functions below ask PERMISSION_MATRIX rather than naming
 * ['admin', 'super_admin'] by hand.
 *
 * They manage LOAN_PRODUCTS — the interest rate and amount band every borrower
 * is offered — and api/admin/cooperative/{create,update,delete}-loan-product
 * manage the same collection. Those routes were moved onto the matrix in the
 * admin pass; these were the other half of the same pair and still named roles,
 * so `cooperative_admin` could maintain the loan catalogue through the routes
 * and was refused through the actions.
 *
 * "cooperatives:approve_loans" and NOT "cooperatives:manage_products", which is
 * the semantically exact permission. The matrix deliberately withholds
 * manage_products from the plain `admin` role, so adopting it here would take
 * away something an admin can do today — the same trade taken for the routes,
 * recorded there too. Closing the cross-module hole without narrowing an
 * existing role is the deliberate half-step; whether loan products should be
 * cooperative_admin-and-super_admin only is the owner's call.
 */
export async function getAdminLoanProductsAction(options: { limit?: number;
    lastDocId?: string; } = {}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const fetchLimit = options.limit || 20;

        let query = db.collection(COLLECTIONS.LOAN_PRODUCTS)
            .orderBy("minAmount", "asc");

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const products = serializeDocs(docs) as unknown as LoanProduct[];
        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { error: null, success: true as const, data: products, lastDocId: nextCursor, hasMore
 };
    } catch (error: any) { logger.error("Failed to fetch admin loan products:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

export async function createAdminLoanProductAction(data: Omit<LoanProduct, "id">) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        
        if (!hasAdminPermission(sessionResult.session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const invalid = validateLoanProduct(data, { partial: false });
        if (invalid) return { success: false as const, error: invalid, data: null };

        const newDocRef = await db.collection(COLLECTIONS.LOAN_PRODUCTS).add({
            // Only known fields, so the caller cannot attach arbitrary keys to a
            // record the loan maths reads.
            ...pickProductFields(data),
            isActive: data.isActive ?? true,
            // Matching what the API route stamps, so a product carries the same
            // provenance whichever path created it.
            createdBy: sessionResult.session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        await createAdminAuditLog({ action: "loan_product_created",
            userId: sessionResult.session.user.id,
            targetId: newDocRef.id,
            targetType: "loan_product",
            metadata: { name: data.name }
        });

        return { error: null,  success: true as const , data: null };
    } catch (error: any) { logger.error("Create loan product error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

export async function updateAdminLoanProductAction(productId: string, data: Partial<LoanProduct>) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        
        if (!hasAdminPermission(sessionResult.session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const patch = pickProductFields(data);
        if (Object.keys(patch).length === 0) {
            return { success: false as const, error: "Nothing to update", data: null };
        }

        const productRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId);
        const existing = await productRef.get();
        if (!existing.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        // Validated against the MERGED product, not the patch alone. Raising
        // minAmount above the stored maxAmount is only visible once the two are
        // considered together, and it leaves a product no amount can satisfy.
        const merged = { ...(existing.data() as LoanProduct), ...patch };
        const invalid = validateLoanProduct(merged, { partial: false });
        if (invalid) return { success: false as const, error: invalid, data: null };

        await productRef.update({ ...patch, updatedAt: FieldValue.serverTimestamp() } as any);
        
        await createAdminAuditLog({ action: "loan_product_updated",
            userId: sessionResult.session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: { ...patch }
        });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Update loan product error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

export async function deleteAdminLoanProductAction(productId: string) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        
        if (!hasAdminPermission(sessionResult.session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const docRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId);
        const doc = await docRef.get();
        if (!doc.exists) return { success: false as const, error: "Product not found", data: null };

        await docRef.delete();
        
        await createAdminAuditLog({ action: "loan_product_deleted",
            userId: sessionResult.session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: { name: doc.data()?.name }
        });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Delete loan product error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}
