import "server-only";

import { cache } from "react";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * The caller's user document, fetched ONCE per request.
 *
 *   THE OWNER, for the fourth time: "the app is still not fast, still taking
 *   so long to load the pages."
 *
 *   Measured with the read meter #261 added, rather than read off the source:
 *   drawing one WAVE page for an applicant who has not been approved costs
 *   FOURTEEN reads and TWELVE sequential round trips through its gates alone,
 *   before the page fetches a thing of its own.
 *
 *   FOUR of those fourteen are the SAME USER DOCUMENT, fetched by four callers
 *   that do not know each other exists — the layout's checkModuleAccess (twice:
 *   once directly, once inside the identity walk it need not have taken), the
 *   module's status action, and the sidebar's live-roles read. The academy page
 *   has its own four.
 *
 *   None of them is wrong on its own. That is exactly why it survived: the
 *   duplication is not inside any one function, so no reviewer of any one
 *   function could see it. The same shape as #539's nav polling, one layer
 *   down.
 *
 *   requireSession's copy of this read is already amortised — it goes through
 *   getCached, which falls back to an in-memory store for 300 seconds when
 *   Redis is absent. These four do not; they are direct `.doc(id).get()`
 *   calls, and they pay in full, every time.
 *
 * ── WHY A MAP RATHER THAN cache(fn) ─────────────────────────────────────────
 *
 *   React's `cache()` memoises a function for the life of one request, which
 *   is the semantics wanted here — Next's own docs prescribe it for exactly
 *   this (a DAL memoised to "avoid unnecessary duplicate requests to the
 *   database during a render pass").
 *
 *   But `cache(fn)` cannot be invalidated, and this row is written during a
 *   request: checkModuleAccess grants roles. `cache(() => new Map())` gives a
 *   request-scoped MUTABLE store instead, so a writer can drop its entry and
 *   the next reader fetches fresh.
 *
 *   THE PROMISE IS STORED, NOT THE VALUE. Two callers racing for the same id
 *   then share one in-flight read rather than starting two, which is the case
 *   this exists to remove.
 *
 * ── THE RULE THAT MAKES THIS SAFE, AND WHERE IT IS ENFORCED ────────────────
 *
 *   A MEMO OF A ROW THAT GETS WRITTEN MID-REQUEST IS #258 WAITING TO HAPPEN:
 *   a gate answering from a document that was true a moment ago, on money.
 *   checkModuleAccess grants roles; the academy bypass provisions an
 *   enrolment; the WAVE status check heals a registration. All three write the
 *   very row this memoises, during the render that reads it.
 *
 *   So the invalidation is not left to each of them to remember. Every one of
 *   those writers already clears `CacheKeys.userProfile` — session-guard serves
 *   that copy for 300 seconds, and #692 is what forgetting it costs — and the
 *   four functions in lib/cache-invalidation that clear it now drop this memo
 *   in the same breath. One rule, one place, and a writer cannot observe the
 *   long-lived cache and miss the short-lived one.
 *
 *   `forgetUserDoc` is exported for that module. It is not an invitation to
 *   write through this one.
 *
 *   checkModuleAccess ALSO STAYS ON ITS OWN DIRECT READ, for a second reason:
 *   it reads through `getAdminDb()`, and a memo shared between a privileged
 *   client and an ordinary one is a question nobody should have to ask at a
 *   gate. It is the layout's first call on every module page, so it would be
 *   the entry's author rather than its beneficiary anyway — it saves nothing
 *   and it would have to be reasoned about for ever.
 *
 * ── IT DEGRADES TO TODAY'S BEHAVIOUR, WHICH IS WHY IT IS SAFE TO ADD ────────
 *
 *   Outside a React request scope — under jest, in a script — `cache()` is a
 *   pass-through, so `requestScope()` returns a NEW map per call and nothing
 *   is shared. That is not a silent failure: it is precisely today's
 *   behaviour, one read per caller. The memo can only ever remove work.
 */
export interface UserDocSnapshot {
    exists: boolean;
    data: Record<string, any> | null;
}

/**
 * One mutable map per request.
 *
 * The argument-less `cache(() => new Map())` is the documented way to obtain
 * request-scoped mutable state: React memoises the zero-argument call, so every
 * caller within one request receives the same map.
 */
const requestScope = cache((): Map<string, Promise<UserDocSnapshot>> => new Map());

/** The user's document, reusing this request's read if one is already in flight. */
export function readUserDocOnce(userId: string): Promise<UserDocSnapshot> {
    const scope = requestScope();

    const inFlight = scope.get(userId);
    if (inFlight) return inFlight;

    const read = (async (): Promise<UserDocSnapshot> => {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        return { exists: snap.exists, data: snap.exists ? (snap.data() ?? null) : null };
    })();

    /*
     *   A FAILED READ MUST NOT BE REMEMBERED. Caching a rejected promise would
     *   make one transient error the answer for the rest of the request — and
     *   these are gates, so "could not read" becomes "no access" for every
     *   later caller instead of just the unlucky one.
     */
    void read.catch(() => { scope.delete(userId); });

    scope.set(userId, read);
    return read;
}

/**
 * Drop this request's memo of `userId`, so the next read fetches again.
 *
 * For a caller that has just WRITTEN the row and may be read after. It is not a
 * licence to write through this module — see the rule in the header.
 */
export function forgetUserDoc(userId: string): void {
    requestScope().delete(userId);
}
