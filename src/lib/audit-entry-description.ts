/**
 * A sentence for an audit log row that was written without one.
 *
 *   #764 SIXTY-ONE PER CENT OF AUDIT ROWS HAD NO TEXT, SO THE SCREEN SHOWED
 *        THE JSON.
 *
 *   The owner, reading /admin/audit-logs: "a lot of the logs shows metadata
 *   instead not the text to be displayed there why?"
 *
 *   Because there is no text. The row renderer is honest about it —
 *
 *       {log.details && (<div>Details: {log.details}</div>)}
 *       {log.metadata && ... <pre>{JSON.stringify(log.metadata, null, 2)}</pre>}
 *
 *   — and `details` is optional on AuditLogEntry. Counted across every
 *   recordAdminAction and createAdminAuditLog call in the repository:
 *
 *       with a details sentence        40
 *       METADATA AND NO SENTENCE      112
 *       neither                        31
 *
 *   So for 112 call sites the expanded row is a blob of JSON and nothing else,
 *   and the admin is left to read `{"total":5517,"errors":5,...}` and work out
 *   what happened. That is what the owner is looking at.
 *
 * ── WHY THIS IS A READER AND NOT 112 EDITS ──────────────────────────────────
 *
 *   Writing a sentence at each of the 112 sites would fix today's rows and
 *   nothing else: the 113th call site is one person forgetting an optional
 *   field, and the field has been optional since it was introduced. This audit
 *   has settled the shape of that repair more than once — #501 put it plainly,
 *   "THE FIELD, NOT THE CHECK, IS THE UNIT... A schema fragment cannot be
 *   forgotten in the same way, because the field cannot be declared without
 *   it." The same reasoning one level up: a row can always be described from
 *   what it already carries, so describing it is the reader's job.
 *
 *   `details` still wins wherever a writer supplied one. A hand-written
 *   sentence knows things this cannot — which is exactly why it is not
 *   replaced.
 *
 * ── IT NEVER INVENTS ────────────────────────────────────────────────────────
 *
 *   Every word comes from a field that is present. An unrecognised action
 *   yields its own humanised name and whatever facts the metadata holds; an
 *   empty row yields the action alone. There is no branch that guesses at
 *   intent, because a plausible-sounding audit entry that nobody wrote is
 *   worse than a JSON blob.
 *
 *   AND IT REVEALS NOTHING NEW. #468 established that this metadata is already
 *   rendered as raw JSON on a screen every one of the ten admin roles can open.
 *   This summarises what is on that screen already; it deliberately leaves
 *   names and email addresses out of the summary line, because the summary's
 *   job is "what happened" and the detail is one click away either way.
 */

/** The fields this reads. A subset of AuditLogEntry, so any row satisfies it. */
export interface DescribableAuditEntry {
    action?: string;
    targetType?: string;
    targetId?: string;
    details?: string;
    metadata?: Record<string, unknown> | null;
}

/**
 * "academy_approve" → "Academy Approve". The Action column's own formatting.
 *
 *   NOT `humaniseAction`. orphaned-actions-are-triaged.test.ts sweeps every
 *   exported name in src matching `\w*Action` and requires each to have a
 *   caller outside its own file — it matches on the SUFFIX, not on being a
 *   server action, so a string helper called `humaniseAction` is reported as an
 *   untriaged orphan. It was, on the first run of this finding's gate.
 *
 *   Renamed rather than added to that file's triage list: this is a false
 *   positive and adding it would have taught a ratchet to expect them. The name
 *   is also the more accurate one — it humanises the action's NAME.
 */
