/**
 * How many round trips DEEP an action is, as opposed to how many it makes.
 *
 *   THE OWNER, about six different screens across a day: "the app is slow."
 *
 *   Every measurement in this audit until now counted READS. Seven reads
 *   issued one after another cost seven round trips; seven issued together
 *   cost one. A read count cannot tell those apart, which is how
 *   `checkCooperativeStatusAction` could go from fourteen reads to seven
 *   across two merged PRs and still take two seconds.
 *
 *       READ COUNT IS NOT WHAT LATENCY IS MADE OF.
 *
 * ── WHY GENERATIONS AND NOT "WAVES" ─────────────────────────────────────────
 *
 *   The first version of this counted a new wave whenever a read started with
 *   none already in flight. That is easy to reason about and IT CAN BE
 *   FLATTERED: two chains overlapping means the in-flight count never reaches
 *   zero, so a five-deep action can report two. It did, on the Academy check,
 *   and the number was wrong in the direction that makes the work look better
 *   than it is — which is the one direction a measurement must never be wrong
 *   in.
 *
 *   A GENERATION CANNOT BE FLATTERED. Each read is one deeper than the deepest
 *   read that had already FINISHED when it started, so reads issued together
 *   share a generation however long they overlap, and a read that waited for an
 *   answer is strictly deeper than the answer it waited for. The result is the
 *   length of the longest chain: the number of round trips the person actually
 *   waits through.
 *
 * ── HOW TO USE IT ───────────────────────────────────────────────────────────
 *
 *       const seen = measureReadDepth();
 *       await checkAcademyStatusAction();
 *       expect(seen.depth).toBeLessThanOrEqual(3);
 *
 *   Call it AFTER installFakeDb, because it wraps whatever implementation is
 *   installed at that moment. Every suite using it should also assert a
 *   CONTROL — that a known chain measures deep and a known batch measures
 *   shallow — or a broken harness reads as a fast action.
 */

export interface ReadDepthProbe {
    /** Reads issued while the probe was installed. */
    reads: number;
    /** The longest chain of reads that waited on each other. */
    depth: number;
}

/**
 * Wrap the installed fake-db read so every read takes a real tick, and record
 * the depth of the chain.
 *
 * `delayMs` only has to be long enough that a dependent read starts in a later
 * turn than the one it waited for; 5ms is ample and keeps a suite fast.
 */
export function measureReadDepth(delayMs = 5): ReadDepthProbe {
    const g = global as any;
    const inner = g.mockFirestoreGet.getMockImplementation();
    if (typeof inner !== 'function') {
        throw new Error('measureReadDepth: call installFakeDb() first — there is no read to wrap.');
    }

    /** The deepest generation that has COMPLETED. */
    let deepestDone = 0;
    const probe: ReadDepthProbe = { reads: 0, depth: 0 };

    g.mockFirestoreGet.mockImplementation((...args: any[]) => {
        //   Everything finished so far had to happen before this read could be
        //   issued, so this read sits one generation below the deepest of them.
        const generation = deepestDone + 1;
        probe.reads += 1;
        if (generation > probe.depth) probe.depth = generation;

        const result = inner(...args);
        return new Promise((resolve) => setTimeout(() => {
            if (generation > deepestDone) deepestDone = generation;
            resolve(result);
        }, delayMs));
    });

    return probe;
}
