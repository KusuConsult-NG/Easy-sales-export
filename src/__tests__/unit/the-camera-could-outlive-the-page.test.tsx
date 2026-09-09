/**
 * @jest-environment jsdom
 */

/**
 *   #575 THE CAMERA COULD OUTLIVE THE PAGE, AND SO COULD THE SCAN LOOP.
 *
 *   /verify-id opens the rear camera and reads QR codes off it every 300ms. Its
 *   cleanup calls stopCamera, which stops whatever is in `streamRef` and clears
 *   whatever is in `scanIntervalRef`.
 *
 *   startCamera awaits THREE TIMES before either of those refs is populated:
 *
 *       await navigator.mediaDevices.getUserMedia(...)   // the permission prompt
 *       await videoRef.current.play()
 *       await import("jsqr")                             // a network fetch
 *
 *   So the cleanup could run in the middle, find both refs empty, stop nothing —
 *   and then the rest of startCamera carried on:
 *
 *     A STREAM OBTAINED AFTER THE PAGE WENT AWAY was assigned to a ref nothing
 *     would read again. THE CAMERA LIGHT STAYS ON, on a phone, until the tab is
 *     closed. The permission prompt is exactly where a person changes their mind
 *     and navigates away, so this is not an exotic path.
 *
 *     AND A 300ms INTERVAL WAS ARMED AFTER THE UNMOUNT, drawing frames from a
 *     dead video element into a dead canvas and running a QR decoder over them,
 *     for the life of the tab.
 *
 *   The jsqr import is the widest window of the three: it is a chunk fetched
 *   over the network, on a page whose entire audience is people with unreliable
 *   connections.
 *
 *   #576 AND THE SAME IMAGE COULD NOT BE TRIED TWICE.
 *
 *   The upload path never cleared the file input's value, and a file input fires
 *   `change` only when the selection CHANGES. So after a failed read — "No QR
 *   code found", "Failed to process image", or a verification that could not
 *   reach the server — picking the very same photograph again did nothing at
 *   all. No spinner, no error, no reaction.
 *
 *   The person holding the ID card has one photograph of it.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Nothing here is a verification defect. #344 already moved the actual check
 *   to /api/qr/verify, where the key exists and the attempt is audited, and that
 *   is untouched. These are the camera and the file input around it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the catch no longer releasing the stream          KILLED (1 test)
 *     the post-import cancellation check removed         KILLED (1)
 *     the cleanup no longer setting the flag             KILLED (2)
 *     the file input value no longer cleared             KILLED (1)
 *     reword the finding comment                         SURVIVED, as intended
 *
 * ── THREE MUTANTS SURVIVED THE FIRST RUN, AND ALL THREE WERE MY FAULT ───────
 *
 *   Worth recording, because each was a different way of testing nothing:
 *
 *     A REDUNDANT GUARD. The first fix put a cancellation check straight after
 *     getUserMedia AND another after the import. Removing the first changed no
 *     outcome — the second stopped the same stream a moment later. Two guards
 *     for one rule, the shape #558 and #562 both found. The first is gone; what
 *     it was really covering (a failure AFTER the camera opened) is a case of
 *     its own now, in the catch, with its own test.
 *
 *     A TEST THAT MEASURED THE WRONG THING. The interval check asserted that no
 *     300ms interval had EVER been created — but one is created legitimately
 *     while the page is still mounted, so the assertion was about the wrong
 *     moment. It counts from the unmount now.
 *
 *     AND A VACUOUS ASSERTION. `expect(input.value).toBe('')` passes for a file
 *     input in jsdom whether or not anything cleared it. The setter is watched
 *     instead, so the claim is that the handler CLEARS it.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/verify-id',
}));

/** A stream whose tracks record whether anybody stopped them. */
function fakeStream() {
    const track = { stop: jest.fn(), kind: 'video' };
    return { stream: { getTracks: () => [track] } as any, track };
}

let releaseUserMedia: (v: any) => void = () => {};
const releaseImport: (v: any) => void = () => {};

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    (window as any).HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: jest.fn(() => new Promise((r) => { releaseUserMedia = r; })) },
    });
});

async function renderVerifyId() {
    const { default: Page } = await import('@/app/verify-id/page');
    const utils = render(<Page />);
    await act(async () => { await Promise.resolve(); });
    return utils;
}

