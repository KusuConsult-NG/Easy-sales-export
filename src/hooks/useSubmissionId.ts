"use client";

import { useCallback, useRef } from "react";
//   #833 NOT `crypto.randomUUID`. That call took the homepage down for every
//   visitor on an older phone, and the sweep in
//   one-line-that-took-the-homepage-down.test.ts caught this hook trying it.
import { randomIdOrNull } from "@/lib/random-id";

/**
 * One id for one submission, stable across retries and fresh after a success.
 *
 *   THE OWNER: "Listing a product was create twice but was only listed once."
 *
 * The server decides what a duplicate is — see lib/product-submission, which
 * turns this id into the product's document id so the collection's primary key
 * does the deduplicating. This hook exists to give that rule something honest
 * to key on, and it has to get three things right:
 *
 *   IT MUST NOT CHANGE ON A RETRY.  A submission refused for a bad price, then
 *                                   corrected and sent again, is the same
 *                                   listing. A new id there would make the
 *                                   duplicate the server is trying to prevent.
 *
 *   IT MUST CHANGE AFTER A SUCCESS. A seller who lists one product and then
 *                                   lists another without leaving the page is
 *                                   making a SECOND listing. Reusing the id
 *                                   would have the server report success and
 *                                   save nothing — the worse of the two
 *                                   failure modes, because the seller is told
 *                                   it worked.
 *
 *   AND IT MUST BE ABSENT RATHER    `randomIdOrNull` returns null when neither
 *   THAN GUESSED.                   crypto source exists. The tempting fix is
 *                                   a Math.random() fallback, and it is wrong
 *                                   here for the same reason lib/random-id
 *                                   refuses one: two colliding ids from ONE
 *                                   seller would have the second listing read
 *                                   as a replay of the first and silently save
 *                                   nothing. Sending no id at all is honest —
 *                                   the server falls back to the clock, which
 *                                   is exactly the behaviour that preceded
 *                                   this rule. That browser loses the
 *                                   deduplication; it does not lose the
 *                                   listing.
 */
export function useSubmissionId(): { current: () => string; reset: () => void } {
    const id = useRef<string | null>(null);

    const current = useCallback(() => {
        //   Minted on first use rather than at mount, so a component rendered
        //   on the server and hydrated on the client cannot disagree about it.
        if (id.current === null) id.current = randomIdOrNull() ?? "";
        return id.current;
    }, []);

    const reset = useCallback(() => { id.current = null; }, []);

    return { current, reset };
}
