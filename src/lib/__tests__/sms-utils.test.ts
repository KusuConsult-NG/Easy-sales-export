import { sanitiseForGSM7, getSMSInfo, findNonGSM7Chars } from '../sms-utils';

describe('sanitiseForGSM7', () => {
    it('leaves plain ASCII messages unchanged', () => {
        const msg = 'EasySales: Your order has been confirmed. Log in to view details.';
        expect(sanitiseForGSM7(msg)).toBe(msg);
    });

    it('converts curly single quotes to straight apostrophes', () => {
        expect(sanitiseForGSM7('It\u2019s ready')).toBe("It's ready");
        expect(sanitiseForGSM7('\u2018quoted\u2019')).toBe("'quoted'");
    });

    it('converts curly double quotes to straight double quotes', () => {
        expect(sanitiseForGSM7('\u201cHello\u201d')).toBe('"Hello"');
    });

    it('converts em dash to hyphen', () => {
        expect(sanitiseForGSM7('Now \u2014 available')).toBe('Now - available');
    });

    it('converts en dash to hyphen', () => {
        expect(sanitiseForGSM7('Mon\u2013Fri')).toBe('Mon-Fri');
    });

    it('converts ellipsis to three dots', () => {
        expect(sanitiseForGSM7('Loading\u2026')).toBe('Loading...');
    });

    it('converts bullet to asterisk', () => {
        expect(sanitiseForGSM7('Step 1 \u2022 Step 2')).toBe('Step 1 * Step 2');
    });

    it('converts non-breaking space to regular space', () => {
        expect(sanitiseForGSM7('Hello\u00a0World')).toBe('Hello World');
    });

    it('converts trademark and registered symbols', () => {
        expect(sanitiseForGSM7('EasySales\u2122')).toBe('EasySales(TM)');
        expect(sanitiseForGSM7('EasySales\u00ae')).toBe('EasySales(R)');
    });

    it('handles a real-world pasted-from-Word message', () => {
        const wordMessage = 'Dear member \u2014 your application has been approved. It\u2019s time to log in!';
        const result = sanitiseForGSM7(wordMessage);
        expect(result).toBe("Dear member - your application has been approved. It's time to log in!");
        expect(findNonGSM7Chars(result)).toHaveLength(0);
    });

    it('sends the Nigerian currency sign as "NGN", not as "?"', () => {
        //   #266 THIS TEST USED TO PIN THE DEFECT.
        //
        //        It read "leaves Nigerian currency sign ₦ replaced with ?" and
        //        asserted exactly that, with a comment explaining the mechanism
        //        — "₦ (U+20A6) is not in GSM-7 — should become ?" — which is
        //        true about the encoding and skips the question that matters.
        //
        //        Every money SMS the platform sends is built with
        //        Intl.NumberFormat currency formatting, so every one of them
        //        went out reading "?25,000". A member was told their withdrawal
        //        of "?25,000" was approved. The behaviour was not unnoticed; it
        //        was certified here.
        //
        //        "should become ?" was a description of what the code did,
        //        written as if it were a requirement. Nothing wants a question
        //        mark where the currency goes.
        const result = sanitiseForGSM7('Pay \u20a65,000');

        expect(result).toBe('Pay NGN5,000');
        expect(findNonGSM7Chars(result)).toHaveLength(0);
    });

    it('and still replaces a character it has no reading for', () => {
        // The rule the one above is an exception to, kept explicit: an unknown
        // non-GSM-7 character must still be replaced, or the UCS-2 billing
        // problem this module exists for comes back.
        expect(sanitiseForGSM7('rating \u2605')).toBe('rating ?');
    });
});

describe('getSMSInfo', () => {
    it('returns GSM-7 with 160 chars/SMS for plain ASCII', () => {
        const info = getSMSInfo('Hello, this is a test message.');
        expect(info.isGSM7).toBe(true);
        expect(info.perSMS).toBe(160);
        expect(info.parts).toBe(1);
    });

    it('returns UCS-2 with 70 chars/SMS when special chars present', () => {
        const info = getSMSInfo('Hello \u2014 world');
        expect(info.isGSM7).toBe(false);
        expect(info.perSMS).toBe(70);
    });

    it('calculates parts correctly for long UCS-2 message', () => {
        // 71 characters with an em dash → UCS-2 → needs 2 SMS parts
        const msg = 'A'.repeat(70) + '\u2014';
        const info = getSMSInfo(msg);
        expect(info.isGSM7).toBe(false);
        expect(info.parts).toBe(Math.ceil(msg.length / 70));
    });

    it('calculates parts correctly for long GSM-7 message', () => {
        // 320 plain ASCII chars → needs 2 SMS parts (160 each)
        const msg = 'A'.repeat(320);
        const info = getSMSInfo(msg);
        expect(info.isGSM7).toBe(true);
        expect(info.parts).toBe(2);
    });

    it('returns warning for UCS-2 messages', () => {
        const info = getSMSInfo('Test \u2014 message');
        expect(info.warning).toContain('UCS-2');
    });

    it('handles empty string', () => {
        const info = getSMSInfo('');
        expect(info.parts).toBe(1);
        expect(info.length).toBe(0);
    });
});

describe('findNonGSM7Chars', () => {
    it('returns empty array for clean GSM-7 text', () => {
        expect(findNonGSM7Chars('Hello World!')).toHaveLength(0);
    });

    it('identifies em dash by name', () => {
        const found = findNonGSM7Chars('Hello \u2014 World');
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].name).toContain('em dash');
    });

    it('identifies curly quote by name', () => {
        const found = findNonGSM7Chars("It\u2019s done");
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].name).toContain('curly quote');
    });

    it('returns correct character index', () => {
        const found = findNonGSM7Chars('AB\u2014CD');
        expect(found[0].index).toBe(2);
    });
});
