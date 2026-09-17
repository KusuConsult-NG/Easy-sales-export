/**
 * Recovering from a page left behind by a deployment — once, not forever.
 *
 *   #717 NINE ERROR BOUNDARIES RELOADED THE PAGE AUTOMATICALLY AND NOTHING
 *   COUNTED THE RELOADS.
 *
 *   Every one of them held its own copy of the same predicate and the same two
 *   lines:
 *
 *       if (isStaleDeploymentError(error)) {
 *           console.warn("Stale deployment detected — auto-reloading.");
 *           window.location.reload();
 *           return;
 *       }
 *
 *   app/error, app/global-error, admin, marketplace, export, farm-nation,
 *   wave/application, cooperatives/onboarding, and components/ErrorBoundary.
 *   Eight copies of the predicate were byte-identical; the ninth differed by
 *   four characters.
 *
 *   THE RECOVERY IS RIGHT AND IT DOES NOT TERMINATE. A reload fixes this only
 *   if the reload fetches a NEWER page than the one that failed. When it does
 *   not — an edge or browser cache still serving the old HTML shell, a rolling
 *   deploy where some instances answer with the previous build, a back/forward
 *   restore — the fresh page references the same missing chunk, throws the same
 *   error, hits the same boundary and reloads again. Nothing anywhere breaks
 *   that cycle: there is no counter, no timestamp and no upper bound.
 *
 *   What that costs is a tab that cannot be read or used, spinning "Updating to
 *   latest version…" and re-requesting the page as fast as it can load, for as
 *   long as it is open. It is worst during a deployment, which is exactly when
 *   the condition that starts it is most likely.
 *
 *   AND IT IS NOT ONLY THE SERVER-ACTION CASE. That one needs a click to fire,
 *   so it cannot loop by itself. `ChunkLoadError` and "Failed to fetch
 *   dynamically imported module" fire during RENDER, with no user involved —
 *   those are the ones that spin.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 *   Two automatic reloads per page, per incident. The third time the same page
 *   fails this way, the boundary stops and shows its ordinary error UI, which
 *   already carries "Try again" and a way out. A person looking at a message is
 *   strictly better off than a person looking at a tab that will not settle.
 *
 *   An incident expires. A stale-bundle error an hour after the last one is a
 *   new deployment, not a loop, so the count resets after RESET_AFTER_MS and
 *   the next visitor to that page gets the full budget again.
 *
 *   The budget is keyed by PATH. Two different pages failing is two incidents;
 *   one page failing three times is a loop.
 *
 * ── WHEN THERE IS NOWHERE TO KEEP THE COUNT ─────────────────────────────────
 *
 *   sessionStorage throws in a private window with site data blocked, and can
 *   be absent entirely. Without it there is no way to count, and the choice is
 *   between an unbounded automatic reload and none.
 *
 *   IT TAKES NONE. An automatic reload that cannot be bounded is the failure
 *   this module exists to remove, and the fallback — the boundary's own error
 *   screen with a working "Try again" — still recovers the person in one click.
 *   Refusing to start a loop it cannot stop is the safe direction.
 */

/** Automatic reloads allowed for one page before the boundary gives up. */
export const RELOAD_BUDGET = 2;

/** After this long with no failure, the next one starts a fresh incident. */
export const RESET_AFTER_MS = 60_000;

const STORAGE_KEY = "esx:stale-deployment-reloads";

/**
 * Whether this error is a page left behind by a deployment.
 *
 * THE ONE COPY. Nine files carried this; eight identical and one not, which is
 * how the two spellings would have drifted further. The list is unchanged from
 * the copies it replaces — this finding is about the reload, not the
 * predicate — except that it no longer insists on an `Error`: a boundary can
 * be handed a string or a plain object, and a predicate that throws while
 * deciding how to recover from an error is its own outage.
 */
export function isStaleDeploymentError(error: unknown): boolean {
    const e = (error ?? {}) as { message?: unknown; name?: unknown };
    const msg = typeof e.message === "string" ? e.message : "";
    const name = typeof e.name === "string" ? e.name : "";

    return (
        name === "ChunkLoadError" ||
        name === "UnrecognizedActionError" ||
        msg.includes("ChunkLoadError") ||
        msg.includes("Loading chunk") ||
        msg.includes("was not found on the server") ||
        msg.includes("UnrecognizedAction") ||
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        msg.includes("Failed to find Server Action") ||
        msg.includes("older or newer deployment")
    );
}

interface ReloadRecord {
    /** Reloads already spent on this path in this incident. */
    n: number;
    /** When the last one was started, so a stale incident can expire. */
    at: number;
    /** Which page. A different one is a different incident. */
    path: string;
}

