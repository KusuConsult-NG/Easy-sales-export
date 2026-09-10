import "server-only";

import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * The public export catalogue, read once and defined once.
 *
 *   #578 /export/buyer WAS A CLIENT PAGE WHOSE FIRST ACT WAS TO FETCH THIS
 *   APPLICATION'S OWN ROUTE — and it rendered nothing at all until the round
 *   trip finished:
 *
 *       if (catalogLoading) return <Loader2 className="animate-spin" />;
 *
 *   So an international buyer on a slow connection got a spinner on a blank
 *   page while the server that had just rendered it was asked, over HTTP, for
 *   a list it could have sent in the HTML. Same shape as #562's land and
 *   certificate screens.
 *
 * ── WHY A SHARED READER, AGAIN ──────────────────────────────────────────────
 *
 *   Because the handler carries a finding, and a copy of the query in a server
 *   page would be a second place for that finding to be true or false:
 *
 *     THE FIELD LIST IS AN ALLOW-LIST, NOT A SPREAD. The route returned
 *     `{ id, ...doc.data() }` — the whole stored document. Every listing
 *     carries `userId`, the internal id of the seller who submitted it, so the
 *     public catalogue published one per product; and submitExportProductAction
 *     stores its input wholesale ("productData arrives as `any` and is stored
 *     wholesale — no schema, no checks"), so any field a seller chose to
 *     include went public the moment an admin set isActive.
 *
 *     An allow-list rather than a deny-list: a field added to the document
 *     later is private by default, which is the way round that survives
 *     somebody else's change.
 *
 *   These are exactly the fields ExportProduct declares and the buyer page
 *   reads. One definition, two callers.
 *
 * ── IT IS PUBLIC, AND THAT IS DELIBERATE ────────────────────────────────────
 *
 *   No session is resolved here and none should be: this is the shop window,
 *   and `isActive` is the only gate. Every row it returns has already been
 *   approved by an admin.
 */

/**
 * A catalogue row as the shop window may see it.
 *
 *   #581 AND IT IS A SHAPE NOW, NOT A SUBSET OF WHATEVER WAS STORED.
 *
 *   The allow-list copied a field only `if (data[field] !== undefined)`, so a
 *   row that had never been given `grades` or `certifications` was published
 *   without them — and /export/buyer renders
 *
 *       useState(product.grades[0])              // ProductCard, on mount
 *       product.certifications.map(...)
 *       product.pricePerMT.toLocaleString()
 *
 *   which is a TypeError on the first such row and takes THE WHOLE CATALOGUE
 *   down with it, not just the card.
 *
 *   THE SAME FILE ALREADY KNEW. Its search filter reads
 *   `...(product.certifications || [])` and `...(product.grades || [])` — the
 *   author guarded the arrays where they are filtered and dereferenced them
 *   where they are drawn. That is the proof this is not hypothetical.
 *
 *   #442 LOOKED AT `product.grades[0]` AND RECORDED IT AS SAFE, "because
 *   `grades` comes from a hardcoded array literal in that file, not from a
 *   document". That was already untrue when it was written: the page had been
 *   fetching this catalogue since before #442, and the hardcoded list is only
 *   its fallback. The verdict has been corrected in that suite.
 *
 *   So the boundary states the shape once. A row missing a field gets the
 *   EMPTY version of it — never an invented one: no default grade, no default
 *   certification, and a price of 0, which the card shows as "Price on
 *   request" and the checkout has always refused as "not priced for sale".
 */
export interface PublicExportProduct {
    id: string;
    name: string;
    icon: string;
    origin: string;
    season: string;
    category: string;
    grades: string[];
    certifications: string[];
    pricePerMT: number;
    minOrderMT: number;
}

/** Only strings, and only ones with something in them. */
function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function positiveNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function readPublicExportCatalog(): Promise<PublicExportProduct[]> {
    const db = getAdminDb();
    const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
        .where("isActive", "==", true)
        .get();

    return snapshot.docs.map((doc: any) => {
        const data = doc.data() ?? {};
        return {
            id: doc.id,
            name: typeof data.name === "string" ? data.name : "",
            icon: typeof data.icon === "string" ? data.icon : "📦",
            origin: typeof data.origin === "string" ? data.origin : "",
            season: typeof data.season === "string" ? data.season : "",
            category: typeof data.category === "string" ? data.category : "other",
            grades: stringList(data.grades),
            certifications: stringList(data.certifications),
            pricePerMT: positiveNumber(data.pricePerMT),
            minOrderMT: positiveNumber(data.minOrderMT),
        };
    });
}
