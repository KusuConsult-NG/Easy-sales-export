/**
 * @jest-environment node
 */

/**
 *   #657 THE SERVER SHIPPED CLASS INSTANCES TO THE BROWSER, AND SAID SO IN A
 *   LOG NOBODY WAS READING.
 *
 *   Found by running the 362 e2e journeys against a production build with the
 *   SERVER'S OWN stdout captured — an instrument this audit had not used
 *   before. Every test passed. The server said this three times while they did:
 *
 *     ⨯ Error: Only plain objects, and a few built-ins, can be passed to
 *       Client Components from Server Components. Classes or null prototypes
 *       are not supported.
 *       {id: ..., amount: 20000, ..., createdAt: {_seconds: ...,
 *        _nanoseconds: 313000000, seconds: ..., nanoseconds: ...}, ...}
 *
 *   Once each for `createdAt`, `updatedAt` and `approvedAt`, on
 *   /cooperatives/loans, on every render.
 *
 * ── WHY THREE AND NOT FOUR ──────────────────────────────────────────────────
 *
 *   `readMyLoanApplications` spreads the whole document and then converts ONE
 *   field:
 *
 *       ...doc.data(),
 *       appliedAt: doc.data().appliedAt?.toDate?.() || new Date(),
 *
 *   `appliedAt` is the field it sorts on and the only one the screen prints, so
 *   that is the one whose shape somebody had to think about. The other three
 *   timestamps on the same row went across the boundary as they came out of the
 *   database. THE FIX REACHED ONE FIELD OF FOUR — the shape this audit has now
 *   found more often than any other, in its smallest form yet.
 *
 * ── MEASURED, NOT INFERRED ──────────────────────────────────────────────────
 *
 *   The adapter was asked directly what it returns, against the local stack
 *   with the real schema:
 *
 *     cooperative_loans    appliedAt, createdAt, updatedAt, approvedAt  Timestamp
 *     cooperative_members  joinedAt, createdAt, updatedAt               Timestamp
 *     users                createdAt, updatedAt,
 *                          serviceRegistrations.marketplace.registeredAt Timestamp
 *
 *   So every dedicated table hands back instances of the Timestamp class in
 *   lib/firestore-compat. Any reader that spreads a document into something a
 *   Client Component receives has this defect unless it names every timestamp
 *   on the row — which is a list that has to be maintained by hand against a
 *   schema nobody edits with this file open.
 *
 * ── AND THE TOOL FOR IT ALREADY EXISTED ─────────────────────────────────────
 *
 *   lib/firestore-serialize.ts opens by stating this exact rule — "Server
 *   Components CANNOT pass class instances (like Firestore Timestamps) to
 *   Client Components... These helpers convert raw Firestore Admin SDK
 *   DocumentData into plain, JSON-serializable objects safe for the
 *   server→client boundary" — and cooperative-readers.ts, the module written
 *   (#570) specifically to be read by Server Components, never imported it.
 *
 *   A declared rule with a working implementation, and the one module that most
 *   needed it going its own way. Both recurring classes at once.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A FIELD LIST ──────────────────
 *
 *   Naming createdAt, updatedAt and approvedAt would fix the three that were
 *   observed and leave the next one to be found the same way. The assertion is
 *   Next's own rule instead: walk everything a reader returns and refuse any
 *   value that is not a plain object, an array, a Date or a primitive. A field
 *   added to any of these tables tomorrow is covered without touching this file.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { Timestamp } from '@/lib/firestore-compat';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

const readers = async () => await import('@/lib/cooperative-readers');

/**
 * Next's rule, as a function.
 *
 * "Only plain objects, and a few built-ins, can be passed to Client Components
 * from Server Components. Classes or null prototypes are not supported."
 *
 * Returns the offending paths, so a failure names the field rather than saying
 * a boolean was false.
 */
