/**
 * @jest-environment jsdom
 */

/**
 * The first rendering tests in this repository.
 *
 * Until now no test mounted a component. 199 test files, 2,246 tests, and not
 * one import of @testing-library/react — though the library has been a
 * devDependency the whole time. Every UI assertion made during the audit was
 * reading source text.
 *
 * _columns.tsx says so itself, in its own header:
 *
 *     "There are no rendering tests in this repository. Nothing mounts a
 *      component, so a mistake in a React extraction is caught by tsc and by
 *      review, and by nothing else."
 *
 * It was extracted from a 1,456-line page in #211 and has never been rendered.
 * tsc proves the types line up; it cannot prove a cell draws the right thing,
 * that a button calls the right handler, or that a date arrives readable.
 *
 * These are cheap — jsdom, no database, no browser — and they cover the class
 * of failure that shipped repeatedly here: a component that renders "Invalid
 * Date", or crashes on a shape the server actually sends.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildUserColumns, getRoleBadge, type User } from '@/app/admin/users/_columns';

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 'user-1',
        name: 'Amaka Obi',
        email: 'amaka@example.com',
        role: 'farmer',
        isVerified: false,
        createdAt: new Date('2026-03-15T10:00:00.000Z'),
        ...overrides,
    } as User;
}

/** Render one column's cell for a user. */
function renderCell(header: string, user: User, deps: Partial<Parameters<typeof buildUserColumns>[0]> = {}) {
    const columns = buildUserColumns({
        processingId: null,
        onToggleVerification: jest.fn(),
        onManageUser: jest.fn(),
        ...deps,
    });
    const column = columns.find(c => c.header === header);
    if (!column) throw new Error(`No column with header "${header}". Headers: ${columns.map(c => c.header).join(', ')}`);
    return render(<>{column.accessor(user)}</>);
}

describe('admin users table — every column renders', () => {
    // The baseline this repository never had: mount each cell and confirm it
    // does not throw. A crash in any one of these takes the whole admin users
    // page down, and nothing before this would have noticed.
    it('renders every column without throwing', () => {
        const columns = buildUserColumns({
            processingId: null,
            onToggleVerification: jest.fn(),
            onManageUser: jest.fn(),
        });

        expect(columns.length).toBeGreaterThan(0);
        for (const column of columns) {
            expect(() => render(<>{column.accessor(makeUser())}</>)).not.toThrow();
        }
    });

    it('shows the user name and email', () => {
        renderCell('User', makeUser());
        expect(screen.getByText('Amaka Obi')).toBeInTheDocument();
        expect(screen.getByText('amaka@example.com')).toBeInTheDocument();
    });
});

describe('Joined column — date handling', () => {
    it('renders a real date for a Date', () => {
        renderCell('Joined', makeUser({ createdAt: new Date('2026-03-15T10:00:00.000Z') }));
        expect(screen.getByText(/2026/)).toBeInTheDocument();
    });

    it('renders a real date for an ISO string, which is what serializeDocs sends', () => {
        renderCell('Joined', makeUser({ createdAt: '2026-03-15T10:00:00.000Z' as any }));
        expect(screen.getByText(/2026/)).toBeInTheDocument();
    });

    it('never renders "Invalid Date" for a serialized Timestamp', () => {
        // The shape a Firestore-compat Timestamp becomes once it crosses to a
        // client component: own properties, no toDate() method. This is exactly
        // what crashed the notification bell, and formatDate in lib/utils.ts
        // does not recognise it — new Date({_seconds}) is Invalid Date.
        const serialized = { _seconds: 1773568800, _nanoseconds: 0 } as any;
        renderCell('Joined', makeUser({ createdAt: serialized }));
        expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
    });

    it('renders "N/A" rather than crashing when the date is missing', () => {
        renderCell('Joined', makeUser({ createdAt: undefined as any }));
        expect(screen.getByText('N/A')).toBeInTheDocument();
    });
});

