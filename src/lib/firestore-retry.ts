import { PassThrough } from 'stream';

// Ensure this wrapper is applied only once across hot-reloads
if (!(globalThis as any).__FIRESTORE_PROTOTYPE_WRAPPED__) {
    (globalThis as any).__FIRESTORE_PROTOTYPE_WRAPPED__ = true;

    try {
        const dns = require('dns');
        if (dns && typeof dns.setDefaultResultOrder === 'function') {
            dns.setDefaultResultOrder('ipv4first');
            console.log('[DNS Configuration] Prefer IPv4 resolver order configured.');
        }
        const firestoreModule = require('@google-cloud/firestore');
        const FirestoreClient = firestoreModule.v1.FirestoreClient || firestoreModule.v1;

        const isTransientError = (err: any) => {
            const errMsg = err?.message || String(err);
            return errMsg.includes("Premature close") || 
                   errMsg.includes("socket hang up") || 
                   errMsg.includes("ECONNRESET") ||
                   errMsg.includes("Client network socket disconnected") ||
                   errMsg.includes("FetchError") ||
                   errMsg.includes("fetch failed") ||
                   errMsg.includes("Connection closed") ||
                   errMsg.includes("Socket closed") ||
                   errMsg.includes("UNAVAILABLE") ||
                   errMsg.includes("DEADLINE_EXCEEDED") ||
                   errMsg.includes("deadline exceeded") ||
                   errMsg.includes("stream terminated") ||
                   errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
        };

        const wrapPromiseMethod = (original: any, methodName: string) => {
            return function(this: any, ...args: any[]) {
                let attempt = 0;
                const retries = 3;
                let delay = 500;
                
                const execute = (): Promise<any> => {
                    attempt++;
                    try {
                        const res = original.call(this, ...args);
                        if (res instanceof Promise) {
                            return res.catch((err: any) => {
                                if (isTransientError(err) && attempt < retries) {
                                    console.warn(`[Firestore Prototype Retry] Method ${methodName} failed with transient error: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                                    return new Promise(resolve => setTimeout(resolve, delay)).then(() => {
                                        delay *= 2;
                                        return execute();
                                    });
                                }
                                throw err;
                            });
                        }
                        return Promise.resolve(res);
                    } catch (err: any) {
                        if (isTransientError(err) && attempt < retries) {
                            console.warn(`[Firestore Prototype Retry] Method ${methodName} threw transient error: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                            return new Promise(resolve => setTimeout(resolve, delay)).then(() => {
                                delay *= 2;
                                return execute();
                            });
                        }
                        return Promise.reject(err);
                    }
                };
                
                return execute();
            };
        };

        const wrapStreamMethod = (original: any, methodName: string) => {
            return function(this: any, ...args: any[]) {
                const retries = 3;
                let attempt = 0;
                let delay = 500;
                
                const outputStream = new PassThrough({ objectMode: true }) as any;
                let currentStream: any = null;

                outputStream.unpipe = (...unpipeArgs: any[]) => {
                    if (currentStream && typeof currentStream.unpipe === 'function') {
                        currentStream.unpipe(...unpipeArgs);
                    }
                    return (PassThrough.prototype.unpipe as any).call(outputStream, ...unpipeArgs);
                };
                
                outputStream.resume = (...resumeArgs: any[]) => {
                    if (currentStream && typeof currentStream.resume === 'function') {
                        currentStream.resume(...resumeArgs);
                    }
                    return (PassThrough.prototype.resume as any).call(outputStream, ...resumeArgs);
                };
                
                outputStream.end = (...endArgs: any[]) => {
                    if (currentStream && typeof currentStream.end === 'function') {
                        currentStream.end(...endArgs);
                    }
                    return (PassThrough.prototype.end as any).call(outputStream, ...endArgs);
                };
                
                outputStream.destroy = (...destroyArgs: any[]) => {
                    if (currentStream && typeof currentStream.destroy === 'function') {
                        currentStream.destroy(...destroyArgs);
                    }
                    return (PassThrough.prototype.destroy as any).call(outputStream, ...destroyArgs);
                };

                outputStream.cancel = (...cancelArgs: any[]) => {
                    if (currentStream && typeof currentStream.cancel === 'function') {
                        currentStream.cancel(...cancelArgs);
                    }
                };
                
                const executeStream = () => {
                    attempt++;
                    let dataEmitted = false;
                    
                    try {
                        currentStream = original.call(this, ...args);
                    } catch (err: any) {
                        handleError(err);
                        return;
                    }
                    
                    currentStream.on('data', (chunk: any) => {
                        dataEmitted = true;
                        outputStream.write(chunk);
                    });
                    
                    currentStream.on('end', () => {
                        outputStream.end();
                    });
                    
                    currentStream.on('error', (err: any) => {
                        handleError(err);
                    });
                    
                    function handleError(err: any) {
                        if (!dataEmitted && isTransientError(err) && attempt < retries) {
                            console.warn(`[Firestore Prototype Retry] Stream ${methodName} failed with transient error: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                            setTimeout(() => {
                                delay *= 2;
                                executeStream();
                            }, delay);
                        } else {
                            outputStream.emit('error', err);
                        }
                    }
                };
                
                executeStream();
                return outputStream;
            };
        };

        // Wrap stream-based client methods
        const streamMethods = ['runQuery', 'runAggregationQuery', 'batchGetDocuments'];
        streamMethods.forEach(method => {
            const original = FirestoreClient.prototype[method];
            if (typeof original === 'function') {
                FirestoreClient.prototype[method] = wrapStreamMethod(original, method);
            }
        });

        // Wrap promise-based client methods
        const promiseMethods = [
            'getDocument', 'updateDocument', 'deleteDocument', 
            'beginTransaction', 'commit', 'rollback', 
            'batchWrite', 'createDocument', 'listDocuments', 'listCollectionIds'
        ];
        promiseMethods.forEach(method => {
            const original = FirestoreClient.prototype[method];
            if (typeof original === 'function') {
                FirestoreClient.prototype[method] = wrapPromiseMethod(original, method);
            }
        });

        console.log('[Firestore Proxy] Global prototype retry proxy registered successfully.');
    } catch (e: any) {
        console.error('[Firestore Proxy] Failed to register global prototype retry proxy:', e);
    }
}
