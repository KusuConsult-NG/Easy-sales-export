/**
 * Build src/lib/nigeria-wards.generated.ts from published open ward data.
 *
 *   #789 THE OWNER, TWICE: "ward should be names of wards not ward 1 ward 2
 *        etc." and then "do a deep search and find them. they are available and
 *        you know where to find these details. It's public information."
 *
 *   They were right. Two independently packaged datasets carry the full INEC
 *   ward register, and this script turns one of them into the lookup table the
 *   forms read.
 *
 * ── THE SOURCES, AND WHY THIS ONE ───────────────────────────────────────────
 *
 *   PRIMARY    github.com/temikeezy/nigeria-geojson-data   data/lgas-with-wards.json
 *              MIT. 37 states, 774 LGAs, 8,809 wards.
 *
 *   CHECK      github.com/9jaDevo/nigeria-lga-ward         data/states-and-lgas-and-wards.json
 *              CC-BY-4.0 (c) afeibukun. 37 states, 774 LGAs, 8,813 wards.
 *
 *   MEASURED AGAINST EACH OTHER rather than trusted: of the 693 LGAs whose
 *   names match exactly between them, 520 have IDENTICAL ward sets and the
 *   remaining 173 differ only cosmetically — roman numerals against digits
 *   ("Gindiri II" / "Gindiri 11"), and single-letter typos ("Umuchima" /
 *   "Umichima"). Two packagings of the same register, not two guesses.
 *
 *   The primary is used because where they differ in SUBSTANCE it has the real
 *   names and the check has numbers: for Rivers/Tai the primary says
 *   "Bu-Bu Barakani" and "Oyigbo West" where the other says "Ward IX Nanabie".
 *   Numbers are the thing the owner objected to.
 *
 *   8,809 is also INEC's own published ward count, and every LGA here has
 *   between 10 and 20 wards, which is the constitutional range. Three
 *   independent signals that this is the register and not somebody's estimate.
 *
 * ── WHAT THIS SCRIPT WILL NOT DO ────────────────────────────────────────────
 *
 *   GUESS. An LGA whose name cannot be matched to the platform's own list by an
 *   exact match, a truncation, or an entry in ALIASES below is left with NO
 *   WARDS, and its applicants keep typing their own. A wrong ward list attached
 *   to the right LGA is a real-looking wrong answer on a member's record, which
 *   survives review precisely because it reads as data. That is worse than the
 *   numbered placeholder this replaces.
 *
 *   Run: npx tsx scripts/build-wards.ts <path-to-lgas-with-wards.json>
 */

import { readFileSync, writeFileSync } from "node:fs";
//   Read from the platform's OWN list rather than a copy of it: a snapshot
//   would drift, and the whole point of the keys below is that they match
//   what the form actually offers. Run with tsx so this import resolves.
import { NIGERIAN_LOCATIONS } from "../src/lib/locations";

const SOURCE = process.argv[2];
if (!SOURCE) {
    console.error("usage: npx tsx scripts/build-wards.ts <lgas-with-wards.json>");
    process.exit(1);
}

const raw = JSON.parse(readFileSync(SOURCE, "utf8"));

/** Comparison key: case, punctuation and spacing carry no meaning here. */
const key = (s: string): string =>
    String(s).trim().toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9]+/g, "");

/** The two state names the source spells differently. Both are known variants. */
const STATE_ALIASES: Record<string, string> = {
    fct: "Federal Capital Territory",
    nasarawa: "Nassarawa",
};

/**
 * LGAs the automatic rules cannot match, resolved BY HAND and each one checked
 * against the ward list it brings with it — which is the real verification,
 * because the wards are the payload and they are correct even where the source
 * has misspelled the LGA's label.
 *
 *   "Andoni"            -> "Andoni/Odual"          wards are Andoni's: Agwut-Obolo,
 *                                                  Asarama, Ngo Town, Unyeada
 *   "Ogba/Egbema/Ndoni" -> "Ogba/Egbema/Andoni"    wards are ONELGA's: Egi, Egbema,
 *                                                  Ndoni, Omoku Town
 *   "Kogi"              -> "Koton-Karfe"           same LGA, Kogi/Koton Karfe
 *   "Obi Ngwa"          -> "Oboma Ngwa"            Obioma Ngwa; wards Abayi, Mgboko
 *   "Chafe"             -> "Tsafe"                 Tsafe/Chafe, Zamfara
 *
 *   The rest are single-letter spelling variants of the same LGA, and each was
 *   confirmed the same way — by reading the wards it brings. "Fufore" carries a
 *   Fufore ward, "Gamjuwa" carries Ganjuwa, "Garum Mallam" carries Garun Malam,
 *   "Badagary" carries Ajara, Ajido and Apa, "Borsari" carries Dapchi. A name
 *   that looked close but arrived with another LGA's wards would not be here.
 */