describe('Actions column — handlers and busy state', () => {
    it('calls onToggleVerification with the user id', () => {
        const onToggleVerification = jest.fn();
        renderCell('Actions', makeUser({ id: 'user-42' }), { onToggleVerification });

        fireEvent.click(screen.getByTitle('Verify'));
        expect(onToggleVerification).toHaveBeenCalledWith('user-42');
    });

    it('offers Unverify for a verified user', () => {
        renderCell('Actions', makeUser({ isVerified: true }));
        expect(screen.getByTitle('Unverify')).toBeInTheDocument();
    });

    it('calls onManageUser with the whole user', () => {
        const onManageUser = jest.fn();
        const user = makeUser();
        renderCell('Actions', user, { onManageUser });

        fireEvent.click(screen.getByTitle('Manage Roles'));
        expect(onManageUser).toHaveBeenCalledWith(user);
    });

    it('does not let a row-level click handler also fire', () => {
        // Both buttons call stopPropagation. The table row is clickable, so
        // without it, verifying a user would also open the manage modal.
        const onRowClick = jest.fn();
        const onToggleVerification = jest.fn();
        const columns = buildUserColumns({
            processingId: null,
            onToggleVerification,
            onManageUser: jest.fn(),
        });
        const actions = columns.find(c => c.header === 'Actions')!;

        render(<div onClick={onRowClick}>{actions.accessor(makeUser())}</div>);
        fireEvent.click(screen.getByTitle('Verify'));

        expect(onToggleVerification).toHaveBeenCalled();
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it('disables only the row being processed', () => {
        const { unmount } = renderCell('Actions', makeUser({ id: 'user-1' }), { processingId: 'user-1' });
        expect(screen.getByTitle('Verify')).toBeDisabled();
        unmount();

        renderCell('Actions', makeUser({ id: 'user-1' }), { processingId: 'other-user' });
        expect(screen.getByTitle('Verify')).toBeEnabled();
    });
});

describe('KYC column — badge states', () => {
    it('marks a provided, verified NIN differently from an unverified one', () => {
        const { unmount } = renderCell('KYC', makeUser({ nin: '123', ninVerified: true }));
        expect(screen.getByTitle('NIN: Verified')).toBeInTheDocument();
        unmount();

        renderCell('KYC', makeUser({ nin: '123', ninVerified: false }));
        expect(screen.getByTitle('NIN: Pending')).toBeInTheDocument();
    });

    it('shows NIN and BVN as not provided when absent', () => {
        renderCell('KYC', makeUser());
        expect(screen.getByTitle('NIN not provided')).toBeInTheDocument();
        expect(screen.getByTitle('BVN not provided')).toBeInTheDocument();
    });

    it('only shows TIN and CAC when the user has them', () => {
        const { unmount } = renderCell('KYC', makeUser());
        expect(screen.queryByTitle('TIN')).not.toBeInTheDocument();
        expect(screen.queryByTitle('CAC')).not.toBeInTheDocument();
        unmount();

        renderCell('KYC', makeUser({ taxId: 'TIN-1', cacNumber: 'CAC-1' } as any));
        expect(screen.getByTitle('TIN')).toBeInTheDocument();
        expect(screen.getByTitle('CAC')).toBeInTheDocument();
    });
});

describe('Modules column', () => {
    it('says None when the user has no modules', () => {
        renderCell('Modules', makeUser({ activeModules: [] } as any));
        expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('lists each active module', () => {
        renderCell('Modules', makeUser({ activeModules: ['marketplace', 'academy'] } as any));
        expect(screen.getByText('marketplace')).toBeInTheDocument();
        expect(screen.getByText('academy')).toBeInTheDocument();
    });

    it('adds a count badge from two modules up, and not below', () => {
        const { unmount } = renderCell('Modules', makeUser({ activeModules: ['marketplace'], moduleCount: 1 } as any));
        expect(screen.queryByText('1')).not.toBeInTheDocument();
        unmount();

        renderCell('Modules', makeUser({ activeModules: ['marketplace', 'academy'], moduleCount: 2 } as any));
        expect(screen.getByText('2')).toBeInTheDocument();
    });
});

describe('Location column', () => {
    it('shows state and LGA together', () => {
        renderCell('Location', makeUser({ state: 'Plateau', lga: 'Jos North' } as any));
        expect(screen.getByText('Plateau, Jos North')).toBeInTheDocument();
    });

    it('shows the state alone when there is no LGA', () => {
        renderCell('Location', makeUser({ state: 'Plateau' } as any));
        expect(screen.getByText('Plateau')).toBeInTheDocument();
    });

    it('shows a dash when there is no location', () => {
        renderCell('Location', makeUser());
        expect(screen.getByText('—')).toBeInTheDocument();
    });
});

describe('getRoleBadge', () => {
    it('gives each known role its own colour', () => {
        const roles = ['admin', 'farmer', 'buyer', 'seller', 'exporter', 'vendor', 'member'];
        const classes = roles.map(getRoleBadge);
        expect(new Set(classes).size).toBe(roles.length);
    });

    it('falls back to a neutral colour for an unknown role', () => {
        expect(getRoleBadge('not-a-real-role')).toBe('bg-slate-100 text-slate-900');
    });
});
