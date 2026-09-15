/**
 * Build src/data/polling-units/<state>.json from the published INEC register.
 *
 *   #792 THE POLLING-UNIT FIELD KNEW TWO WARDS OUT OF 8,780.
 *
 *   #774 removed the "PU 001 … PU 010" placeholder and left real names for
 *   Alausa and Garki, saying the rest had to be added one verified ward at a
 *   time. #789 did that for wards. This does it for the level below.
 *
 * ── THE SOURCE ──────────────────────────────────────────────────────────────
 *
 *   github.com/sadiqsalau/inec-ng-data   inecdata.json
 *
 *   37 states, 774 LGAs, 8,809 wards, 176,595 polling units — against INEC's
 *   published 176,846, which is 99.86% of the register. It carries the official
 *   alphanumeric code components too (state / LGA / ward / unit), which is what
 *   a polling unit is actually identified by on a voter's card.
 *
 *   CHECKED THE SAME WAY #789's ward data was: its ward count is 8,809, exactly
 *   INEC's own figure and exactly the count in the independently packaged source
 *   #789 used. Two packagings agreeing on the structure is what makes this the
 *   register rather than somebody's export.
 *
 *   A second candidate — afeibukun/nigerian-state-lgas-wards-polling-units —
 *   was measured and rejected: 118,532 units, a third of the register missing,
 *   and slugified names ("osusu-rd-prim-school-premises-i") that would have to
 *   be un-slugified to be read by a person.
 *
 * ── THE JOIN, AND WHY IT IS NOT A GUESS ─────────────────────────────────────
 *
 *   The platform's ward names come from #789's source; the polling units come
 *   from this one. Joining two independent packagings on free text is exactly
 *   where a wrong answer gets attached to a real-looking record, so the rules
 *   are narrow and each one is a deduction rather than a similarity score:
 *
 *     1. EXACT, on a normalised key.
 *     2. THE ROMAN-NUMERAL RULE. This source transcribes the numeral I as the
 *        DIGIT 1 — "ORON URBAN 11" is Oron Urban II, "1V" is IV — so the key
 *        folds 1 to i. Systematic, not a coincidence: it accounts for most of
 *        Akwa Ibom on its own.
 *     3. THE PARENTHETICAL RULE. Imo's LGAs carry their headquarters town —
 *        "ISIALA MBANO (UMUELEMAI)" — so a trailing parenthetical is dropped.
 *     4. A UNIQUE close match inside the SAME LGA, and only when unique.
 *     5. ONE LEFT ON EACH SIDE. When an LGA has exactly one unmatched ward in
 *        each list, they are the same ward — both lists describe the same LGA
 *        and everything else has been paired off. That is a deduction.
 *
 *   Anything still unmatched gets NO POLLING UNITS, and its applicants keep
 *   typing, which is what all 8,780 of them do today. A ward handed another
 *   ward's polling units would be a real-looking wrong answer on a member's
 *   record, and worse than the placeholder #774 removed.
 *
 * ── WHY THE OUTPUT IS SHARDED, AND NOT A TypeScript MODULE ──────────────────
 *
 *   170,000-odd names is roughly five megabytes. #789's 8,780 wards ship as a
 *   TypeScript module because a form needs all of them to draw a dropdown; this
 *   is twenty times larger and a form needs ONE WARD'S WORTH. Bundling it into
 *   the browser would make every page of the platform slower to load in order
 *   to fix one field, which is not a fix.
 *
 *   So it is JSON, one file per state, read on the server and served a ward at
 *   a time. Nothing in src/app imports it directly.
 *
 *   Run: npx tsx scripts/build-polling-units.ts <path-to-inecdata.json>
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WARDS_BY_STATE_AND_LGA } from "../src/lib/nigeria-wards.generated";

const SOURCE = process.argv[2];
if (!SOURCE) {
    console.error("usage: npx tsx scripts/build-polling-units.ts <inecdata.json>");
    process.exit(1);
}

const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as any[];

const base = (s: string): string =>
    String(s).trim().toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9]/g, "");

/** Rule 2: this source writes the numeral I as the digit 1, and O as 0. */
const wardKey = (s: string): string => base(s).replace(/1/g, "i").replace(/0/g, "o");

/** Rule 3: "ISIALA MBANO (UMUELEMAI)" is the LGA plus its headquarters town. */
const lgaKey = (s: string): string => base(String(s).replace(/\s*\([^)]*\)\s*$/, ""));

const STATE_ALIASES: Record<string, string> = {
    fct: "federalcapitalterritory",
    nasarawa: "nassarawa",
};

