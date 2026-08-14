/**
 * Registers @testing-library/jest-dom's matchers with TypeScript.
 *
 * jest.setup.js imports the library, so the matchers exist at runtime — but
 * nothing told the compiler, and `npx tsc --noEmit` is a required CI step.
 * Without this, the first test to call toBeInTheDocument(), toBeDisabled() or
 * toHaveTextContent() fails the type-check with
 *
 *     TS2339: Property 'toBeInTheDocument' does not exist on type
 *     'JestMatchers<HTMLElement>'
 *
 * The library has been a devDependency for as long as the repository has
 * existed and no test had ever imported it, so this never came up until the
 * first rendering test was written.
 *
 * Declared here rather than in a single test file so every future rendering
 * test inherits it.
 */

/// <reference types="@testing-library/jest-dom" />

export {};
