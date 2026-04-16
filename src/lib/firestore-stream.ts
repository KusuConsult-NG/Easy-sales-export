import { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

/**
 * A safe wrapper to iterate over Firestore streams in Next.js Server Actions.
 * 
 * Vercel's Node environment (and Next.js Webpack polyfills) frequently strip `Symbol.asyncIterator` 
 * from the standard NodeJS.ReadableStream returned by firestore `.stream()`. 
 * This causes `for await (const chunk of stream)` loops to silently skip entirely, producing 0 results.
 * 
 * By consuming the stream using classic `.on('data')` event listeners, we guarantee 
 * every document is iterated completely without relying on generator compilation.
 */
export function iterateStream(
    stream: NodeJS.ReadableStream,
    onData: (doc: QueryDocumentSnapshot<DocumentData>) => void | Promise<void>
): Promise<void> {
    return new Promise((resolve, reject) => {
        let activePromises = 0;
        let isEnded = false;

        const checkDone = () => {
            if (isEnded && activePromises === 0) resolve();
        };

        stream.on('data', async (doc: any) => {
            activePromises++;
            try {
                await onData(doc);
            } catch (err) {
                stream.emit('error', err);
            } finally {
                activePromises--;
                checkDone();
            }
        });

        stream.on('end', () => {
            isEnded = true;
            checkDone();
        });

        stream.on('error', (err) => {
            reject(err);
        });
    });
}
