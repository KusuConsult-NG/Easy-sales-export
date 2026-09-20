/**
 * Run an async function over a list, several at a time, in order.
 *
 *   #805 A SCAN THAT AWAITED ITSELF 1,600 TIMES.
 *
 *   `_listFarmNationApprovalCasesAction` read 200 farmers and then did this:
 *
 *       for (const doc of farmers.docs) {
 *           const c = await buildCase(doc as any);
 *       }
 *
 *   `buildCase` calls findFarmNationApplications, which walks five keys in
 *   order. Counting the round trips on the path where NO application is found:
 *
 *       ownedProfileIdsFor → resolveActiveUserId      1, +1 per migration hop
 *       ownedProfileIdsFor → resolveOwnedUserIds      2 — its own comment says
 *                                                     "TWO QUERIES PER LEVEL,
 *                                                     one per pointer field"
 *       1. filterByOwner(applications, "userId", …)   1
 *       2. doc(applicationId).get()                   1
 *       3. doc(`legacy_<uid>`).get()                  1
 *       4. where("userEmail", "==", …)                1, +2 per row returned
 *                                                     (claimableBy → isSamePerson
 *                                                     resolves BOTH ids)
 *       5. where("profile.email", "==", …)            1, same again
 *
 *   Eight before any email row comes back, times two hundred, one after
 *   another. At 20ms a round trip that is 32 seconds; at 50ms, eighty.
 *
 *   AND THE PRODUCTION DATA TAKES THE LONGEST PATH. The screen reported
 *   0 + 1 + 177 = 178 cases out of a 200-farmer scan, and the 177 are the
 *   "no application" ones — the outcome that runs all five steps. The common
 *   case there is the expensive case, which is why the screen rendered earlier
 *   in the day and returned "Could not read the Farm Nation approvals" later:
 *   it sits on the edge of the function timeout and latency decides it.
 *
 * ── WHY A WORKER POOL AND NOT THE CHUNKING NEXT DOOR ────────────────────────
 *
 *   broadcast-logic batches ids thirty at a time and hands the batch to
 *   `db.getAll(...refs)` — ONE round trip per chunk. That is a different
 *   mechanism for a different shape, and reusing its name here would suggest
 *   these do the same thing.
 *
 *   This runs N INDEPENDENT multi-step lookups at once. Slicing them into
 *   fixed chunks and awaiting `Promise.all` per chunk would leave the whole
 *   batch waiting on its slowest member before starting the next — and the
 *   cost here varies by an order of magnitude between a farmer whose
 *   application is found on key 1 and one who falls through all five. A pool
 *   keeps every worker busy.
 *
 * ── WHAT IT DOES NOT CHANGE ─────────────────────────────────────────────────
 *
 *   The RESULT. Output is indexed by input position, so the array is identical
 *   to the sequential one — not merely sorted the same afterwards.
 *
 *   The FAILURE. A rejection still rejects the whole call, exactly as a throw
 *   inside the old `for` loop aborted the scan. Workers stop claiming new items
 *   once one has failed, so a scan that is going to fail stops reading rather
 *   than finishing its remaining work to throw the result away.
 */

/**
 * `fn` over `items`, at most `limit` in flight, results in input order.
 *
 * `limit` is clamped to at least 1, so a caller that computes it from config
 * cannot accidentally deadlock on 0.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    if (items.length === 0) return out;

    let next = 0;
    let failed = false;

    const worker = async (): Promise<void> => {
        for (;;) {
            if (failed) return;
            const i = next;
            next += 1;
            if (i >= items.length) return;
            try {
                out[i] = await fn(items[i], i);
            } catch (error) {
                //   Recorded before rethrowing so the other workers stop
                //   claiming. Promise.all rejects on the first failure either
                //   way; without this the rest of the list would still be read
                //   for an answer nobody receives.
                failed = true;
                throw error;
            }
        }
    };

    const size = Math.min(Math.max(1, Math.floor(limit)), items.length);
    await Promise.all(Array.from({ length: size }, () => worker()));

    return out;
}