function nonSerializable(value: unknown, path = 'value', found: string[] = []): string[] {
    if (value === null || value === undefined) return found;

    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return found;
    if (t === 'function' || t === 'symbol' || t === 'bigint') {
        found.push(`${path}: ${t}`);
        return found;
    }

    if (Array.isArray(value)) {
        value.forEach((v, i) => nonSerializable(v, `${path}[${i}]`, found));
        return found;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto === null) {
        //   Named explicitly by the error message, and not the same thing as a
        //   class: `Object.create(null)` has no constructor to report.
        found.push(`${path}: null-prototype`);
        return found;
    }

    const ctor = proto.constructor?.name;
    if (ctor === 'Date') return found;
    if (ctor !== 'Object') {
        found.push(`${path}: ${ctor ?? 'unknown class'}`);
        return found;
    }

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nonSerializable(v, `${path}.${k}`, found);
    }
    return found;
}

/** A timestamp of the shape the adapter really returns — an instance, not a literal. */
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#657 — the instrument itself', () => {
    /*
     *   AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT. Every assertion
     *   below rests on nonSerializable() being able to tell the two apart, and
     *   on the fake database handing back a Timestamp rather than flattening it
     *   into a plain object on the way through — which would make every test
     *   here pass over broken code.
     */
    it('KNOWS A CLASS INSTANCE FROM A PLAIN OBJECT', () => {
        expect(nonSerializable({ a: 1, b: 'two', c: [1, 2], d: new Date() })).toEqual([]);
        expect(nonSerializable({ at: ts('2026-01-01') })).toEqual(['value.at: Timestamp']);
        expect(nonSerializable({ deep: { list: [{ at: ts('2026-01-01') }] } }))
            .toEqual(['value.deep.list[0].at: Timestamp']);
        expect(nonSerializable({ o: Object.create(null) })).toEqual(['value.o: null-prototype']);
    });

    it('AND THE FAKE DATABASE HANDS A TIMESTAMP BACK AS A TIMESTAMP', async () => {
        //   The control that decides whether any of this is a measurement. If
        //   the store cloned through JSON, a Timestamp would come back as a
        //   plain { _seconds, ... } and the suite would be green against the
        //   defect it exists to catch.
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'probe', { memberId: 'm1', createdAt: ts('2026-01-01') });
        const snap = await (await import('@/lib/firebase-admin')).db
            .collection(COLLECTIONS.COOPERATIVE_LOANS).doc('probe').get();

        expect(nonSerializable(snap.data())).toEqual(['value.createdAt: Timestamp']);
    });
});

/**
 * BOTH PLACES A LOAN APPLICATION CAN BE FILED.
 *
 *   #570's own finding is that readMyLoanApplications reads two collections,
 *   keyed differently — `loan_applications` by `userId`, `cooperative_loans` by
 *   `memberId` — because a member's own application did not appear in their own
 *   list when only one was read.
 *
 *   The first version of this file tested the cooperative_loans half alone, and
 *   the mutation run said so: THREE mutants survived, all of them edits to the
 *   loan_applications branch, including THE DEFECT itself. A suite that covers
 *   one of two doors, in a file about a fix that reached one field of four.
 *
 *   Every assertion below runs against both.
 */
