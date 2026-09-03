#!/usr/bin/env node

/**
 * Database seeder CLI.
 *
 * #363 FIVE REGISTERED npm SCRIPTS POINTED AT A MODULE THAT HAS NEVER EXISTED.
 *
 * This file's thirteenth line was:
 *
 *     const { seedAll, seedProducts, seedLandListings, seedWaveApplications,
 *             seedCooperatives, seedAnnouncements } = require('./seed-database');
 *
 * There is no scripts/seed-database.js, and no scripts/seed-database.ts, in
 * this repository or anywhere in its history reachable from main. `npm run
 * seed`, `seed:products`, `seed:land`, `seed:wave` and `seed:cooperatives` all
 * died on that line with "Cannot find module './seed-database'" — five of the
 * eight npm entry points #363 found that cannot run.
 *
 * This is the second time this exact defect has surfaced: scripts/seed-local.ts
 * exists because e2e/global-setup.ts called `node scripts/seed-test-users.js`
 * and `npx tsx scripts/setup-e2e-coop.ts`, neither of which existed either.
 * That one was found, fixed for e2e, and never swept for. Hence the ratchet in
 * src/__tests__/unit/npm-scripts-can-actually-run.test.ts, which now resolves
 * every script in package.json and every relative require inside them.
 *
 * WHAT THIS FILE DOES NOW
 * -----------------------
 * There is exactly one working seeder in this repository: scripts/seed-local.ts
 * (`npm run seed:local`). It seeds the fixtures the e2e suite expects, and it
 * refuses to write to anything that is not localhost unless
 * SEED_ALLOW_REMOTE=yes-seed-a-remote-database is set — a guard that exists
 * because .env.local in this repository points at the production project.
 *
 * With no argument, this script now delegates to it, so `npm run seed` seeds
 * instead of crashing, and inherits that guard.
 *
 * The per-collection arguments have no implementation to delegate to. Rather
 * than pretend, they exit non-zero naming what does exist. Seeding one
 * collection is a real thing to want; building it is a change of its own, not
 * something to invent inside a repair.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SEEDER = path.join(__dirname, 'seed-local.ts');
const KNOWN_SUBCOMMANDS = ['products', 'land', 'wave', 'cooperatives', 'announcements'];

const command = process.argv[2];

if (command) {
    const known = KNOWN_SUBCOMMANDS.includes(command);
    console.error(
        `\n❌ Per-collection seeding is not implemented.\n\n` +
        (known
            ? `   '${command}' has never worked. It called scripts/seed-database,\n`
            : `   Unknown argument '${command}'. The recognised ones (${KNOWN_SUBCOMMANDS.join(', ')})\n` +
              `   have never worked either: they called scripts/seed-database,\n`) +
        `   a module that does not exist in this repository.\n\n` +
        `   What does exist:  npm run seed:local   (scripts/seed-local.ts)\n` +
        `   It seeds every fixture at once and refuses any non-localhost database.\n`
    );
    process.exit(1);
}

console.log('Seeding via scripts/seed-local.ts (the only seeder in this repository)…\n');

const result = spawnSync('npx', ['tsx', SEEDER], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
});

if (result.error) {
    console.error(`\n❌ Could not run the seeder: ${result.error.message}\n`);
    process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
