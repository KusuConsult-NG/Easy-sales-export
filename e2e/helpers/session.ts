import path from 'node:path';

/**
 * The session file global-setup wrote for a persona.
 *
 * Reused instead of signing in per test: a beforeEach login meant ~205
 * sign-ins per run, which killed the dev server partway through a run and
 * would rate-limit the suite against a production build. See
 * e2e/global-setup.ts.
 */
export function sessionFileFor(persona: string): string {
    return path.resolve(process.cwd(), '.auth', `${persona}.json`);
}
