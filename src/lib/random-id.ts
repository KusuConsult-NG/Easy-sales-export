/**
 * A random identifier, in any browser this platform actually meets.
 *
 *   #833 `crypto.randomUUID is not a function` TOOK THE HOMEPAGE DOWN.
 *
 *   From the owner's production log, repeatedly, and FATAL:
 *
 *       [ERROR] Next.js Global UI Boundary Caught Exception
 *       {"message":"crypto.randomUUID is not a function",
 *        "path":"/","fatal":true}
 *
 *   and the same on /wave/landing. `fatal: true` is the whole story: this is
 *   not a broken widget, it is the global error boundary catching a throw that
 *   unwound the entire React tree. The visitor got an error page instead of the
 *   site.
 *
 * ── WHY EVERY VISITOR, AND WHY THE HOMEPAGE ─────────────────────────────────
 *
 *   AiChatWidget is rendered by ClientLayout, which wraps every page. Its mount
 *   effect called `initSession()` UNCONDITIONALLY — not when the chat was
 *   opened, but on every mount of every page:
 *
 *       useEffect(() => {
 *           initSession();            // ← crypto.randomUUID()
 *           if (isOpen && …) { … }
 *       }, [isOpen, …]);
 *
 *   So a browser without `crypto.randomUUID` could not render any page of this
 *   platform at all.
 *
 * ── WHICH BROWSERS, AND WHY IT MATTERS HERE PARTICULARLY ────────────────────
 *
 *   `crypto.randomUUID` is recent: Chrome 92 and Safari 15.4, both 2021-22. It
 *   is also absent from any NON-SECURE context, though that is not this — the
 *   log shows https.
 *
 *   So the affected visitors are the ones on older phones and older Android
 *   WebViews. On a Nigerian agricultural platform whose applicants reach it
 *   from budget handsets, that is not a rounding error; it is a share of the
 *   people the programme exists for, and every one of them saw a dead site.
 *
 * ── THE FALLBACK IS NOT A WEAKER RANDOM ─────────────────────────────────────
 *
 *   `crypto.getRandomValues` is in every browser that can run this application
 *   — it predates randomUUID by roughly a decade. So the fallback below is the
 *   SAME cryptographic source, assembled into a v4 UUID by hand, and it is what
 *   nearly every affected visitor will use.
 *
 *   THERE IS NO Math.random() PATH, deliberately. Two of the four callers mint
 *   IDEMPOTENCY KEYS for money — a withdrawal and an export booking — and an
 *   idempotency key from a predictable or colliding source is worse than no key
 *   at all: it is a duplicate-payment guard that quietly stops guarding. If
 *   neither crypto source exists this throws, and the callers decide what that
 *   means for them. A chat widget degrades; a payment does not proceed.
 */

/**
 * Bytes 6 and 8 carry the version and variant a v4 UUID must declare.
 *
 * Without them the string is still random and still unique, and is not a valid
 * UUID — which matters because these values cross into `api/ai` and the
 * withdrawal and booking actions, where a stored id is compared and logged.
 */
function uuidV4FromBytes(bytes: Uint8Array): string {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variant 10xx

    const hex: string[] = [];
    for (let i = 0; i < 16; i += 1) hex.push(bytes[i].toString(16).padStart(2, "0"));

    return (
        hex.slice(0, 4).join("") + "-"
        + hex.slice(4, 6).join("") + "-"
        + hex.slice(6, 8).join("") + "-"
        + hex.slice(8, 10).join("") + "-"
        + hex.slice(10, 16).join("")
    );
}

/** Thrown when neither crypto source exists — see the header for why. */
export class NoSecureRandomError extends Error {
    constructor() {
        super(
            "This browser provides no cryptographic random source "
            + "(neither crypto.randomUUID nor crypto.getRandomValues).",
        );
        this.name = "NoSecureRandomError";
    }
}

/**
 * A v4 UUID, from the best source this browser has.
 *
 * Reads `globalThis.crypto` at CALL TIME rather than destructuring at module
 * load: a module-level capture runs during SSR, where the answer can differ
 * from the browser's, and a capability decided on the server is the wrong
 * answer for the client that receives it.
 */
export function randomId(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;

    if (typeof c?.randomUUID === "function") {
        return c.randomUUID();
    }

    if (typeof c?.getRandomValues === "function") {
        return uuidV4FromBytes(c.getRandomValues(new Uint8Array(16)));
    }

    throw new NoSecureRandomError();
}

/**
 * The same, for a caller that must never throw.
 *
 * Returns null instead, so a decorative feature can turn itself off rather than
 * take the page with it. The chat widget uses this; the two money paths use
 * `randomId` and are entitled to fail loudly.
 */
export function randomIdOrNull(): string | null {
    try {
        return randomId();
    } catch {
        return null;
    }
}