const DOORS = [
    { name: 'loan_applications', collection: COLLECTIONS.LOAN_APPLICATIONS, key: 'userId' },
    { name: 'cooperative_loans', collection: COLLECTIONS.COOPERATIVE_LOANS, key: 'memberId' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe.each(DOORS)('#657 — what the loans page hands to the browser ($name)', ({ collection, key }) => {
    it('CARRIES NO CLASS INSTANCE, ON ANY FIELD', async () => {
        /*
         *   THE defect, in the shape the server reported it. Four timestamps on
         *   the row; the reader named one.
         */
        store.seed(collection, 'loan-1', {
            [key]: 'm1',
            amount: 20000,
            status: 'approved',
            appliedAt: ts('2026-02-01T09:00:00.000Z'),
            createdAt: ts('2026-02-01T09:00:00.000Z'),
            updatedAt: ts('2026-02-03T11:30:00.000Z'),
            approvedAt: ts('2026-02-03T11:30:00.000Z'),
        });

        const rows = await (await readers()).readMyLoanApplications('m1');

        expect(rows).toHaveLength(1);
        expect(nonSerializable(rows)).toEqual([]);
    });

    it('AND STILL SORTS AND PRINTS BY appliedAt, AS A DATE', async () => {
        /*
         *   The other half, and the reason this is not fixed by deleting the
         *   fields. LoansClient declares `appliedAt: Date` and prints it; the
         *   sort comparator reads it too. A repair that made every timestamp a
         *   string would change the one field with a declared type and a
         *   consumer.
         */
        store.seed(collection, 'older', {
            [key]: 'm1', amount: 1000, appliedAt: ts('2026-01-01T00:00:00.000Z'),
        });
        store.seed(collection, 'newer', {
            [key]: 'm1', amount: 2000, appliedAt: ts('2026-03-01T00:00:00.000Z'),
        });

        const rows = await (await readers()).readMyLoanApplications('m1');

        expect(rows.map(r => r.id)).toEqual(['newer', 'older']);
        expect(rows[0].appliedAt).toBeInstanceOf(Date);
        expect((rows[0].appliedAt as Date).toISOString()).toBe('2026-03-01T00:00:00.000Z');
        expect(rows[1].appliedAt).toBeInstanceOf(Date);
    });

    it('AND THE OTHER TIMESTAMPS SURVIVE AS READABLE VALUES, NOT DROPPED', async () => {
        /*
         *   "No class instances" is also satisfied by deleting every field the
         *   screen does not currently print, which would be a silent data loss
         *   the day one of them is wanted. They are converted, not removed.
         */
        store.seed(collection, 'loan-1', {
            [key]: 'm1', amount: 20000,
            appliedAt: ts('2026-02-01T09:00:00.000Z'),
            createdAt: ts('2026-02-01T09:00:00.000Z'),
            updatedAt: ts('2026-02-03T11:30:00.000Z'),
            approvedAt: ts('2026-02-03T11:30:00.000Z'),
        });

        const [row] = await (await readers()).readMyLoanApplications('m1');

        expect(row.createdAt).toBe('2026-02-01T09:00:00.000Z');
        expect(row.updatedAt).toBe('2026-02-03T11:30:00.000Z');
        expect(row.approvedAt).toBe('2026-02-03T11:30:00.000Z');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#657 — and the rest of the module, which had the same shape', () => {
    it('THE SAVINGS PLANS A MEMBER IS SHOWN', async () => {
        /*
         *   Never observed failing, and only because the seed has no plans in
         *   it. readFixedSavingsPlans names startDate, maturityDate and
         *   createdAt after spreading the row, so `updatedAt` — which the
         *   probe found on every dedicated table — leaves exactly as
         *   readMyLoanApplications' three did.
         */
        store.seed(COLLECTIONS.FIXED_SAVINGS_PLANS, 'plan-1', {
            memberId: 'm1', balance: 50000, interestRate: 14, durationMonths: 12,
            startDate: ts('2026-01-01T00:00:00.000Z'),
            maturityDate: ts('2027-01-01T00:00:00.000Z'),
            createdAt: ts('2026-01-01T00:00:00.000Z'),
            updatedAt: ts('2026-02-01T00:00:00.000Z'),
        });

        const plans = await (await readers()).readFixedSavingsPlans('m1');

        expect(plans).toHaveLength(1);
        expect(nonSerializable(plans)).toEqual([]);
        //   The three the module converts on purpose stay Dates: the screens
        //   were written against them.
        expect(plans[0].startDate).toBeInstanceOf(Date);
        expect(plans[0].maturityDate).toBeInstanceOf(Date);
        expect(plans[0].createdAt).toBeInstanceOf(Date);
    });

    it('AND THE MEMBERSHIP ANSWER, WHICH CARRIES A WHOLE MEMBER ROW', async () => {
        /*
         *   `data: membershipData` is the raw document, and the probe found
         *   three Timestamps on it. Two of the three callers flatten to
         *   { isMember, status } and never expose it; a reader that is only
         *   safe because of what its callers happen to do with it is one
         *   refactor away from the defect above.
         */
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', {
            userId: 'm1', membershipStatus: 'active',
            joinedAt: ts('2025-06-01T00:00:00.000Z'),
            createdAt: ts('2025-06-01T00:00:00.000Z'),
            updatedAt: ts('2026-01-01T00:00:00.000Z'),
        });

        const membership = await (await readers()).readCooperativeMembership('m1');

        expect(membership.isMember).toBe(true);
        expect(membership.status).toBe('active');
        expect(nonSerializable(membership)).toEqual([]);
    });

    it('AND THE LOAN PRODUCTS, WHICH WERE ALREADY SAFE AND STAY THAT WAY', async () => {
        /*
         *   A positive control on the claim that this module had a defect
         *   rather than a style. readActiveLoanProducts copies six named
         *   fields instead of spreading the row, so it never had this problem —
         *   and the row it copies from carries the same timestamps as the rest.
         *   Asserted so that a later change from whitelist to spread is caught
         *   here rather than in a production log.
         */
        store.seed(COLLECTIONS.LOAN_PRODUCTS, 'p1', {
            name: 'Working capital', description: 'Short term',
            minAmount: 10000, maxAmount: 500000, interestRate: 5, durationMonths: 12,
            isActive: true,
            createdAt: ts('2025-01-01T00:00:00.000Z'),
            updatedAt: ts('2026-01-01T00:00:00.000Z'),
        });

        const products = await (await readers()).readActiveLoanProducts();

        expect(products).toHaveLength(1);
        expect(nonSerializable(products)).toEqual([]);
        //   And it is still a whitelist: the admin row's own bookkeeping does
        //   not reach a member's browser at all.
        expect(Object.keys(products[0]).sort()).toEqual([
            'description', 'durationMonths', 'id', 'interestRate',
            'maxAmount', 'minAmount', 'name',
        ]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: loan applications spread the row raw again          KILLED
 *     the cooperative_loans half spreads raw again                    KILLED
 *     savings plans spread the row raw again                          KILLED
 *     the membership answer hands back the raw member row             KILLED
 *     loan products change from a whitelist to a spread               KILLED
 *     appliedAt stops being a Date                                    KILLED
 *     the non-named timestamps are deleted instead of converted       KILLED
 *     the walker stops recognising a class instance                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── THREE SURVIVED THE FIRST RUN, AND ALL THREE WERE ONE GAP ────────────────
 *
 *   "THE DEFECT", "appliedAt stops being a Date" and "the non-named timestamps
 *   are deleted" all survived, and every one of them was an edit to the
 *   `loan_applications` branch — which this file did not seed. It tested the
 *   cooperative_loans half alone.
 *
 *   readMyLoanApplications reads TWO collections for the reason #570 records:
 *   an application filed on the loans page went into cooperative_loans keyed by
 *   `memberId`, the list read loan_applications by `userId`, and the member saw
 *   "submitted" and then nothing. A suite covering one of those two doors, in a
 *   file whose subject is a fix that reached one field of four, is the finding
 *   happening to the test. Both doors now, as a describe.each.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The three errors are from a real run: 362 Playwright tests against a
 *   production build on the local stack, all passing, with the server's output
 *   captured. The shapes the adapter returns were read from that same stack
 *   through the application's own adapter, not assumed from the schema.
 *
 *   AND THE FIX WAS CONFIRMED THE SAME WAY, which is the only evidence that
 *   settles it — a unit test proves the reader, not the boundary:
 *
 *     before   3 × "Only plain objects…", /cooperatives/loans, every render
 *     after    0, over the same 146-test page crawl, the same page visited
 *
 *   Nothing else in the log changed.
 */