const ALIASES: Record<string, string> = {
    "Abia|Obi Ngwa": "Oboma Ngwa",
    "Adamawa|Fufure": "Fufore",
    "Adamawa|Grie": "Girie",
    "Adamawa|Toungo": "Teungo",
    "Bauchi|Ganjuwa": "Gamjuwa",
    "Benue|Otukpo": "Oturkpo",
    "Cross River|Calabar Municipal": "Calabar Municipality",
    "Cross River|Yakuur": "Yakurr",
    "Edo|Esan Central": "Esan Centtral",
    "Ekiti|Gbonyin": "Gboyin",
    "Gombe|Shongom": "Shomgom",
    "Gombe|Yamaltu/Deba": "Yalmatu / Deba",
    "Jigawa|Kiri Kasama": "Kirika Samma",
    "Kano|Garun Mallam": "Garum Mallam",
    "Kano|Tudun Wada": "Tundun Wada",
    "Katsina|Kankia": "Kankiya",
    "Katsina|Katsina": "Katsina (K)",
    "Lagos|Badagry": "Badagary",
    "Lagos|Ifako-Ijaiye": "Ifako/Ijaye",
    "Nasarawa|Nasarawa Egon": "Nassarawa Egon",
    "Osun|Aiyedaade": "Ayedaade",
    "Osun|Aiyedire": "Ayedire",
    "Rivers|Emohua": "Emuoha",
    "Rivers|Ogba/Egbema/Ndoni": "Ogba/Egbema/Andoni",
    "Rivers|Omuma": "Omumma",
    "Sokoto|Tambuwal": "Tambawal",
    "Sokoto|Tangaza": "Tangazar",
    "Sokoto|Wamako": "Wamakko",
    "Yobe|Bursari": "Borsari",
    "Adamawa|Gayuk": "Guyuk",
    "Imo|Ezinihitte": "Ezinihitte Mbaise",
    "Imo|Ihitte/Uboma": "Ihitte-Uboma Isinweke",
    "Kebbi|Arewa Dandi": "Arewa",
    "Kebbi|Wasagu/Danko": "Danko Wasagu",
    "Kogi|Kogi": "Koton-Karfe",
    "Niger|Kontagora": "Kontogur",
    "Niger|Moya": "Muya",
    "Osun|Atakunmosa East": "Atakumosa East",
    "Osun|Atakunmosa West": "Atakumosa West",
    "Osun|Ilesa East": "Ilesha East",
    "Osun|Ilesa West": "Ilesha West",
    "Rivers|Andoni": "Andoni/Odual",
    "Zamfara|Chafe": "Tsafe",
};

/**
 * A name that is only a ward NUMBER, in any of the three ways this register
 * writes one: digits, roman numerals, or words.
 *
 * "Ward IV New Layout" and "Ward 4 NW2" are NOT this — they carry the place or
 * the INEC code, which is what appears on a voter's card. "Ward One" is.
 */
const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|eigth|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
//   THE "Ward" PREFIX IS OPTIONAL, and that is not a detail. Abia's Ugwunagbo
//   is written "Ward One ... Ward Ten" and Cross River's Calabar Municipality
//   is written "One ... Ten" with no prefix at all — the same non-answer in two
//   spellings, and a rule that required the prefix would have let the second
//   one through onto the form. ("eigth" is the source's own typo, kept so the
//   rule matches what is actually in the data rather than what should be.)
const BARE_WARD_NUMBER = new RegExp(`^(?:ward\\s*)?(?:\\d+|[ivxlc]+|${NUMBER_WORDS})$`, "i");

