import { normalisePhone, normalisePhoneLoose } from '../phone';

describe('normalisePhone', () => {
    // Standard Nigerian formats
    it('converts 080XXXXXXXX (local) to +2348XXXXXXXXX', () => {
        expect(normalisePhone('08012345678')).toBe('+2348012345678');
    });
    it('converts 070XXXXXXXX to +2347XXXXXXXXX', () => {
        expect(normalisePhone('07012345678')).toBe('+2347012345678');
    });
    it('passes through already-normalised +234 numbers unchanged', () => {
        expect(normalisePhone('+2348012345678')).toBe('+2348012345678');
    });
    it('handles 234XXXXXXXXXX (no +) with 13 digits', () => {
        expect(normalisePhone('2348012345678')).toBe('+2348012345678');
    });
    it('strips spaces', () => {
        expect(normalisePhone('0801 234 5678')).toBe('+2348012345678');
    });
    it('strips dashes', () => {
        expect(normalisePhone('0801-234-5678')).toBe('+2348012345678');
    });
    // Null/undefined/empty
    it('returns null for null', () => {
        expect(normalisePhone(null)).toBeNull();
    });
    it('returns null for undefined', () => {
        expect(normalisePhone(undefined)).toBeNull();
    });
    it('returns null for empty string', () => {
        expect(normalisePhone('')).toBeNull();
    });
    it('returns null for non-numeric junk', () => {
        expect(normalisePhone('not-a-phone')).toBeNull();
    });
});

describe('normalisePhoneLoose', () => {
    it('normalises a standard local number', () => {
        expect(normalisePhoneLoose('08012345678')).toBe('+2348012345678');
    });
    it('returns null for empty string', () => {
        expect(normalisePhoneLoose('')).toBeNull();
    });
    it('returns null for null', () => {
        expect(normalisePhoneLoose(null)).toBeNull();
    });
    it('returns null for strings with fewer than 10 digits', () => {
        expect(normalisePhoneLoose('12345')).toBeNull();
    });
});
