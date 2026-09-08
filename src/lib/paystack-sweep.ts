import { logger } from "@/lib/logger";
import { paystackBaseUrl } from "@/lib/paystack-host";

/**
 * Reading every successful Paystack transaction, in one place.
 *
 *   #519 THIS HELPER LIVED INSIDE analytics.service.ts, AND A FOURTH COPY OF
 *   THE BUG IT EXISTS TO FIX WAS SITTING IN A ROUTE.
 *
 *   It was written because the same paging bug appeared three times in that one
 *   file, and its own note says why that matters: "fixing one copy and leaving
 *   its siblings is how this class keeps surviving in this codebase". It was
 *   then left module-private, so the only sweeps it could reach were the three
 *   in the file it happened to be declared in.
 *
 *   api/admin/finance/reconcile had its own loop, ending on
 *   `json.meta?.pageCount ?? 1`. A helper that cannot be imported is not a
 *   shared rule — it is a fourth copy waiting to be written. It lives here now,
 *   and the ratchet that guarded one file sweeps the tree.
 */
/**
 * How many pages of Paystack transactions any one revenue sweep will read.
 * 100 pages x 100 per page = 10,000 transactions.
 */
export const MAX_REVENUE_PAGES = 100;

/**
 * Read every successful Paystack transaction, handing each one to `onTransaction`.
 *
 * This exists because the same paging bug was written three times in this file.
 * Each site decided when to stop with
 *
 *     const totalPages = json.meta?.pageCount ?? 1;
 *
 * which cannot tell "the API sent no page count" apart from "there is one page".
 * When Paystack omits the field, every one of those loops stopped after page 1
 * and reported the hundred most recent transactions as the platform's lifetime
 * revenue — silently, with nothing marking the figure as partial.
 *
 * The end-of-data signal used here is a SHORT PAGE, which is a fact about the
 * response rather than about its metadata. `pageCount` is still used when it is
 * actually present, because paging to the ceiling on every call would be slow,
 * but it can no longer end the sweep by being absent.
 *
 * `truncated` is returned rather than logged-and-forgotten so callers can label
 * the number instead of presenting a floor as a total.
 */
export async function eachPaystackTransaction(
    secretKey: string,
    opts: {
        dateFrom?: Date;
        dateTo?: Date;
        maxPages?: number;
        timeoutMs?: number;
        label: string;
        /**
         * Which Paystack status bucket to read. Defaults to "success".
         *
         *   #519. paystack-sync sweeps success, failed AND abandoned, and had
         *   its own loop because this helper only knew one bucket. A helper that
         *   does not fit the caller is how the caller keeps its copy.
         */
        status?: "success" | "failed" | "abandoned";
        /**
         * Set when the cap is a deliberate product limit rather than a safety
         * ceiling, so hitting it is expected and should not log an error every
         * call. `truncated` is still returned either way — the caller is
         * expected to label the figure.
         */
        capIsIntentional?: boolean;
    },
    onTransaction: (tx: any) => void,
): Promise<{ pagesRead: number; truncated: boolean }> {
    const maxPages = opts.maxPages ?? MAX_REVENUE_PAGES;
    const timeoutMs = opts.timeoutMs ?? 6000;
    const PER_PAGE = 100;

    let page = 1;
    let truncated = false;

    while (page <= maxPages) {
        let url = `${paystackBaseUrl()}/transaction?perPage=${PER_PAGE}&page=${page}&status=${opts.status ?? "success"}`;
        if (opts.dateFrom) url += `&from=${encodeURIComponent(opts.dateFrom.toISOString())}`;
        if (opts.dateTo) url += `&to=${encodeURIComponent(opts.dateTo.toISOString())}`;

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`Paystack API returned status ${res.status}`);

        const json = await res.json();
        const data = json.data ?? [];
        for (const tx of data) onTransaction(tx);

        // A short page is the end of the data, whatever the metadata says.
        if (data.length < PER_PAGE) return { pagesRead: page, truncated: false };

        // Honoured when present; unable to end the sweep by being absent.
        const reportedPages = Number(json.meta?.pageCount);
        if (Number.isFinite(reportedPages) && page >= reportedPages) {
            return { pagesRead: page, truncated: false };
        }

        if (page === maxPages) {
            truncated = true;
            if (!opts.capIsIntentional) {
                logger.error(
                    `[${opts.label}] Paystack paging hit the ${maxPages}-page ceiling. ` +
                    `The revenue total is INCOMPLETE — raise the ceiling or sum from processed_payments.`
                );
            }
        }
        page++;
    }

    return { pagesRead: maxPages, truncated };
}

/** The success-only sweep, which is what most callers want. */
export const eachPaystackSuccess = eachPaystackTransaction;