/** Click "Start Camera" — whatever the button is labelled. */
async function startCamera(container: HTMLElement) {
    const button = Array.from(container.querySelectorAll('button'))
        .find(b => /start camera|scan/i.test(b.textContent || ''));
    if (!button) throw new Error('no start-camera button found');
    await act(async () => { button.click(); });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#575 — leaving the page stops the camera', () => {
    it('AND NO SCAN LOOP IS ARMED AFTER THE UNMOUNT', async () => {
        //   The jsqr import is a network fetch — the widest of the three
        //   windows. Without the check after it, stopCamera had already cleared
        //   an interval that did not exist yet, and then this line started one:
        //   a 300ms loop over a dead video, for the life of the tab.
        const setIntervalSpy = jest.spyOn(global, 'setInterval');

        const { container, unmount } = await renderVerifyId();
        await startCamera(container);

        const { stream, track } = fakeStream();

        /**
         *   Resolve the permission prompt and leave IN THE SAME SYNCHRONOUS
         *   BLOCK, so the rest of startCamera has not run yet.
         *
         *   The first version of this awaited an `act` around the release, which
         *   flushed far enough for the import to settle and the interval to be
         *   armed WHILE STILL MOUNTED — legitimately. It then asserted no 300ms
         *   interval had ever been created, which is a different and false
         *   claim. Counting from the moment of unmount is the claim that matters.
         */
        const armedBefore = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 300).length;
        releaseUserMedia(stream);
        unmount();

        //   Let the dynamic import and everything after it run to completion.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const armedAfter = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 300).length;
        expect(armedAfter).toBe(armedBefore);
        //   And the stream that arrived after the unmount is not left running.
        expect(track.stop).toHaveBeenCalled();

        setIntervalSpy.mockRestore();
    });

    it('AND A FAILURE AFTER THE CAMERA OPENED STILL RELEASES IT', async () => {
        //   play() and the jsqr import both run AFTER the camera is live, and
        //   either can fail. The catch used to show a message and leave the
        //   stream running — "Camera not available", with the camera on.
        (window as any).HTMLMediaElement.prototype.play = jest.fn()
            .mockRejectedValue(Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' }));

        const { container } = await renderVerifyId();
        await startCamera(container);

        const { stream, track } = fakeStream();
        await act(async () => { releaseUserMedia(stream); await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        await waitFor(() => expect(track.stop).toHaveBeenCalled());
    });

    it('A STREAM THAT ARRIVES AFTER THE UNMOUNT IS STOPPED', async () => {
        //   THE DEFECT. The permission prompt is exactly where somebody changes
        //   their mind and leaves; the stream then arrived for a component that
        //   no longer existed, and nothing held it to stop it.
        const { container, unmount } = await renderVerifyId();
        await startCamera(container);

        const { stream, track } = fakeStream();

        //   Gone, while the browser is still asking for permission.
        unmount();

        await act(async () => { releaseUserMedia(stream); await Promise.resolve(); });

        expect(track.stop).toHaveBeenCalled();
    });

    it('AND A STREAM THAT ARRIVES IN TIME IS STOPPED ON THE WAY OUT', async () => {
        //   The vacuity guard: a fix that stopped every stream immediately would
        //   make the scanner useless. This one has to survive until unmount.
        const { container, unmount } = await renderVerifyId();
        await startCamera(container);

        const { stream, track } = fakeStream();
        await act(async () => { releaseUserMedia(stream); await Promise.resolve(); });

        expect(track.stop).not.toHaveBeenCalled();

        unmount();

        expect(track.stop).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#576 — the same photograph can be tried again', () => {
    it('THE FILE INPUT IS CLEARED, SO A SECOND ATTEMPT FIRES AT ALL', async () => {
        //   A file input fires `change` only when the selection CHANGES. Leaving
        //   the value set meant a person whose first read failed could not retry
        //   with the one photograph they have of the card.
        const { container } = await renderVerifyId();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        expect(input).toBeTruthy();

        //   jsdom cannot decode an image, so the read fails — which is exactly
        //   the case the retry exists for.
        const file = new File(['not really a png'], 'id-card.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });

        /**
         *   OBSERVE THE ASSIGNMENT, NOT THE VALUE.
         *
         *   The first version of this test asserted `input.value === ''` after
         *   the change — and jsdom reports '' for a file input whose `files` was
         *   installed with defineProperty WHETHER OR NOT anything cleared it. It
         *   passed with the fix removed. A vacuous assertion, which is the exact
         *   fault this suite's own header warns about elsewhere.
         *
         *   So the setter is watched: the claim is that the handler CLEARS it.
         */
        const cleared: string[] = [];
        Object.defineProperty(input, 'value', {
            configurable: true,
            get: () => '',
            set: (v: string) => { cleared.push(v); },
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        //   THE CLAIM: cleared, so selecting the same file again is a change
        //   again.
        await waitFor(() => expect(cleared).toContain(''));
    });
});
