import { writeGuard, PaymentStatusWriteSchema } from '../write-guard';
import { z } from 'zod';
import { PAYMENT_STATUS } from '../types/firestore';

const originalEnv = process.env.NODE_ENV;

describe('writeGuard', () => {
    afterEach(() => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
    });

    it('returns validated data when schema passes', () => {
        const data = { paymentStatus: 'paid' };
        const result = writeGuard(PaymentStatusWriteSchema.partial(), data, 'test');
        expect(result.paymentStatus).toBe('paid');
    });

    it('throws in non-production when schema fails', () => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
        const badData = { paymentStatus: 'banana' };
        expect(() =>
            writeGuard(PaymentStatusWriteSchema, badData, 'test')
        ).toThrow(/writeGuard/);
    });

    it('allows all canonical PAYMENT_STATUS values', () => {
        Object.values(PAYMENT_STATUS).forEach(status => {
            const data = { paymentStatus: status };
            expect(() =>
                writeGuard(PaymentStatusWriteSchema.partial(), data, 'test')
            ).not.toThrow();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#720 — it validates, it does not filter', () => {
    /*
     *   THE GUARD AGAINST SILENT DATA CORRUPTION WAS CAUSING IT.
     *
     *   writeGuard returned `result.data` — Zod's parsed output, which STRIPS
     *   every key the schema does not declare. PaymentStatusWriteSchema
     *   declares exactly one field. Two live money paths hand it four.
     *
     *   Measured before it was believed: that call returned
     *   `{"paymentStatus":"completed"}` and nothing else. So a paid export
     *   order never left `pending_payment` and a paid export investment never
     *   became `active` — the row asserted both that the payment completed and
     *   that it was still awaited. `paymentVerifiedAt` was never recorded on
     *   any export payment, and `updatedAt` never moved, so the row did not
     *   even look recently touched.
     *
     *   NOTHING COULD SEE IT. The write succeeds, the database accepts any
     *   shape, and the guard logs only on FAILURE — a silent partial write was
     *   its success path.
     */

    it('A FIELD THE SCHEMA DOES NOT DECLARE SURVIVES THE WRITE', () => {
        //   THE defect, at its narrowest. Before this, three of these four
        //   disappeared between the call and the database.
        const out: any = writeGuard(
            PaymentStatusWriteSchema.partial(),
            {
                status: 'processing',
                paymentStatus: 'completed',
                paymentVerifiedAt: '<<ts>>',
                updatedAt: '<<ts>>',
            },
            'test/payment-write',
        );

        expect(out).toEqual({
            status: 'processing',
            paymentStatus: 'completed',
            paymentVerifiedAt: '<<ts>>',
            updatedAt: '<<ts>>',
        });
    });

    it('AND THE SCHEMA STILL REFUSES A VALUE IT DOES DECLARE', () => {
        /*
         *   The half that must not be lost. Passing everything through is only
         *   safe if the declared fields are still checked — otherwise this
         *   finding trades a silent partial write for no guard at all, which is
         *   the mirror defect and the easier mistake to make.
         */
        expect(() => writeGuard(
            PaymentStatusWriteSchema.partial(),
            { paymentStatus: 'successful', status: 'processing' },
            'test/bad-status',
        )).toThrow(/Schema violation/);
    });

    it('AND A VALIDATED VALUE WINS OVER THE RAW ONE', () => {
        //   Passthrough must not mean "ignore the schema's output". A schema
        //   that coerces or defaults still decides the field it declares; only
        //   the fields it says nothing about are carried through untouched.
        const schema = z.object({ n: z.coerce.number() });
        const out: any = writeGuard(schema, { n: '42', other: 'kept' }, 'test/coerce');

        expect(out).toEqual({ n: 42, other: 'kept' });
    });

    it('AND A NON-OBJECT PAYLOAD IS UNCHANGED', () => {
        //   The merge only makes sense for an object. Every call site passes
        //   one, but a guard that threw on anything else would be a new failure
        //   mode introduced by a fix.
        expect(writeGuard(z.string(), 'plain', 'test/scalar')).toBe('plain');
        expect(writeGuard(z.array(z.number()), [1, 2], 'test/array')).toEqual([1, 2]);
    });
});