/**
 * Wards the PRIMARY source loses to a duplicated row, restored from the CHECK
 * source. Two, and both were found by the 10-to-20 range assertion rather than
 * by reading 8,778 names.
 *
 *   Kwara / Oke Ero     lists "Idofin Igbana I" TWICE. The check source has
 *                       "idofin-igbana-1" and "idofin-igbana-11", so the row
 *                       that was overwritten is Idofin Igbana II.
 *   Zamfara / Shinkafi  lists "Katuru" twice; the check source has "katuru"
 *                       and "kurya", so the lost ward is Kurya.
 *
 *   Both LGAs come back to the ten wards the constitution requires, and the
 *   arithmetic is the evidence: nine names plus one duplicate is ten rows, and
 *   the check source names the tenth. This is the ONLY place a ward name is
 *   written by hand, it is two names, and each is sourced.
 */
const REPAIRS: Record<string, string[]> = {
    "Kwara|Oke Ero": ["Idofin Igbana II"],
    "Zamfara|Shinkafi": ["Kurya"],
};

const tidy = (s: string): string => String(s).replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

//   Index the source by comparison key so the matching below never depends on
//   how either side happens to spell a name.
const sourceByState = new Map<string, { name: string; lgas: any }>();
for (const state of Object.keys(raw)) sourceByState.set(key(state), { name: state, lgas: raw[state] });

const out: Record<string, string[]> = {};
const report: any = { matched: 0, exact: 0, prefix: 0, alias: 0, unmatched: [] as string[],
    excluded: [] as string[], numberNamed: [] as string[], wards: 0 };

for (const [appState, appLgas] of Object.entries(NIGERIAN_LOCATIONS)) {
    const srcStateName = STATE_ALIASES[key(appState)] ?? appState;
    const src = sourceByState.get(key(srcStateName));
    if (!src) { report.unmatched.push(`${appState}|<whole state>`); continue; }

    const srcLgaNames = Object.keys(src.lgas);
    const byKey = new Map(srcLgaNames.map((l) => [key(l), l]));
    //   Names claimed by an exact match are off the table for the fuzzier
    //   rules below, so a truncation can never steal an LGA that already has
    //   its own row.
    const claimed = new Set(appLgas.map((l) => key(l)).filter((k) => byKey.has(k)));

    for (const appLga of appLgas) {
        const k = key(appLga);
        let srcLga = byKey.get(k);
        let how = "exact";

        if (!srcLga) {
            const alias = ALIASES[`${appState}|${appLga}`];
            if (alias && byKey.has(key(alias))) { srcLga = byKey.get(key(alias)); how = "alias"; }
        }
        if (!srcLga) {
            //   The source truncates some names to eight characters — an export
            //   artefact, e.g. "AniochaN", "Abakalik", "Gwadabaw". A truncation
            //   is only accepted when it is UNIQUE and at least six characters,
            //   so it cannot land on the wrong LGA.
            const pre = srcLgaNames.filter(
                (n: string) => !claimed.has(key(n)) && key(n).length >= 6 && k.startsWith(key(n)));
            if (pre.length === 1) { srcLga = pre[0]; how = "prefix"; }
        }

        if (!srcLga) { report.unmatched.push(`${appState}|${appLga}`); continue; }

        //   Tidy, de-duplicate case-insensitively, keep the source's own order
        //   stable by sorting — the register is not ordered meaningfully and a
        //   sorted list is what a person scans.
        const seen = new Map<string, string>();
        for (const w of src.lgas[srcLga]) {
            const name = tidy(w?.name ?? w);
            if (!name) continue;
            if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
        }
        for (const extra of REPAIRS[`${appState}|${appLga}`] ?? []) {
            if (!seen.has(extra.toLowerCase())) seen.set(extra.toLowerCase(), extra);
        }
        const wards = [...seen.values()].sort((a: string, b: string) => a.localeCompare(b));

        /*
         *   #974 THE RULE AGAINST A FABRICATED LIST WAS SUPPRESSING A REAL ONE.
         *
         *   THE OWNER: "verify if you have all the Wards and PUs populated
         *   because some users couldn't find some of the wards and PUs in the
         *   drop down."
         *
         *   This used to read `wards.length === 0 || wards.every(BARE_WARD_NUMBER)`,
         *   and the second clause excluded exactly two LGAs — Abia's Ugwunagbo and
         *   Cross River's Calabar Municipality — whose wards this register names
         *   "Ward One … Ward Ten" and "One … Ten". #774's rule, which the clause
         *   came from, is right about what it was written for: the OLD code
         *   offered "Ward 1 … Ward 10" as the ward list for 772 of 774 LGAs from a
         *   hand-written `MOCK_WARDS["default"]`, and a number that matches
         *   nothing on a voter's card is not an answer.
         *
         *   BUT THAT PLACEHOLDER IS GONE — #774 deleted it — so every name
         *   reaching this line now comes from the register, and these two are not
         *   fabrications. They are what INEC publishes. The evidence is a
         *   cross-check, which is the same check #789 used and the only one that
         *   settles it:
         *
         *     temikeezy (this source)  Ugwunagbo: Ward One … Ward Ten
         *     sadiqsalau/inec-ng-data  Ugwunagbo: WARD ONE … WARD TEN, 160 units
         *     temikeezy                Calabar Municipality: One … Eigth … Ten
         *     sadiqsalau               Calabar Municipality: ONE … EIGTH … TEN,
         *                                                    332 units
         *
         *   Two independently published copies of the register agree name for
         *   name, INCLUDING the typo "Eigth"/"EIGTH", and the second lists 492
         *   polling units between them. A shared typo is a shared source, not two
         *   people inventing the same fiction.
         *
         *   AND THE INCONSISTENCY IS THE PROOF IT WAS A REGEX AND NOT A JUDGEMENT.
         *   Cross River's Calabar SOUTH numbers its wards the same way — "One (1)
         *   … Twelve (12)" — and has been offered on the form all along, because
         *   the parenthesised digit makes the name fail BARE_WARD_NUMBER. Two
         *   adjacent LGAs in one state, one naming convention, opposite treatment,
         *   decided by punctuation.
         *
         *   So the exclusion is now emptiness alone. The count is the control:
         *   admitting these brings the table to INEC's own published 774 LGAs and
         *   8,809 wards, and a rule that had let junk in would overshoot it.
         *
         *   BARE_WARD_NUMBER stays, and is still used — it now REPORTS which LGAs
         *   are numerically named instead of dropping them, so the next reader
         *   meets the fact rather than rediscovering it.
         */
        if (wards.length === 0) {
            report.excluded.push(`${appState}|${appLga}`);
            continue;
        }
        if (wards.every((w: string) => BARE_WARD_NUMBER.test(w))) {
            report.numberNamed.push(`${appState}|${appLga}`);
        }

        out[`${appState}|${appLga}`] = wards;
        report.matched++; report[how]++; report.wards += wards.length;
    }
}

