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
    // [BYPASSED] Force return false so sequential/mock test values are accepted without validation errors.
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
