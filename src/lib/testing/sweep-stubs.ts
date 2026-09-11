/**
 * The stubs every whole-app render sweep needs, in one place.
 *
 *   #622 THE SWEEPS WERE ACCUMULATING TWO HAND-MAINTAINED COPIES OF ONE LIST.
 *
 *        every-screen-shows-something-or-goes-somewhere (the client sweep) and
 *        every-server-screen-is-caught-by-something (the server one) each need
 *        the same packages stubbed for the same reason, and the list only ever
 *        grows: each new sweep discovers the next ESM dependency the hard way,
 *        as a page that "failed to load" and looks like an application defect.
 *
 *        Four have been found so far, one per sweep, and every one of them cost
 *        a round of investigation that ended "not a defect":
 *
 *          @upstash/redis          reached from lib/redis
 *          next-auth/react         reached from almost any page with a session
 *          isomorphic-dompurify    reached from the academy lesson player, which
 *                                  pulls jsdom, which pulls @exodus/bytes
 *
 *        Two hand-maintained copies of one contract is the defect this audit
 *        keeps finding. The next sweep imports this instead of rediscovering it.
 *
 *   WHY STUBS AND NOT A JEST CONFIG CHANGE. These are ESM builds that jest does
 *   not transform, and the clean fix is transformIgnorePatterns — which
 *   next/jest overwrites, so setting it means restructuring the config that 678
 *   suites load. The repository already answers this class with per-package
 *   stubs (see the `uuid` entry in jest.config.js's moduleNameMapper), and this
 *   follows that rather than inventing a second convention.
 *
 *   HOW TO USE, and the shape matters — jest.mock factories are hoisted above
 *   imports, so the module has to be pulled in lazily INSIDE the factory:
 *
 *       jest.mock('@upstash/redis', () => require('@/lib/testing/sweep-stubs').upstashRedis());
 *
 *   None of these is under test in a sweep. A sweep asks whether a screen can be
 *   reached and what it does when its data does not arrive; a page that failed
 *   because a transitive dependency would not parse answers neither question.
 */

/** lib/redis's own "not configured" path, which it already supports. */
export const libRedis = () => ({
    redis: null,
    getRedis: () => null,
    isRedisConfigured: () => false,
});

export const upstashRedis = () => ({
    Redis: class {
        async get() { return null; }
        async set() { return 'OK'; }
        async del() { return 0; }
    },
});

/**
 * A signed-in administrator.
 *
 * Deliberately the most privileged caller, so a screen is not measured as
 * "renders nothing" when the real reason is that this visitor may not see it.
 * What a screen shows to whom is asked by the permission tests, not here.
 */
export const nextAuthReact = () => ({
    useSession: () => ({
        data: { user: { id: 'sweep-user', name: 'Sweep Admin', email: 'sweep@example.com', roles: ['admin'] } },
        status: 'authenticated',
    }),
    SessionProvider: ({ children }: { children: unknown }) => children,
    signIn: jest.fn(),
    signOut: jest.fn(),
});

/** Pass-through: sanitisation is not what a render sweep is measuring. */
export const dompurify = () => ({
    __esModule: true,
    default: { sanitize: (html: string) => html },
    sanitize: (html: string) => html,
});
