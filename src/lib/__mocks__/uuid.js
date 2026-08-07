/**
 * CommonJS stand-in for the `uuid` package, used only by Jest.
 *
 * uuid v14 ships ESM-only in every build, which Jest cannot parse. Without
 * this, any suite that imports a module depending on uuid — notably
 * src/lib/supabase-db.ts — fails at import time, which is part of why the
 * adapter was only ever exercised through a mock.
 *
 * Produces RFC 4122 version-4 formatted ids. Not cryptographically strong;
 * this file must never be reachable from application code.
 */
function v4() {
    const hex = [];
    for (let i = 0; i < 256; i++) hex[i] = (i + 0x100).toString(16).slice(1);

    const b = new Uint8Array(16);
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10

    return (
        hex[b[0]] + hex[b[1]] + hex[b[2]] + hex[b[3]] + '-' +
        hex[b[4]] + hex[b[5]] + '-' +
        hex[b[6]] + hex[b[7]] + '-' +
        hex[b[8]] + hex[b[9]] + '-' +
        hex[b[10]] + hex[b[11]] + hex[b[12]] + hex[b[13]] + hex[b[14]] + hex[b[15]]
    );
}

module.exports = { v4, validate: (s) => typeof s === 'string' && s.length === 36 };
