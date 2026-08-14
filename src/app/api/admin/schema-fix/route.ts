
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { runSchemaStandardizationAction } from "@/app/actions/schema-standardization";

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/schema-fix?dryRun=false
 *
 * Runs runSchemaStandardizationAction, which scans the users, products and
 * export_windows collections and fills in missing fields. super_admin only.
 * `dryRun` defaults to true; pass `?dryRun=false` to write.
 *
 * WHY THIS IS A POST
 * ------------------
 * It was a GET, and `?dryRun=false` makes it rewrite three collections:
 * `roles: ["general_user"]` onto any user whose roles field is not an array,
 * `isVerified: false`, `status: "draft"` and `price: 0` onto products missing
 * them, and timestamps.
 *
 * The session cookie is `sameSite: "lax"` (src/lib/auth.config.ts), which sends
 * the cookie on a top-level GET navigation. So a link — in an email, on a page,
 * anywhere a signed-in super_admin might click — reading
 *
 *     https://.../api/admin/schema-fix?dryRun=false
 *
 * ran the migration. No form, no token, no confirmation, and the mass-assignment
 * of `roles` is the part that bites: a user document with a malformed roles
 * field is reset to ["general_user"], which is a way to remove an
 * administrator's roles by getting a different administrator to click a link.
 *
 * Lax does not send cookies on a cross-site POST, so the method is the fix.
 * Even the default dry run was worth moving: it reads all 41,105 user documents
 * plus every product, and returns a `details` array naming each one.
 *
 * THE SECRET PATH COULD NOT WORK, AND IS GONE
 * -------------------------------------------
 * This route used to accept `Authorization: Bearer $CRON_SECRET` in place of a
 * session:
 *
 *     const hasValidSecret = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
 *     if (!hasValidSecret) { ...session check... }
 *
 * But runSchemaStandardizationAction opens with its own `requireSession()` and
 * a `config:update` check. A caller holding the secret and no session therefore
 * reached the action and was refused by it — and because the route returned the
 * action's result verbatim, the answer was **HTTP 200** carrying
 * `{ success: false, error: "Unauthorized..." }`.
 *
 * A scheduler pointed at this would have reported success forever while doing
 * nothing, which is exactly how the four unscheduled cron endpoints went
 * unnoticed for months (see docs/audit/outstanding-work.md §4). Nothing
 * references this route — no UI, no workflow, no script; `npm run fix:schema`
 * runs scripts/firebase-schema-fix.ts directly — so removing the path breaks no
 * caller, and a failure is now an error status.
 *
 * ONE DIVERGENCE LEFT ALONE
 * -------------------------
 * This route requires the `super_admin` ROLE; the action requires the
 * `config:update` PERMISSION, which `admin` also holds. So the route is
 * stricter than the action it calls, and the action is directly invokable as a
 * server action regardless of what this route decides.
 *
 * Not reconciled here, in either direction: narrowing the action would take
 * `config:update` away from `admin` for every other use, and widening the route
 * would let `admin` rewrite the users collection. Both are product decisions,
 * of the kind already recorded in admin-route-authority.test.ts. The stricter
 * of the two is the one on the path a person actually uses.
 */
export async function POST(request: Request) {
    const { session } = await requireSession();
    if (!session?.user?.roles?.includes("super_admin")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") !== "false"; // Default to true (safe)

    try {
        const result = await runSchemaStandardizationAction(dryRun);

        // The action's own refusal used to be reported as a success. A caller
        // who passed the check above always holds config:update, so a false
        // here means the run itself failed rather than that it was refused.
        if (!result.success) {
            return NextResponse.json(result, { status: 500 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