/**
 * LGAs this source spells so differently that no rule reaches them. Forty-two,
 * every one an unambiguous variant of the same name — DANBATA for Dambatta,
 * MALUFASHI for Malumfashi, OGBOMOSO for Ogbomosho, "KOGI . K. K." for Kogi
 * (Koton Karfe), "MAIDUGURI M. C." for Maiduguri Metropolitan Council.
 *
 * Each was confirmed by reading the wards it brings, which is the same check
 * #789 used and the only one that matters: the wards are the payload, and they
 * are right even where the label is not. A name that looked close but arrived
 * carrying another LGA's wards is not in this table.
 */
const LGA_ALIASES: Record<string, string> = {
    "Adamawa|Fufure": "FUFORE",
    "Adamawa|Gayuk": "GUYUK",
    "Adamawa|Grie": "GIRE 1",
    "Anambra|Ihiala": "IHALA",
    "Bauchi|Damban": "DAMBAM",
    "Borno|Maiduguri": "MAIDUGURI M. C.",
    "Cross River|Yakuur": "YAKURR",
    "Edo|Uhunmwonde": "UHUNMWODE",
    "Gombe|Yamaltu/Deba": "YALMALTU/ DEBA",
    "Imo|Ezinihitte": "EZINIHITTE MBAISE",
    "Imo|Unuimo": "ONUIMO (OKWE)",
    "Jigawa|Biriniwa": "BIRNIWA",
    "Jigawa|Kiri Kasama": "KIRIKA SAMMA",
    "Kano|Dambatta": "DANBATA",
    "Kano|Dawakin Kudu": "DAWAKI KUDU",
    "Kano|Dawakin Tofa": "DAWAKI TOFA",
    "Kano|Garun Mallam": "GARUN MALAM",
    "Katsina|Malumfashi": "MALUFASHI",
    "Kebbi|Aleiro": "ALIERO",
    "Kebbi|Arewa Dandi": "AREWA",
    "Kogi|Kogi": "KOGI . K. K.",
    "Kogi|Mopa Muro": "MOPA MORO",
    "Kogi|Ogori/Magongo": "OGORI MANGOGO",
    "Kwara|Pategi": "PATIGI",
    "Lagos|Ifako-Ijaiye": "IFAKO-IJAYE",
    "Lagos|Shomolu": "SOMOLU",
    "Niger|Edati": "EDATTI",
    "Niger|Moya": "MUNYA",
    "Ogun|Shagamu": "SAGAMU",
    "Osun|Aiyedaade": "AYEDAADE",
    "Osun|Aiyedire": "AYEDIRE",
    "Osun|Atakunmosa East": "ATAKUMOSA EAST",
    "Osun|Atakunmosa West": "ATAKUMOSA WEST",
    "Oyo|Ogbomosho North": "OGBOMOSO NORTH",
    "Oyo|Ogbomosho South": "OGBOMOSO SOUTH",
    "Oyo|Orelope": "OORELOPE",
    "Plateau|Barkin Ladi": "BARIKIN LADI",
    "Rivers|Opobo/Nkoro": "OPOBO/NEKORO",
    "Sokoto|Sabon Birni": "S/BIRNI",
    "Sokoto|Wamako": "WAMAKKO",
    "Yobe|Karasuwa": "KARASAWA",
    "Zamfara|Chafe": "TSAFE",
};

const tidy = (s: string): string => String(s).replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

/** A name that is only a number is not the name of a place — #789's rule. */
const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|eigth|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const BARE = new RegExp(`^(?:ward|pu|unit)?\\s*(?:\\d+|[ivxlc]+|${NUMBER_WORDS})$`, "i");

//   Index the source: state -> lga -> ward -> units
const byState = new Map<string, Map<string, any>>();
for (const s of raw) {
    const lgas = new Map<string, any>();
    for (const l of s.lgas ?? []) lgas.set(lgaKey(l.name), l);
    byState.set(base(s.name), lgas);
}

type Report = {
    exact: number; roman: number; unique: number; deduced: number;
    unmatchedWards: string[]; unmatchedLgas: string[]; units: number;
};
const report: Report = { exact: 0, roman: 0, unique: 0, deduced: 0, unmatchedWards: [], unmatchedLgas: [], units: 0 };

/** Closeness, only ever used to pick a UNIQUE candidate inside one LGA. */
function closeMatches(needle: string, hay: string[]): string[] {
    const score = (a: string, b: string): number => {
        //   Dice coefficient on bigrams — no dependency, and symmetric.
        if (a === b) return 1;
        if (a.length < 2 || b.length < 2) return 0;
        const grams = new Map<string, number>();
        for (let i = 0; i < a.length - 1; i++) {
            const g = a.slice(i, i + 2);
            grams.set(g, (grams.get(g) ?? 0) + 1);
        }
        let hits = 0;
        for (let i = 0; i < b.length - 1; i++) {
            const g = b.slice(i, i + 2);
            const n = grams.get(g) ?? 0;
            if (n > 0) { grams.set(g, n - 1); hits++; }
        }
        return (2 * hits) / (a.length - 1 + b.length - 1);
    };
    return hay.filter((h) => score(needle, h) >= 0.86);
}

