/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
    isImageKitConfigured,
    getImageKitEndpoint,
    getImageKitId,
    uploadToImageKit,
    deleteFromImageKit,
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
        delete process.env.IMAGEKIT_ID;

        expect(getImageKitEndpoint()).toBe('https://ik.imagekit.io/Easysales');
        expect(getImageKitId()).toBe('Easysales');

        process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/CustomEndpoint';
        process.env.IMAGEKIT_ID = 'CustomEndpoint';

        expect(getImageKitEndpoint()).toBe('https://ik.imagekit.io/CustomEndpoint');
        expect(getImageKitId()).toBe('CustomEndpoint');
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

    it('deletes a file by fileId', async () => {
        process.env.IMAGEKIT_PRIVATE_KEY = 'private_dummy_key';

        const mockResponse = {
            ok: true,
            status: 204,
        };

        const globalFetch = global.fetch;
        global.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse as any);

        const result = await deleteFromImageKit('ik_file_123');
        expect(result).toBe(true);

        global.fetch = globalFetch;
    });
});