/** sessionStorage, or null when it cannot be used — never throws. */
function storage(): Storage | null {
    try {
        if (typeof window === "undefined" || !window.sessionStorage) return null;
        //   Presence is not usability: Safari's private mode has historically
        //   exposed the object and thrown on write. Probe it.
        const probe = "esx:probe";
        window.sessionStorage.setItem(probe, "1");
        window.sessionStorage.removeItem(probe);
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function currentPath(): string {
    try {
        return typeof window === "undefined" ? "" : window.location.pathname;
    } catch {
        return "";
    }
}

function read(store: Storage, path: string, now: number): ReloadRecord {
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return { n: 0, at: now, path };
        const parsed = JSON.parse(raw) as Partial<ReloadRecord>;

        //   A different page, or long enough ago, is a new incident. Both
        //   checks are what stop one bad deployment from spending the budget
        //   of every page a person visits afterwards.
        if (parsed.path !== path) return { n: 0, at: now, path };
        if (typeof parsed.at !== "number" || now - parsed.at > RESET_AFTER_MS) {
            return { n: 0, at: now, path };
        }

        return { n: typeof parsed.n === "number" ? parsed.n : 0, at: parsed.at, path };
    } catch {
        //   Unreadable or corrupt. Treating it as "no reloads yet" would hand
        //   out the budget again on every pass, which is the loop. Treat it as
        //   spent.
        return { n: RELOAD_BUDGET, at: now, path };
    }
}

/**
 * Whether an automatic reload is still allowed for this page. Reads only.
 *
 * Split from `consumeReloadBudget` so a boundary can decide what to RENDER
 * without spending anything — the alternative is showing the ordinary error UI
 * for a frame before the reload starts, which looks like a fault.
 */
export function canAutoReload(now: number = Date.now()): boolean {
    const store = storage();
    if (!store) return false;
    return read(store, currentPath(), now).n < RELOAD_BUDGET;
}

/**
 * Spend one reload from this page's budget.
 *
 * `true` means the caller should reload. `false` means the budget is gone and
 * the boundary must show its error UI instead — which is the whole point.
 */
export function consumeReloadBudget(now: number = Date.now()): boolean {
    const store = storage();
    if (!store) return false;

    const path = currentPath();
    const record = read(store, path, now);
    if (record.n >= RELOAD_BUDGET) return false;

    try {
        store.setItem(STORAGE_KEY, JSON.stringify({ n: record.n + 1, at: now, path }));
    } catch {
        //   Could not record the attempt, so the next pass would see the same
        //   count and reload again — a loop with extra steps.
        return false;
    }

    return true;
}

/** Forget this page's reloads. For a caller that knows the page came up clean. */
export function clearReloadBudget(): void {
    try {
        storage()?.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to do, and nothing worth failing a render over.
    }
}

/**
 * What to tell somebody whose SUBMIT failed because the deployment moved.
 *
 *   #855 A REACT ERROR BOUNDARY NEVER SEES THIS ONE.
 *
 *   #852 put the bounded recovery on all nineteen error boundaries, and not one
 *   of them can help here: React boundaries catch errors thrown during RENDER.
 *   A rejected promise inside an async event handler — which is every "Submit"
 *   button in this application — is caught by the handler's own `catch` and
 *   never reaches a boundary at all.
 *
 *   So on the path where it costs the most, a stale action id produced:
 *
 *       showToast("An error occurred. Please try again.", "error")
 *
 *   — advice that CANNOT WORK. Trying again posts the same dead action id from
 *   the same loaded page and fails identically, for as long as she keeps
 *   trying. The owner met it on Farm Nation onboarding, as a buyer, and the
 *   server action accepts that exact payload: executed in
 *   farm-nation-onboarding-behaviour, it returns success, grants `investor` and
 *   writes the application. The submission was never the problem.
 *
 *   IT SAYS RELOAD RATHER THAN RELOADING. The render-path hook reloads by
 *   itself because nothing is being typed into a screen that has already
 *   failed. A submit handler is the opposite: she has just filled in a
 *   multi-step form, and some of these wizards keep a draft while others do
 *   not. Reloading on her behalf would rescue the ones that do and silently
 *   discard the rest, so the person is told what happened and left holding the
 *   decision.
 */
export const STALE_SUBMIT_ADVICE =
    "The app was updated while you were filling this in. Please refresh the page "
    + "and submit again — refreshing is what fixes it, trying again will not.";

/**
 * The message for a failed submit: the specific one when the deployment moved,
 * and the caller's own wording for everything else.
 *
 * Returns `null` when this is NOT a stale-deployment failure, so a caller keeps
 * whatever it already said rather than having a generic sentence imposed on it.
 */
export function staleSubmitAdvice(error: unknown): string | null {
    return isStaleDeploymentError(error) ? STALE_SUBMIT_ADVICE : null;
}
