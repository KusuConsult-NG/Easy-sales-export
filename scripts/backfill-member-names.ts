/**
 * Give the cooperative members nobody can name their name back — from a
 * record the platform already holds, and never from an invention.
 *
 * Run (report only, writes nothing):   npm run backfill:membernames
 * Run (writes the names):              npm run backfill:membernames -- --apply
 *
 * WHY IT IS NEEDED
 * ----------------
 * 77 cooperative members carry no fullName, firstName or lastName at all. The
 * #715 identity backfill was supposed to fix this by copying what the user
 * document knows, and for most of them it could not, for two reasons it never
 * distinguished:
 *
 *   1. IT READ THE WRONG ROW. It went to the user document at
 *      `cooperative_members.userId`. When that id is a SUPERSEDED profile the
 *      row is the emptier of the two by construction — the #724 tool keeps
 *      whichever record carries more — so the backfill read the loser and
 *      found nothing. Measured: 2 of the 77.
 *
 *   2. THE USER DOCUMENT IS A SKELETON. #495 measured 3,605 rows carrying
 *      `_system_skeleton_backfill: true`, 2,591 of them with `fullName`
 *      literally "Unknown Member", no email, no phone, and verified,
 *      isVerified and profileComplete all true. Written on 29 May 2026 by
 *      something that appears in no commit on any branch.
 *
 * WHAT "UNKNOWN MEMBER" COSTS, AND WHY THIS SCRIPT REFUSES IT
 * ----------------------------------------------------------
 * A repair run against production during this audit matched 52 members from
 * their live profile — and 41 of those "names" were that literal string. It
 * was caught after the write and reverted. Copying it does not name anybody:
 * it converts "we do not know who this is" into "this person is called Unknown
 * Member", which then satisfies every later name check, hides the row from any
 * future repair, and prints on an ID card.
 *
 * The platform's own placeholder set did not catch it — six private copies of
 * that rule existed and none knew the spelling the skeleton backfill actually
 * wrote. `isPlaceholderName` knows it now, and this script uses that one rule
 * rather than a seventh copy.
 *
 * WHERE A NAME MAY STILL BE FOUND
 * -------------------------------
 * Those people DID things. Sources are ranked by how strong the evidence is
 * and NEVER merged, because a name a bank confirmed is not the same claim as a
 * name typed into a form, and collapsing them hides the distinction somebody
 * needs in order to decide:
 *
 *   1  bank_resolved    the BANK confirmed the account holder. The test is the
 *                       STAMP (`accountNameSource` + `accountResolvedAt`), not
 *                       `verified` — lib/bank-account-provenance says why:
 *                       `verified: true` is what the simulated flow wrote, so
 *                       reading it would be reading the defect's own output and
 *                       calling it evidence.
 *   2  kyc              an identity document was checked.
 *   3  module_profile   self-declared on a WAVE, academy or loan application.
 *   4  order            self-declared at a purchase.
 *
 * Every source is searched across EVERY PROFILE THE MEMBER OWNS, live and
 * superseded, because that is where the 2 of 77 above were hiding.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *   - OVERWRITE A NAME. It only ever fills a member row that has none.
 *   - ACCEPT A PLACEHOLDER, or a name from a skeleton profile whatever that
 *     profile calls itself. A name on one of those rows came from the same
 *     unattended run and is not evidence.
 *   - GUESS BETWEEN CONFLICTING NAMES. Where the platform holds two different
 *     names for one person, the member is REPORTED and left alone. Picking one
 *     is a decision about who somebody is, and this script does not make it.
 *   - SPLIT A NAME. "Ngozi Chinedu Eledumare" loses a name to a first/last
 *     split, which is why #715 writes fullName and the screens read it (#825).
 *   - CLAIM A ROW BY EMAIL. It goes from the member to the profiles that member
 *     owns, never from an address to whoever shares it — #36's rule that an
 *     email match is a claim rather than proof.
 *
 * WHY IT IS SAFE TO RE-RUN
 * ------------------------
 * A member named by the first run no longer has a blank name, so the second
 * finds nothing to do for them. Running it twice writes nothing the first run
 * did not.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { isApply, targetHost, modeBanner, runScript } from './_maintenance-guard';
import { isPlaceholderName } from '../src/lib/canonical/placeholder-names';
import { MANUFACTURED_PROFILE_MARKER } from '../src/lib/profile-provenance';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

const APPLY = isApply();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

type Row = Record<string, any>;

interface Candidate {
    name: string;
    tier: number;
    source: string;
}

interface MemberCase {
    memberId: string;
    ownedIds: string[];
    candidates: Candidate[];
}

const TIER_NAME: Record<number, string> = {
    1: 'bank_resolved', 2: 'kyc', 3: 'module_profile', 4: 'order',
};

/** Runs of whitespace collapse — "Laraba  David  Nuhu" arrives with doubles. */
function tidy(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const t = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
}

