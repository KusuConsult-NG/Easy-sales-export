/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
    isImageKitConfigured,
    getImageKitEndpoint,
    getImageKitId,
    uploadToImageKit,
} from '@/lib/imagekit';

describe('ImageKit storage integration', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        jest.restoreAllMocks();
    });

    it('detects when ImageKit is configured', () => {
        delete process.env.IMAGEKIT_PRIVATE_KEY;
        expect(isImageKitConfigured()).toBe(false);

        process.env.IMAGEKIT_PRIVATE_KEY = 'private_dummy_key';
        expect(isImageKitConfigured()).toBe(true);
    });

    it('resolves the URL endpoint and ID with defaults', () => {
        delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT;
        delete process.env.IMAGEKIT_URL_ENDPOINT;
        delete process.env.IMAGEKIT_ID;

        expect(getImageKitEndpoint()).toBe('https://ik.imagekit.io/Easysales');

        /*
         *   NULL, AND THIS TEST USED TO SAY "Easysales".
         *
         *   The endpoint keeps a default because it BUILDS urls. The account
         *   id is read by three security gates to decide whether an ImageKit
         *   url belongs to this platform, and a guess there is a gate trusting
         *   a string in a source file. The Cloudinary branch beside each of
         *   those three has always failed closed on an unset variable; this is
         *   the other half of the same decision agreeing with it.
         *
         *   Nothing that worked stops working: with the account unconfigured
         *   and not literally Easysales, those gates already rejected every
         *   real url — the guess only made it silent.
         */
        expect(getImageKitId()).toBeNull();

        process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/CustomEndpoint';

        //   DERIVED FROM THE ENDPOINT ALONE, with no IMAGEKIT_ID set — which
        //   is the deployed shape, since the Dockerfile passes the endpoint as
        //   a build arg and passes IMAGEKIT_ID nowhere.
        expect(getImageKitEndpoint()).toBe('https://ik.imagekit.io/CustomEndpoint');
        expect(getImageKitId()).toBe('CustomEndpoint');

        //   And an explicit id still wins over the endpoint.
        process.env.IMAGEKIT_ID = 'ExplicitAccount';
        expect(getImageKitId()).toBe('ExplicitAccount');
    });

    it('AND THE THREE GATES REFUSE WHEN THE ACCOUNT IS UNKNOWN', () => {
        //   The reason the null matters. Each of these reads getImageKitId()
        //   and must not treat "we do not know" as "it is ours".
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        for (const rel of [
            'src/app/api/proxy-image/route.ts',
            'src/app/api/id-card/pdf/route.ts',
            'src/app/api/certificates/upload/route.ts',
        ]) {
            const code = readFileSync(join(process.cwd(), rel), 'utf8');
            expect(code).toContain('getImageKitId()');
            expect(code).toMatch(/if \(!imageKitId\)|!imageKitId \|\|/);
        }
    });

    it('uploads a file buffer to ImageKit API', async () => {
        process.env.IMAGEKIT_PRIVATE_KEY = 'private_dummy_key';

        const mockResponse = {
            ok: true,
            status: 200,
            json: async () => ({
                fileId: 'ik_file_123',
                name: 'test.jpg',
                url: 'https://ik.imagekit.io/Easysales/products/test.jpg',
                filePath: '/products/test.jpg',
            }),
        };

        const globalFetch = global.fetch;
        global.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse as any);

        const result = await uploadToImageKit({
            file: Buffer.from('dummy image content'),
            fileName: 'test.jpg',
            folder: 'products',
            mimeType: 'image/jpeg',
        });

        expect(result.url).toBe('https://ik.imagekit.io/Easysales/products/test.jpg');
        expect(result.fileId).toBe('ik_file_123');
        expect(global.fetch).toHaveBeenCalledTimes(1);

        global.fetch = globalFetch;
    });

    it('throws when ImageKit responds with an error', async () => {
        process.env.IMAGEKIT_PRIVATE_KEY = 'private_dummy_key';

        const mockResponse = {
            ok: false,
            status: 400,
            text: async () => 'Invalid key',
        };

        const globalFetch = global.fetch;
        global.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse as any);

        await expect(uploadToImageKit({
            file: Buffer.from('dummy image content'),
            fileName: 'test.jpg',
        })).rejects.toThrow('ImageKit upload failed (400): Invalid key');

        global.fetch = globalFetch;
    });

    /*
     *   #675 THE DELETE TEST WENT WITH THE DELETE.
     *
     *   `deleteFromImageKit` is gone from lib/imagekit — see the note at the
     *   foot of that file. A test that exercises a capability is a reason to
     *   keep the capability, and this one covered a DELETE to
     *   api.imagekit.io/v1/files/<id> that nothing in the application called
     *   and that the owner's standing rule forbids.
     *
     *   What keeps it gone is nothing-destroys-an-uploaded-asset.test.ts,
     *   whose sweep now names the ACT rather than the vendor.
     */
});
