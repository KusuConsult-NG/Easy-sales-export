/**
 * WHICH of a person's profiles they are signed in to.
 *
 *   #477 A PERSON WITH SIX PROFILES GOT A DIFFERENT ONE DEPENDING ON WHICH ROW
 *   WAS EDITED LAST.
 *
 *   auth.ts chose the caller's profile like this:
 *
 *       userSnap.docs.find(doc => doc.id === authedId)
 *       ?? userSnap.docs.find(doc => doc.data()?._migratedTo === authedId)
 *       ?? userSnap.docs.find(doc => doc.data()?.supabaseAuthId === authedId)
 *       ?? userSnap.docs[0];
 *
 *   The first three are real identity matches. THE FOURTH IS WHATEVER POSTGRES
 *   RETURNED FIRST, and the query carries no ORDER BY — measured, the request is
 *   literally `select=id&email=eq.…` with nothing else.
 *
 *   Postgres does not promise an order without one, and in MVCC an UPDATE writes
 *   a new row version at the end of the heap. Demonstrated on a real cluster with
 *   six rows sharing an email:
 *
 *       initial                     order-1 order-2 order-3 order-4 order-5 order-6
 *       after editing order-1       order-2 order-3 order-4 order-5 order-6 order-1
 *       after editing order-3       order-2 order-4 order-5 order-6 order-1 order-3
 *
 *   So the profile a duplicated user is signed in to CHANGES whenever any of
 *   their rows is edited. Sometimes the one with their registrations, sometimes
 *   an empty one. That is the owner's complaint exactly — "account not found or
 *   missing details even when they are fully registered" — and it is why it comes
 *   and goes rather than staying broken.
 *
 *   AND IT IS NOT HYPOTHETICAL. Production has, on one query:
 *
 *       lubashehu369@gmail.com     6 profiles
 *       walidazayyanu74@gmail.com  5
 *       nancindaniel@gmail.com     5
 *       … and many more on 3 and 4
 *
 *   CHOOSING SAFELY. Every candidate shares the email Supabase Auth has already
 *   proven the caller owns, so all of them are that person's rows — picking among
 *   them cannot sign anybody into a stranger's account. What it can do is pick a
 *   worse one, so the order below prefers the row carrying the most evidence of
 *   being their real profile, and ends with the id, which is a TOTAL order.
 *   Totality is the point: even a choice that is not ideal must be the SAME
 *   choice every time, because data that appears and disappears is far harder to
 *   report and to trust than data that is consistently wrong.
 *
 *   THIS DOES NOT MERGE OR DELETE ANYTHING. The duplicate rows stay exactly as
 *   they are. Deciding which of them is canonical, and whether the others should
 *   be merged, is an owner's decision about real people's data — this only stops
 *   the answer changing between logins while that decision is made.
 */

export interface ProfileCandidate {
    id: string;
    data(): any;
}

export interface ProfileChoice {
    /** The profile to sign in as, or null when there were no candidates. */
    chosen: ProfileCandidate | null;
    /** Which rule decided it — for the log, and for tests. */
    reason:
        | 'none'
        | 'document-id'
        | 'migrated-pointer'
        | 'supabase-auth-id'
        | 'best-evidence';
    /**
     * True when NO row identified itself with the authenticated account and the
     * choice came from evidence rather than from a link. Worth a loud line: it
     * means this person's rows need reconciling.
     */
    ambiguous: boolean;
    /** How many rows matched the email. */
    candidates: number;
}

const asRecord = (v: unknown): Record<string, any> =>
    v && typeof v === 'object' ? (v as Record<string, any>) : {};

/**
 * How many module registrations this profile carries that mean anything.
 *
 * The single best signal of "this is the row they actually used": a blank
 * auto-provisioned profile has none, and the row carrying their WAVE or academy
 * enrolment has one or more.
 */
export function registrationWeight(data: unknown): number {
    const regs = asRecord(asRecord(data).serviceRegistrations);
    let n = 0;
    for (const reg of Object.values(regs)) {
        const status = asRecord(reg).status;
        if (typeof status === 'string' && status !== '' && status !== 'not_started') n += 1;
    }
    return n;
}

/** Milliseconds, or null when there is no readable creation time. */
function createdAtMs(data: unknown): number | null {
    const raw = asRecord(data).createdAt;
    if (!raw) return null;
    const d =
        typeof (raw as any)?.toDate === 'function' ? (raw as any).toDate()
        : raw instanceof Date ? raw
        : new Date(raw as any);
    const t = d instanceof Date ? d.getTime() : NaN;
    return Number.isFinite(t) ? t : null;
}

