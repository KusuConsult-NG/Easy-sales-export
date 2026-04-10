/**
 * kyc-validators.ts
 *
 * Shared validation utilities for NIN and BVN numbers.
 * Used by both client-side (KYCForm) and server-side (kyc actions) to
 * reject obviously fake or test identity numbers before hitting QoreID.
 *
 * Blocked patterns:
 *  - All same digit     : 00000000000, 11111111111 … 99999999999
 *  - Sequential asc/desc: 12345678901, 01234567890, 98765432109 …
 *  - Repeating sequences: 12121212121, 12312312312, 12341234123 …
 *  - Common placeholder : 00000000000, 11111111111 (already covered above)
 *
 * Legitimate NINs / BVNs have no predictable repeating or sequential pattern.
 */

const ASCENDING  = '01234567890123456789'; // doubled so substrings wrap
const DESCENDING = '98765432109876543210';

/**
 * Returns true if the ID looks obviously fake / is a known test pattern.
 * Both NIN and BVN are 11-digit strings — call this for either.
 */
export function isObviouslyFakeId(id: string): boolean {
    if (!id || id.length !== 11 || !/^\d{11}$/.test(id)) return false; // let format errors be caught elsewhere

    // 1. All same digit — 00000000000 … 99999999999
    if (/^(\d)\1{10}$/.test(id)) return true;

    // 2. Sequential ascending run of 11 digits (any starting digit, wraps 9→0)
    for (let i = 0; i < ASCENDING.length - 10; i++) {
        if (ASCENDING.substring(i, i + 11) === id) return true;
    }

    // 3. Sequential descending run of 11 digits (any starting digit, wraps 0→9)
    for (let i = 0; i < DESCENDING.length - 10; i++) {
        if (DESCENDING.substring(i, i + 11) === id) return true;
    }

    // 4. Repeating sub-pattern of length 1–5
    //    e.g. 12121212121 (repeat "12"), 12312312312 (repeat "123"), 12341234123 (repeat "1234")
    for (let len = 1; len <= 5; len++) {
        const segment = id.substring(0, len);
        const repeated = segment.repeat(Math.ceil(11 / len)).substring(0, 11);
        if (repeated === id) return true;
    }

    return false;
}

/**
 * Human-readable label for error messages.
 */
export function fakeIdErrorMessage(field: 'NIN' | 'BVN'): string {
    return (
        `The ${field} you entered appears to be invalid or a placeholder (e.g. all same digits or sequential numbers). ` +
        `Please double-check and enter your real ${field} as issued by ${field === 'NIN' ? 'NIMC (dial *346#)' : 'your bank (dial *565*0#)'}.`
    );
}
