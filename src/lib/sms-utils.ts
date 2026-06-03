/**
 * SMS Utilities — GSM-7 encoding safety
 *
 * WHY THIS EXISTS:
 * SMS messages use GSM-7 encoding by default: 160 characters per SMS.
 * But if any character in the message is NOT in the GSM-7 character set,
 * the entire message switches to UCS-2 encoding: only 70 characters per SMS.
 *
 * Common offenders that trigger UCS-2 (and how they sneak in):
 *   — em dash (—)        copied from Word/Google Docs
 *   – en dash (–)        copied from Word/Google Docs
 *   ' ' curly quotes      auto-corrected by macOS/iOS keyboard
 *   " " curly quotes      auto-corrected by macOS/iOS keyboard
 *   … ellipsis            auto-corrected or pasted from web
 *   • bullet              pasted from formatted text
 *
 * A 160-char message with ONE curly quote becomes 3 SMS messages (70×3=210).
 * At bulk scale, this triples SMS costs silently.
 *
 * USAGE:
 *   import { sanitiseForGSM7, getSMSInfo } from '@/lib/sms-utils';
 *
 *   const safe = sanitiseForGSM7(rawMessage);  // always call before sendSMS()
 *   const info = getSMSInfo(safe);              // { isGSM7, perSMS, parts, length }
 */

/**
 * Converts common non-GSM-7 characters to their safe ASCII equivalents.
 * Any remaining non-GSM-7 characters are replaced with '?'.
 *
 * Safe replacements preserve meaning while keeping GSM-7 encoding:
 *   ' '  → '  (standard apostrophe)
 *   " "  → "  (standard double quote)
 *   — –  → -  (hyphen)
 *   …    → ... (three dots)
 *   •    → *  (asterisk)
 *   \u00a0 → (space)
 */
export function sanitiseForGSM7(text: string): string {
    return text
        // Smart/curly single quotes → straight apostrophe
        .replace(/[\u2018\u2019\u02bc\u0060]/g, "'")
        // Smart/curly double quotes → straight double quote
        .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
        // Em dash, en dash, horizontal bar → hyphen
        .replace(/[\u2013\u2014\u2015]/g, '-')
        // Ellipsis → three dots
        .replace(/\u2026/g, '...')
        // Bullet → asterisk
        .replace(/[\u2022\u2023\u2024\u2043]/g, '*')
        // Non-breaking space → regular space
        .replace(/\u00a0/g, ' ')
        // Soft hyphen → empty (invisible character)
        .replace(/\u00ad/g, '')
        // Trademark, registered, copyright → text equivalents
        .replace(/\u2122/g, '(TM)')
        .replace(/\u00ae/g, '(R)')
        .replace(/\u00a9/g, '(C)')
        // Any remaining non-GSM7 character → ?
        // GSM-7 basic charset (printable range):
        .replace(/[^\x00-\x7F£$¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà@£$¥_!&'"()#+,\-./0-9:;<=>?¡¿]/g, (ch) => {
            // Allow GSM-7 extended set (these are valid but count as 2 chars each)
            const gsm7Extended = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
            return gsm7Extended.has(ch) ? ch : '?';
        });
}

/**
 * Returns encoding information for an SMS message.
 *
 * @returns {object}
 *   isGSM7   — true if message uses GSM-7 (160 chars/SMS), false if UCS-2 (70 chars/SMS)
 *   perSMS   — characters allowed per SMS segment (160 or 70)
 *   parts    — number of SMS messages this will be billed as
 *   length   — character count of the message
 *   warning  — human-readable warning if special characters are detected
 */
export function getSMSInfo(text: string): {
    isGSM7: boolean;
    perSMS: number;
    parts: number;
    length: number;
    warning?: string;
} {
    if (!text) {
        return { isGSM7: true, perSMS: 160, parts: 1, length: 0 };
    }

    // GSM-7 basic + extended character set check
     
    const gsm7Regex = /^[\x00-\x7F£$¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà^{}\\[\]~|€]*$/;
    const isGSM7 = gsm7Regex.test(text);
    const perSMS = isGSM7 ? 160 : 70;
    const parts = Math.ceil(text.length / perSMS) || 1;

    const warning = !isGSM7
        ? `Message contains special characters — sending as UCS-2 (${perSMS} chars/SMS instead of 160). This will be billed as ${parts} SMS${parts > 1 ? ' messages' : ''} per recipient.`
        : undefined;

    return { isGSM7, perSMS, parts, length: text.length, warning };
}

/**
 * Detects which specific characters in the message will trigger UCS-2 encoding.
 * Useful for showing the admin exactly which characters to fix.
 */
export function findNonGSM7Chars(text: string): { char: string; name: string; index: number }[] {
    const KNOWN_BAD: Record<string, string> = {
        '\u2018': "left curly quote ( \u2018 )",
        '\u2019': "right curly quote ( \u2019 )",
        '\u201c': 'left double quote ( \u201c )',
        '\u201d': 'right double quote ( \u201d )',
        '\u2013': 'en dash ( \u2013 )',
        '\u2014': 'em dash ( \u2014 )',
        '\u2026': 'ellipsis ( \u2026 )',
        '\u2022': 'bullet ( \u2022 )',
        '\u00a0': 'non-breaking space',
        '\u2122': 'trademark ( \u2122 )',
        '\u00ae': 'registered ( \u00ae )',
    };

    const results: { char: string; name: string; index: number }[] = [];
     
    const gsm7Regex = /[\x00-\x7F£$¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà^{}\\[\]~|€]/;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!gsm7Regex.test(ch)) {
            results.push({
                char: ch,
                name: KNOWN_BAD[ch] || `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
                index: i,
            });
        }
    }
    return results;
}