/**
 * Order two candidates, best first. A TOTAL order — it never returns 0 for two
 * distinct rows, because the last comparison is the id.
 */
/**
 *   #490 A ROW THAT SAYS `_migratedTo: <somebody else>` HAS BEEN SUPERSEDED.
 *
 *        Reached only from betterFirst, which runs after every exact-match rule
 *        — so a row pointing AT the caller is still their record and never
 *        touches this. This is about the OTHER rows in the list.
 */
function isSuperseded(data: unknown, authedId: string): boolean {
    const pointer = asRecord(data)._migratedTo;
    return typeof pointer === 'string' && pointer !== '' && pointer !== authedId;
}

function betterFirst(a: ProfileCandidate, b: ProfileCandidate, authedId: string): number {
    const da = a.data();
    const db = b.data();

    /**
     *   #490 SUPERSESSION FIRST, AND THAT ORDER IS THE FINDING.
     *
     *        Rule 4 below prefers the OLDEST row, under the comment "The
     *        ORIGINAL account, not a later duplicate". That is right for two
     *        rival originals and exactly backwards after a migration: the
     *        migrated row IS the later duplicate, and it is the one holding
     *        everything — the merge of both records, every registration, the
     *        roles. The legacy row is a tombstone.
     *
     *        The two tie on rules 1-3, because the migrated row is a copy of the
     *        legacy one. So rule 4 chose the tombstone, and where createdAt was
     *        carried across by the merge, rule 5 decided a member's identity by
     *        a string comparison of document ids.
     *
     *        A returning member could be handed their superseded record, and the
     *        login path then MIGRATES from it — copying a dead row forward over
     *        the live one.
     *
     *        Ranked above registrations deliberately: a tombstone's extra
     *        registration is one the live row already inherited in the merge, so
     *        it is not evidence of anything.
     */
    const supersededA = isSuperseded(da, authedId) ? 1 : 0;
    const supersededB = isSuperseded(db, authedId) ? 1 : 0;
    if (supersededA !== supersededB) return supersededA - supersededB;

    // 1. The row carrying their enrolments. This is what "missing details" means.
    const regs = registrationWeight(db) - registrationWeight(da);
    if (regs !== 0) return regs;

    // 2. A completed profile over a stub.
    const complete = (asRecord(db).profileComplete === true ? 1 : 0)
        - (asRecord(da).profileComplete === true ? 1 : 0);
    if (complete !== 0) return complete;

    // 3. More roles means more of the platform was granted to this row.
    const roles = (Array.isArray(asRecord(db).roles) ? asRecord(db).roles.length : 0)
        - (Array.isArray(asRecord(da).roles) ? asRecord(da).roles.length : 0);
    if (roles !== 0) return roles;

    // 4. The ORIGINAL account, not a later duplicate. Rows with no readable date
    //    sort after rows that have one rather than being treated as ancient.
    const ta = createdAtMs(da);
    const tb = createdAtMs(db);
    if (ta !== tb) {
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
    }

    // 5. The tiebreak that makes this a total order. Any stable rule would do;
    //    what matters is that it never depends on row order.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Which profile belongs to the account that just authenticated.
 *
 * The three identity links come first and are unchanged — they are facts, not
 * inference. Only when none of them matches does evidence decide, and that path
 * is reported as `ambiguous` so the caller can say so.
 */
export function chooseProfileForAuthAccount(
    candidates: ProfileCandidate[],
    authedId: string,
): ProfileChoice {
    if (candidates.length === 0) {
        return { chosen: null, reason: 'none', ambiguous: false, candidates: 0 };
    }

    const byId = candidates.find((d) => d.id === authedId);
    if (byId) return { chosen: byId, reason: 'document-id', ambiguous: false, candidates: candidates.length };

    const byMigrated = candidates.find((d) => asRecord(d.data())._migratedTo === authedId);
    if (byMigrated) return { chosen: byMigrated, reason: 'migrated-pointer', ambiguous: false, candidates: candidates.length };

    const byAuthId = candidates.find((d) => asRecord(d.data()).supabaseAuthId === authedId);
    if (byAuthId) return { chosen: byAuthId, reason: 'supabase-auth-id', ambiguous: false, candidates: candidates.length };

    const best = [...candidates].sort((x, y) => betterFirst(x, y, authedId))[0];
    return { chosen: best, reason: 'best-evidence', ambiguous: true, candidates: candidates.length };
}