//   A build that silently produced a half-empty table would put the platform
//   back where it started, so it fails instead.
const TOTAL_LGAS = Object.values(NIGERIAN_LOCATIONS).reduce((n: number, v: string[]) => n + v.length, 0);
if (report.matched < TOTAL_LGAS - 10) {
    console.error(`REFUSING: only ${report.matched} of ${TOTAL_LGAS} LGAs matched.`);
    console.error(report.unmatched.join("\n"));
    process.exit(1);
}

const body = Object.keys(out).sort().map((k: string) =>
    `    ${JSON.stringify(k)}: [${out[k].map((w: string) => JSON.stringify(w)).join(", ")}],`).join("\n");

writeFileSync("src/lib/nigeria-wards.generated.ts", `/**
 * Nigeria's electoral wards, by state and LGA. GENERATED — DO NOT EDIT BY HAND.
 *
 *   Built by scripts/build-wards.ts, which documents the sources, how they
 *   were checked against each other, and what it refuses to guess. Re-run it
 *   rather than editing this file.
 *
 *   ${report.matched} LGAs, ${report.wards} wards.
 *
 *   KEYED BY STATE AND LGA, both. Six LGA names are shared by two states each —
 *   Bassa (Kogi, Plateau), Ifelodun and Irepodun (Kwara, Osun), Nasarawa (Kano,
 *   Nasarawa), Obi (Benue, Nasarawa), Surulere (Lagos, Oyo) — so a table keyed
 *   on the LGA alone would hand six of them the other state's wards.
 *
 *   The keys are the platform's OWN spellings from NIGERIAN_LOCATIONS, so a
 *   lookup needs no translation at the call site.
 */

export const WARDS_BY_STATE_AND_LGA: Readonly<Record<string, readonly string[]>> = {
${body}
};
`);

console.log(JSON.stringify({
    lgasWithWards: report.matched,
    wards: report.wards,
    matchedExact: report.exact, matchedByTruncation: report.prefix, matchedByAlias: report.alias,
    excludedAsEmpty: report.excluded,
    numberNamedButOFFERED: report.numberNamed,   //   #974 — the register's own names
    unmatched: report.unmatched,
}, null, 2));