const out: Record<string, Record<string, string[]>> = {};

for (const [composite, wards] of Object.entries(WARDS_BY_STATE_AND_LGA)) {
    const [state, lga] = composite.split("|");
    const lgas = byState.get(STATE_ALIASES[base(state)] ?? base(state)) ?? byState.get(base(state));
    if (!lgas) { report.unmatchedLgas.push(composite); continue; }

    let L = lgas.get(lgaKey(lga));
    if (!L) {
        const alias = LGA_ALIASES[composite];
        if (alias) L = lgas.get(lgaKey(alias));
    }
    if (!L) {
        //   A unique truncation, same rule #789 uses for the LGA level.
        const pre = [...lgas.keys()].filter((x) => x.length >= 6 && lgaKey(lga).startsWith(x));
        if (pre.length === 1) L = lgas.get(pre[0]);
    }
    if (!L) { report.unmatchedLgas.push(composite); continue; }

    const avail = new Map<string, any>();
    for (const w of L.wards ?? []) avail.set(wardKey(w.name), w);

    const pending: string[] = [];
    const take = (w: string, hit: any, how: keyof Report) => {
        const names: string[] = [];
        const seen = new Set<string>();
        for (const u of hit.units ?? []) {
            const n = tidy(u?.name ?? "");
            if (!n || BARE.test(n) || seen.has(n.toLowerCase())) continue;
            seen.add(n.toLowerCase());
            names.push(n);
        }
        if (names.length === 0) return;
        names.sort((a, b) => a.localeCompare(b));
        (out[state] ??= {})[`${lga}|${w}`] = names;
        report.units += names.length;
        (report[how] as number)++;
    };

    for (const w of wards) {
        const hit = avail.get(wardKey(w));
        if (hit) { avail.delete(wardKey(w)); take(w, hit, "exact"); }
        else pending.push(w);
    }

    const still: string[] = [];
    for (const w of pending) {
        const cands = closeMatches(wardKey(w), [...avail.keys()]);
        if (cands.length === 1) {
            const hit = avail.get(cands[0])!; avail.delete(cands[0]); take(w, hit, "unique");
        } else still.push(w);
    }

    if (still.length === 1 && avail.size === 1) {
        const only = [...avail.keys()][0];
        const hit = avail.get(only)!; avail.delete(only); take(still[0], hit, "deduced");
    } else {
        for (const w of still) report.unmatchedWards.push(`${composite}|${w}`);
    }
}

const TOTAL = Object.values(WARDS_BY_STATE_AND_LGA).reduce((n, w) => n + w.length, 0);
const covered = report.exact + report.unique + report.deduced;
if (covered < TOTAL * 0.9) {
    console.error(`REFUSING: only ${covered} of ${TOTAL} wards matched a polling-unit list.`);
    process.exit(1);
}

const DIR = join("src", "data", "polling-units");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const entries: string[] = [];
for (const [state, wards] of Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) {
    writeFileSync(join(DIR, `${slug(state)}.json`), JSON.stringify(wards));
    entries.push(`    ${JSON.stringify(state)}: () => import("./${slug(state)}.json"),`);
}

/*
 *   A STATIC MAP OF DYNAMIC IMPORTS, not a template-literal import.
 *
 *   `import(\`./\${slug}.json\`)` is invisible to the bundler, so the shards
 *   would not be traced into the deployment and every lookup would fail in
 *   production while working perfectly here. Thirty-seven literal imports are
 *   each seen, code-split, and loaded only when that state is asked for.
 */
writeFileSync(join(DIR, "index.ts"), `/**
 * Polling units by state. GENERATED — DO NOT EDIT BY HAND.
 *
 * Built by scripts/build-polling-units.ts, which documents the source, the
 * join rules and what it refuses to guess. Re-run it rather than editing.
 *
 * ${covered} wards, ${report.units} polling units, ${Object.keys(out).length} states.
 *
 * SERVER ONLY. These shards total about five megabytes; lib/polling-units.ts
 * loads one state at a time and no client component imports them.
 */

export const POLLING_UNIT_SHARDS: Record<string, () => Promise<{ default: Record<string, string[]> }>> = {
${entries.join("\n")}
};
`);

console.log(JSON.stringify({
    wardsWithPollingUnits: covered,
    ofWards: TOTAL,
    coveragePercent: Math.round((covered / TOTAL) * 100),
    pollingUnits: report.units,
    matchedExact: report.exact,
    matchedUniqueClose: report.unique,
    matchedByDeduction: report.deduced,
    unmatchedLgas: report.unmatchedLgas.length,
    unmatchedWards: report.unmatchedWards.length,
    states: Object.keys(out).length,
}, null, 2));
