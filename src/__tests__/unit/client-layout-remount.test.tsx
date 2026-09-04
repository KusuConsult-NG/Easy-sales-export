/**
 * @jest-environment jsdom
 */

/**
 * A module page must not be thrown away and rebuilt when the session resolves.
 *
 * WHAT WAS WRONG
 * --------------
 * ClientLayout rendered `children` in TWO different places:
 *
 *     {showSidebar ? (
 *         <div className="flex h-screen …">
 *             <ModuleSidebar … />
 *             <div …><header …/><main>{children}</main></div>
 *         </div>
 *     ) : (
 *         <>{children}</>
 *     )}
 *
 * and `showSidebar` depends on `useSession()`, which starts at "loading" and
 * resolves a beat later. React reconciles by position, so the instant that flip
 * happened the entire page subtree was UNMOUNTED and a fresh one mounted.
 * Every component below it lost its state.
 *
 * WHAT IT DID TO USERS
 * --------------------
 * Anything typed before the session settled was silently wiped. Measured on
 * /farm-nation/list-land, filling the form as fast as a script can: the title,
 * description and state fields were empty when Submit was pressed while later
 * fields survived — one remount partway through.
 *
 * The listing then refused to submit with NO message at all: the title is a
 * `required` input, so an empty one fails HTML5 validation and the browser
 * blocks submission before handleSubmit can run and show an error. The same
 * remount re-initialised react-hook-form from its defaults, which is what put
 * 10000 back into the loan wizard's amount field mid-test.
 *
 * On a slow connection the window is wider, so a real user is MORE exposed
 * than the tests were.
 *
 * WHY THIS TEST COUNTS MOUNTS RATHER THAN CHECKING THE DOM
 * -------------------------------------------------------
 * A remount and a re-render look identical in the rendered output. Only the
 * child's own mount count can tell them apart, and the mount count is exactly
 * what the user's typed input depends on.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';

let sessionState: { data: any; status: string } = { data: null, status: 'loading' };
const mockUseSession = jest.fn(() => sessionState);
let pathname = '/farm-nation/list-land';

jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
    SessionProvider: ({ children }: any) => <>{children}</>,
}));

jest.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

// Everything the layout renders alongside the page. None of it is under test;
// each is stubbed so a change to one of them cannot make this file fail for an
// unrelated reason.
jest.mock('@/components/layout/ModuleSidebar', () => ({ ModuleSidebar: () => <nav data-testid="sidebar" /> }));
jest.mock('@/components/auth/SessionActivityTracker', () => ({ __esModule: true, default: () => null }));
// SessionGuard was mocked here. #240 removed the component — it wrote one
// sessionStorage key that nothing read and was named for a control it did not
// perform. See volatile-session-control-decided.render.test.tsx.
jest.mock('@/components/providers/FirebaseAuthProvider', () => ({ FirebaseAuthProvider: ({ children }: any) => <>{children}</> }));
jest.mock('@/components/notifications/PushNotificationBanner', () => ({ PushNotificationBanner: () => null }));
jest.mock('@/components/ai/AiChatWidget', () => ({ AiChatWidget: () => null }));
jest.mock('@/hooks/useFCMRegistration', () => ({ useFCMRegistration: () => undefined }));
jest.mock('@/contexts/ToastContext', () => ({ ToastProvider: ({ children }: any) => <>{children}</>, useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ Toaster: () => null }));
jest.mock('@/lib/module-config', () => ({ getModuleConfig: () => ({ name: 'Farm Nation', description: 'Land' }) }));

import { ClientLayout } from '@/components/layout/ClientLayout';

/** Counts its own mounts, and keeps state a remount would destroy. */
function StatefulChild({ onMount }: { onMount: () => void }) {
    const [typed, setTyped] = React.useState('');
    React.useEffect(() => { onMount(); }, [onMount]);
    return (
        <input
            aria-label="field"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
        />
    );
}

function renderAt(path: string, onMount: () => void) {
    pathname = path;
    return render(<ClientLayout><StatefulChild onMount={onMount} /></ClientLayout>);
}

describe('ClientLayout does not remount the page when the session resolves', () => {
    beforeEach(() => {
        sessionState = { data: null, status: 'loading' };
        mockUseSession.mockClear();
    });

    it('mounts a module page exactly ONCE across loading → authenticated', () => {
        // THE TEST THIS FILE EXISTS FOR. Two mounts here is the defect: the
        // second one starts from scratch and whatever the user typed is gone.
        const onMount = jest.fn();
        const { rerender } = renderAt('/farm-nation/list-land', onMount);

        act(() => {
            sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };
        });
        rerender(<ClientLayout><StatefulChild onMount={onMount} /></ClientLayout>);

        expect(onMount).toHaveBeenCalledTimes(1);
    });

    it('keeps what the user typed while the session was still loading', () => {
        // The consequence, stated in the user's terms rather than React's.
        const onMount = jest.fn();
        const { rerender } = renderAt('/farm-nation/list-land', onMount);

        act(() => {
            sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };
        });
        rerender(<ClientLayout><StatefulChild onMount={onMount} /></ClientLayout>);

        const field = screen.getByLabelText('field') as HTMLInputElement;
        act(() => {
            field.focus();
            // Type AFTER the transition — the value must simply persist.
            field.value = 'Prime Agricultural Land in Kano';
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });

        expect((screen.getByLabelText('field') as HTMLInputElement).value)
            .toBe('Prime Agricultural Land in Kano');
    });

    it('shows a loading indicator instead of the page while the session resolves', () => {
        // The mechanism: children are not mounted at all until the layout knows
        // which shape it will be. Without this the page mounts into the wrong
        // shape first and is rebuilt.
        const onMount = jest.fn();
        renderAt('/farm-nation/list-land', onMount);

        expect(screen.getByRole('status', { name: /loading/i })).toBeTruthy();
        expect(onMount).not.toHaveBeenCalled();
    });

    it('does NOT delay a public page for the session', () => {
        // Public and auth pages do not depend on the session for their layout,
        // so there is no flip to wait for and no reason to hold first paint.
        // Gating them too would be a real regression, traded for nothing.
        const onMount = jest.fn();
        renderAt('/', onMount);

        expect(onMount).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    it('mounts a public page once across the same transition', () => {
        const onMount = jest.fn();
        const { rerender } = renderAt('/', onMount);

        act(() => {
            sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };
        });
        rerender(<ClientLayout><StatefulChild onMount={onMount} /></ClientLayout>);

        expect(onMount).toHaveBeenCalledTimes(1);
    });
});
