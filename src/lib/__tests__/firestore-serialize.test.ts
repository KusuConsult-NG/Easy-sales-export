import { serializeValue, serializeDoc, serializeDocs } from '../firestore-serialize';

describe('serializeValue', () => {
    it('passes string primitives through unchanged', () => {
        expect(serializeValue('hello')).toBe('hello');
    });
    it('passes number primitives through unchanged', () => {
        expect(serializeValue(42)).toBe(42);
    });
    it('passes boolean primitives through unchanged', () => {
        expect(serializeValue(true)).toBe(true);
    });
    it('passes null through unchanged', () => {
        expect(serializeValue(null)).toBeNull();
    });

    it('converts a Timestamp-like object (with toDate()) to ISO string', () => {
        const fakeTimestamp = {
            toDate: () => new Date('2024-01-15T10:30:00.000Z'),
        };
        expect(serializeValue(fakeTimestamp)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('converts plain-object Timestamp {seconds, nanoseconds} to ISO string', () => {
        const plainTs = { seconds: 1705314600, nanoseconds: 0 };
        const result = serializeValue(plainTs);
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('converts plain-object Timestamp {_seconds, _nanoseconds} to ISO string', () => {
        const plainTs = { _seconds: 1705314600, _nanoseconds: 0 };
        const result = serializeValue(plainTs);
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('converts Date to ISO string', () => {
        const d = new Date('2024-06-01T00:00:00.000Z');
        expect(serializeValue(d)).toBe('2024-06-01T00:00:00.000Z');
    });

    it('recursively serializes nested objects with Timestamps', () => {
        const nested = {
            name: 'Alice',
            createdAt: { toDate: () => new Date('2024-01-15T10:30:00.000Z') },
            address: {
                city: 'Lagos',
                updatedAt: { toDate: () => new Date('2024-02-01T00:00:00.000Z') },
            },
        };
        const result = serializeValue(nested);
        expect(result.name).toBe('Alice');
        expect(result.createdAt).toBe('2024-01-15T10:30:00.000Z');
        expect(result.address.city).toBe('Lagos');
        expect(result.address.updatedAt).toBe('2024-02-01T00:00:00.000Z');
    });

    it('recursively serializes arrays containing objects with Timestamps', () => {
        const arr = [
            { ts: { toDate: () => new Date('2024-01-01T00:00:00.000Z') } },
            { ts: { toDate: () => new Date('2024-02-01T00:00:00.000Z') } },
        ];
        const result = serializeValue(arr);
        expect(result[0].ts).toBe('2024-01-01T00:00:00.000Z');
        expect(result[1].ts).toBe('2024-02-01T00:00:00.000Z');
    });
});

describe('serializeDoc', () => {
    it('merges id with serialized data', () => {
        const data = {
            name: 'Test',
            createdAt: { toDate: () => new Date('2024-01-01T00:00:00.000Z') },
        };
        const result = serializeDoc('doc-123', data);
        expect(result.id).toBe('doc-123');
        expect(result.name).toBe('Test');
        expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('returns { id } when data is undefined', () => {
        const result = serializeDoc('doc-456', undefined);
        expect(result.id).toBe('doc-456');
    });

    it('does not include extra keys when data is undefined', () => {
        const result = serializeDoc('doc-789', undefined);
        expect(Object.keys(result)).toEqual(['id']);
    });
});

describe('serializeDocs', () => {
    it('maps an array of doc-like objects to serialized documents', () => {
        const docs = [
            { id: 'a1', data: () => ({ name: 'Alpha' }) },
            { id: 'b2', data: () => ({ name: 'Beta' }) },
        ];
        const results = serializeDocs(docs);
        expect(results).toHaveLength(2);
        expect(results[0].id).toBe('a1');
        expect(results[0].name).toBe('Alpha');
        expect(results[1].id).toBe('b2');
        expect(results[1].name).toBe('Beta');
    });

    it('returns an empty array for empty input', () => {
        expect(serializeDocs([])).toEqual([]);
    });
});
