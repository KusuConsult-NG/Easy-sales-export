/**
 * @jest-environment jsdom
 */

/**
 *   #563 THE ACADEMY CERTIFICATES TAB WAS ALWAYS EMPTY, AND IT IS THE TAB THE
 *        SCREEN OPENS ON.
 *
 *   /dashboard/certificates fetched two endpoints on mount, and they do not
 *   answer in the same shape:
 *
 *       /api/certificates          { success, certificates }
 *       /api/academy/certificates  { success, data: { certificates }, meta }
 *
 *   The screen read `.certificates` off BOTH. So the academy half was
 *   `undefined || []` on every single load, for every learner, forever.
 *
 *   `activeTab` starts at "academy". This is not an edge case reachable after
 *   three clicks — it is what a learner sees the moment the page opens, and
 *   what they see is "no certificates yet" after finishing a course.
 *
 * ── AND THE ROUTE ABOVE IT ALREADY CARRIED A NOTE ABOUT THIS ────────────────
 *
 *   /api/academy/certificates has a comment recording #425: "THIS ASKED FOR A
 *   STATUS NOTHING WRITES, SO THE ACADEMY HALF OF EVERY LEARNER'S CERTIFICATE
 *   LIST WAS EMPTY." That was found and fixed at the endpoint. The list was
 *   still empty, because the READER was wrong too.
 *
 *   THE FIX REACHED ONE OF TWO DOORS — the defect class this audit has now hit
 *   more than a dozen times. A finding that fixes the server and never opens
 *   the screen cannot see the half it did not fix.
 *
 * ── AND WHY THE SEEDED PATH CANNOT MAKE THIS MISTAKE ────────────────────────
 *
 *   #562 converts this screen: both lists are read on the SERVER through the
 *   same shared functions the routes use, instead of the browser fetching its
 *   own application over HTTP after the page has already been rendered. The
 *   seeded path receives arrays, not two differently-enveloped JSON bodies, so
 *   there is no envelope left to read at the wrong level.
 *
 *   The unseeded fallback still parses JSON, so it is still capable of this
 *   mistake and is tested separately below.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the fallback reading `acData.certificates` again   KILLED (1 test)
 *     the seed ignored, so the client fetches            KILLED (1)
 *     the uploaded list read from the wrong level        KILLED (1)
 *     reword this header                                 SURVIVED, as intended
 *
 *   The all-or-nothing rule this page states is tested separately, in
 *   a-partial-seed-is-worse-than-none — it needed the server component itself,
 *   not a rendered client.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

const showToast = jest.fn();

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', roles: ['user'] } }, status: 'authenticated' }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/dashboard/certificates',
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }),
}));

const ACADEMY_CERT = {
    id: 'ac1',
    courseName: 'Export Documentation Essentials',
    courseId: 'c1',
    issuedAt: new Date(2026, 0, 1).toISOString(),
    source: 'academy',
};

//   `fileName`, which is what the uploaded list actually renders.
const UPLOADED_CERT = {
    id: 'up1',
    fileName: 'NAFDAC registration.pdf',
    fileUrl: 'https://example.test/cert.pdf',
    uploadedAt: new Date(2026, 0, 1).toISOString(),
};

async function renderCertificates(initial: any) {
    const { default: CertificatesClient } =
        await import('@/app/dashboard/certificates/CertificatesClient');
    render(<CertificatesClient initial={initial} />);
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#563 — the academy tab shows the certificates a learner earned', () => {
    it('THE FALLBACK READS THEM FROM WHERE THE ROUTE ACTUALLY PUTS THEM', async () => {
        //   THE DEFECT. The route replies with an envelope; before the fix this
        //   screen read the flat shape and got undefined, every time.
        (global as any).fetch = jest.fn(async (url: string) => ({
            json: async () => url === '/api/certificates'
                ? { success: true, certificates: [UPLOADED_CERT] }
                : { success: true, data: { certificates: [ACADEMY_CERT] }, meta: { cursor: null, hasMore: false } },
        }));

        await renderCertificates(null);

        expect(await screen.findByText(/Export Documentation Essentials/i)).toBeInTheDocument();
    });

    it('AND THE UPLOADED LIST IS STILL READ FLAT, BECAUSE THAT ROUTE IS FLAT', async () => {
        //   The vacuity guard, and the reason this was easy to get wrong: the
        //   two endpoints genuinely differ, so "read them the same way" is
        //   wrong in one direction whichever way you pick.
        (global as any).fetch = jest.fn(async (url: string) => ({
            json: async () => url === '/api/certificates'
                ? { success: true, certificates: [UPLOADED_CERT] }
                : { success: true, data: { certificates: [] }, meta: { cursor: null, hasMore: false } },
        }));

        await renderCertificates(null);

        //   The tab is labelled "Uploaded Docs"; /uploaded/i alone also matched
        //   nothing useful once the academy list rendered its own copy.
        const uploadedTab = await screen.findByRole('button', { name: /Uploaded Docs/i });
        await act(async () => { uploadedTab.click(); });

        expect(await screen.findByText(/NAFDAC registration/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#562 — and the server read them both before the page was sent', () => {
    it('A SEEDED SCREEN SHOWS BOTH LISTS AND FETCHES NOTHING', async () => {
        await renderCertificates({ uploaded: [UPLOADED_CERT], academy: [ACADEMY_CERT] });

        expect(await screen.findByText(/Export Documentation Essentials/i)).toBeInTheDocument();
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('AND A NULL SEED FALLS BACK TO THE ROUTES, AS BEFORE', async () => {
        //   The seed is an optimisation, never a replacement. A failed server
        //   read must leave a working screen.
        (global as any).fetch = jest.fn(async (url: string) => ({
            json: async () => url === '/api/certificates'
                ? { success: true, certificates: [UPLOADED_CERT] }
                : { success: true, data: { certificates: [ACADEMY_CERT] }, meta: { cursor: null, hasMore: false } },
        }));

        await renderCertificates(null);

        await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2));
        expect(await screen.findByText(/Export Documentation Essentials/i)).toBeInTheDocument();
    });
});