/** A name only counts if it is not a stand-in. One rule, shared with the app. */
function realName(value: unknown): string | null {
    const t = tidy(value);
    return t && !isPlaceholderName(t) ? t : null;
}

async function page<T = Row>(
    table: string,
    select: string,
    shape: (q: any) => any = (q) => q,
): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await shape(
            admin.from(table).select(select).range(from, from + PAGE - 1),
        );
        if (error) fail(`Reading ${table}: ${error.message}`);
        if (!data || data.length === 0) break;
        out.push(...(data as T[]));
        if (data.length < PAGE) break;
    }
    return out;
}

/** The pointer this platform already follows: _migratedTo, then supabaseAuthId. */
function pointerOf(raw: Row, id: string): string | null {
    const migrated = tidy(raw?._migratedTo);
    if (migrated && migrated !== id) return migrated;
    const auth = tidy(raw?.supabaseAuthId);
    if (auth && auth !== id) return auth;
    return null;
}

async function main(): Promise<void> {
    console.log(modeBanner(
        'Cooperative member name backfill (#715, #495)',
        APPLY, targetHost(),
        'this will write fullName onto member rows that have none',
    ));

    // ── every user row, so the pointer graph can be walked in memory ────────
    const users = await page('users', 'id, raw_data');
    const byId = new Map<string, Row>();
    for (const u of users) byId.set(String(u.id), (u.raw_data ?? {}) as Row);

    /** Walk to the end of the chain, with a cycle guard. */
    function liveIdOf(start: string): string {
        let cur = start;
        const seen = new Set<string>([cur]);
        for (let hop = 0; hop < 10; hop += 1) {
            const next = pointerOf(byId.get(cur) ?? {}, cur);
            if (!next || seen.has(next)) break;
            seen.add(next);
            cur = next;
        }
        return cur;
    }

    /** live id -> every id that resolves to it. */
    const owned = new Map<string, string[]>();
    for (const id of byId.keys()) {
        const live = liveIdOf(id);
        owned.set(live, [...(owned.get(live) ?? []), id]);
    }

    // ── the members with no name at all ─────────────────────────────────────
    const members = await page('cooperative_members', 'id, user_id, raw_data');
    const unnamed = members.filter((m) => {
        const raw = (m.raw_data ?? {}) as Row;
        return !tidy(raw.fullName) && !tidy(raw.firstName) && !tidy(raw.lastName);
    });

    console.log(`Cooperative members with no name at all: ${unnamed.length}\n`);
    if (unnamed.length === 0) { console.log('Nothing to do.\n'); return; }

    const cases: MemberCase[] = unnamed.map((m) => {
        const raw = (m.raw_data ?? {}) as Row;
        const memberUserId = tidy(raw.userId) ?? tidy(m.user_id) ?? '';
        const live = memberUserId ? liveIdOf(memberUserId) : '';
        return {
            memberId: String(m.id),
            ownedIds: live ? (owned.get(live) ?? [live]) : [],
            candidates: [],
        };
    });

    /** owned id -> the member cases that own it. */
    const caseByOwnedId = new Map<string, MemberCase[]>();
    for (const c of cases) {
        for (const id of c.ownedIds) {
            caseByOwnedId.set(id, [...(caseByOwnedId.get(id) ?? []), c]);
        }
    }
    const add = (ownerId: string, name: string | null, tier: number, source: string) => {
        if (!name) return;
        for (const c of caseByOwnedId.get(ownerId) ?? []) {
            c.candidates.push({ name, tier, source });
        }
    };

    // ── tier 1: the bank confirmed the account holder ───────────────────────
    for (const [id, raw] of byId) {
        if (!caseByOwnedId.has(id)) continue;
        for (const block of [raw, (raw.bankDetails ?? {}) as Row]) {
            const stamped = block.accountNameSource === 'bank_resolve'
                && typeof block.accountResolvedAt === 'string'
                && block.accountResolvedAt.trim() !== ''
                && !Number.isNaN(new Date(block.accountResolvedAt).getTime());
            if (stamped) {
                add(id, realName(block.accountName ?? block.bankAccountName), 1, 'bank_resolved');
            }
        }
    }

    // ── tiers 2-4: the collections those people left a name in ──────────────
    const DOC_SOURCES: Array<{ collection: string; tier: number }> = [
        { collection: 'kyc_verifications', tier: 2 },
        { collection: 'wave_applications', tier: 3 },
        { collection: 'academy_applications', tier: 3 },
        { collection: 'loan_applications', tier: 3 },
        { collection: 'seller_verifications', tier: 3 },
        { collection: 'farm_nation_applications', tier: 3 },
    ];

    for (const { collection, tier } of DOC_SOURCES) {
        const rows = await page(
            'document_collections', 'id, raw_data',
            (q: any) => q.eq('collection_name', collection),
        );
        for (const r of rows) {
            const raw = (r.raw_data ?? {}) as Row;
            const ownerId = tidy(raw.userId) ?? tidy(raw.applicantId) ?? tidy(raw.memberId);
            if (!ownerId) continue;
            const profile = (raw.profile ?? {}) as Row;
            add(ownerId, realName(
                raw.fullName ?? profile.fullName ?? raw.name ?? profile.name
                ?? [raw.firstName, raw.lastName].filter(Boolean).join(' ')
                ?? [profile.firstName, profile.lastName].filter(Boolean).join(' '),
            ), tier, `module:${collection}`);
        }
    }

    const orders = await page('marketplace_orders', 'id, user_id, raw_data');
    for (const o of orders) {
        const raw = (o.raw_data ?? {}) as Row;
        const ownerId = tidy(raw.buyerId) ?? tidy(o.user_id);
        if (!ownerId) continue;
        add(ownerId, realName(
            raw.buyerName ?? raw.customerName ?? (raw.shippingAddress ?? {}).fullName,
        ), 4, 'order');
    }

    // ── decide ──────────────────────────────────────────────────────────────
    const fillable: Array<{ memberId: string; name: string; source: string; from: string }> = [];
    const conflicted: Array<{ memberId: string; names: string[] }> = [];
    const nothing: string[] = [];

    for (const c of cases) {
        if (c.candidates.length === 0) { nothing.push(c.memberId); continue; }

        const best = Math.min(...c.candidates.map((x) => x.tier));
        const atBest = c.candidates.filter((x) => x.tier === best);
        const distinct = [...new Set(atBest.map((x) => x.name))];

        if (distinct.length > 1) {
            //   Two different names at the SAME strength of evidence. Choosing
            //   is a decision about who somebody is.
            conflicted.push({ memberId: c.memberId, names: distinct });
            continue;
        }
        fillable.push({
            memberId: c.memberId,
            name: distinct[0],
            source: TIER_NAME[best] ?? String(best),
            from: atBest[0].source,
        });
    }

    if (APPLY) {
        for (const f of fillable) {
            const row = members.find((m) => String(m.id) === f.memberId);
            const raw = (row?.raw_data ?? {}) as Row;
            const { error } = await admin
                .from('cooperative_members')
                .update({
                    raw_data: {
                        ...raw,
                        fullName: f.name,
                        //   Provenance, so six months on somebody can tell this
                        //   was DERIVED and from how strong a record.
                        nameBackfilledFrom: f.from,
                        nameBackfilledTier: f.source,
                        nameBackfilledAt: new Date().toISOString(),
                    },
                })
                .eq('id', f.memberId);
            if (error) fail(`Writing ${f.memberId}: ${error.message}`);
        }
    }

    console.log(`${APPLY ? 'NAMED' : 'WOULD NAME'} — ${fillable.length}`);
    for (const f of fillable.slice(0, 80)) {
        console.log(`  ${f.memberId}  ->  ${f.name}   (${f.source}, ${f.from})`);
    }
    if (fillable.length > 80) console.log(`  … and ${fillable.length - 80} more`);

    console.log(`\nCONFLICTING NAMES, left alone — ${conflicted.length}`);
    for (const c of conflicted) {
        console.log(`  ${c.memberId}  —  ${c.names.join('  vs  ')}`);
    }

    console.log(`\nNO NAME ANYWHERE ON THE PLATFORM — ${nothing.length}`);
    for (const id of nothing.slice(0, 40)) console.log(`  ${id}`);
    if (nothing.length > 40) console.log(`  … and ${nothing.length - 40} more`);

    if (!APPLY) {
        console.log('\nReport only. Re-run with --apply to write the names.\n');
    } else {
        console.log('\nDone. Nothing was overwritten, merged or invented.\n');
    }

    if (nothing.length > 0) {
        console.log(
            'The members above cannot be named from anything this platform stores: their\n'
            + 'profile is a skeleton row (#495) and they left no application, no KYC, no bank\n'
            + 'resolution and no order. They need contacting, not a script. An invented name\n'
            + 'would make them findable as somebody they are not.\n',
        );
    }
}

runScript('backfill-member-names', main);
