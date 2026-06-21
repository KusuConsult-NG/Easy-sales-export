import { parseCurrencyStringToFloat } from '../utils';

describe('parseCurrencyStringToFloat', () => {
    it('should parse standard numeric strings', () => {
        expect(parseCurrencyStringToFloat('1000')).toBe(1000);
        expect(parseCurrencyStringToFloat('123.45')).toBe(123.45);
    });

    it('should parse strings with commas', () => {
        expect(parseCurrencyStringToFloat('1,000')).toBe(1000);
        expect(parseCurrencyStringToFloat('1,500,000.50')).toBe(1500000.5);
    });

    it('should parse strings with currency symbols', () => {
        expect(parseCurrencyStringToFloat('₦5,000')).toBe(5000);
        expect(parseCurrencyStringToFloat('$100')).toBe(100);
        expect(parseCurrencyStringToFloat('€49.99')).toBe(49.99);
    });

    it('should strip whitespace', () => {
        expect(parseCurrencyStringToFloat('  ₦10,000  ')).toBe(10000);
        expect(parseCurrencyStringToFloat(' 50 000 ')).toBe(50000);
    });

    it('should handle empty/null/undefined values gracefully', () => {
        expect(parseCurrencyStringToFloat(null)).toBe(0);
        expect(parseCurrencyStringToFloat(undefined)).toBe(0);
        expect(parseCurrencyStringToFloat('')).toBe(0);
        expect(parseCurrencyStringToFloat('   ')).toBe(0);
    });

    it('should return NaN for invalid alphanumeric junk', () => {
        expect(parseCurrencyStringToFloat('abc')).toBeNaN();
        expect(parseCurrencyStringToFloat('₦abc')).toBeNaN();
    });
});