export function humaniseActionName(action: string | undefined): string {
    if (!action) return "Unknown action";
    return action
        .replace(/[:.]/g, "_")
        .split("_")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/**
 * Metadata keys worth putting in a sentence, in the order they read best.
 *
 * An ALLOW-LIST rather than "everything except", for two reasons. A row can
 * carry anything — the whole point of an open metadata bag — so a deny-list
 * would have to be updated by whoever adds a key, which is the failure this
 * module exists to stop. And it keeps names and email addresses out of the
 * summary without having to enumerate every spelling of them.
 */
const FACT_KEYS = [
    /*
     *   #770 `action` WAS MISSING, AND IT WAS THE WHOLE OF SOME ROWS.
     *
     *   The owner photographed a WAVE row whose entire metadata is
     *
     *       { "action": "application_resubmitted" }
     *
     *   and this list did not contain `action`, so the summary would have read
     *   "User Update on wave application WAVE-1789416719051-W0JBEH0H7" and
     *   dropped the one fact the row carries — the thing that distinguishes it
     *   from every other User Update in the log.
     *
     *   MEASURED, NOT GUESSED. The keys below were counted across all 189
     *   recordAdminAction / createAdminAuditLog / createAuditLog calls in the
     *   repository; the ones added here are the descriptive keys that occur and
     *   were absent — action (5), notes (6), title (4), purpose (3), approved
     *   (3), previousRoles (3), tier (2), phase (2), certificateNumber (2),
     *   location (2).
     *
     *   Identifier keys that also occur — userId, applicantId, sellerUserId,
     *   buyerId, memberId, escrowId — are deliberately NOT added: the row
     *   already prints its Target ID, and a sentence made of opaque ids reads
     *   like the JSON blob this function exists to replace.
     */
    "action", "decision", "outcome", "approved", "status", "newStatus", "previousStatus",
    "from", "to", "phase",
    "reason", "rejectionReason", "note", "notes",
    "amount", "totalPrice", "price", "fee", "quantity",
    "role", "roles", "previousRoles", "module", "plan", "tier", "type",
    "title", "purpose", "location",
    "reference", "orderId", "applicationId", "propertyId", "courseId", "certificateNumber",
    "total", "synced", "skipped", "errors", "unhandled", "count", "sent", "failed",
    "truncated",
] as const;

/** Keys whose numbers are money, and should read as money. */
const MONEY_KEYS = new Set(["amount", "totalPrice", "price", "fee"]);

/** Longest a single quoted value may be before it is cut. */
const VALUE_MAX = 80;

function renderValue(key: string, value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;

    if (typeof value === "boolean") return value ? "yes" : "no";

    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return MONEY_KEYS.has(key)
            ? `₦${value.toLocaleString("en-NG")}`
            : value.toLocaleString("en-NG");
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed.length > VALUE_MAX ? `${trimmed.slice(0, VALUE_MAX)}…` : trimmed;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        //   Short lists of simple values read better spelled out than counted.
        const simple = value.every((v) => typeof v === "string" || typeof v === "number");
        if (simple && value.length <= 3) return value.join(", ");
        return `${value.length} item${value.length === 1 ? "" : "s"}`;
    }

    //   A nested object in a sentence is a JSON blob again. The raw view has it.
    return null;
}

/** "newStatus" → "new status". */
function humaniseKey(key: string): string {
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .toLowerCase();
}

/** The short form of an id, so a sentence is not mostly identifier. */
function shortId(id: string): string {
    return id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

/**
 * One line describing what this row records.
 *
 * Returns the writer's own `details` when there is one. Otherwise composes a
 * sentence from the action, the target and the metadata facts it recognises —
 * and, failing all of those, the action's name, which every row has.
 */
export function describeAuditEntry(entry: DescribableAuditEntry): string {
    const written = typeof entry.details === "string" ? entry.details.trim() : "";
    if (written) return written;

    const head = humaniseActionName(entry.action);

    const target = entry.targetType
        ? ` on ${humaniseKey(entry.targetType)}${entry.targetId ? ` ${shortId(entry.targetId)}` : ""}`
        : entry.targetId
            ? ` on ${shortId(entry.targetId)}`
            : "";

    const meta = entry.metadata ?? {};
    const facts: string[] = [];
    for (const key of FACT_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
        const rendered = renderValue(key, (meta as Record<string, unknown>)[key]);
        if (rendered !== null) facts.push(`${humaniseKey(key)} ${rendered}`);
    }

    if (facts.length === 0) return `${head}${target}`;
    return `${head}${target} — ${facts.join(", ")}`;
}

/**
 * True when this row carried a sentence of its own.
 *
 * The screen says which it is showing. A derived summary is a fair description
 * and not a record of what somebody wrote, and an audit log is the one place
 * that distinction has to be visible.
 */
export function hasWrittenDetails(entry: DescribableAuditEntry): boolean {
    return typeof entry.details === "string" && entry.details.trim().length > 0;
}
