#!/usr/bin/env node

/**
 * Firestore Seeder CLI
 * 
 * Usage:
 *   npm run seed              # Seed all collections
 *   npm run seed:products     # Seed only products
 *   npm run seed:land         # Seed only land listings
 *   npm run seed:wave         # Seed only WAVE applications
 */

const { seedAll, seedProducts, seedLandListings, seedWaveApplications, seedCooperatives, seedAnnouncements } = require('./seed-database');

const command = process.argv[2];

async function main() {
    switch (command) {
        case 'products':
            await seedProducts();
            break;
        case 'land':
            await seedLandListings();
            break;
        case 'wave':
            await seedWaveApplications();
            break;
        case 'cooperatives':
            await seedCooperatives();
            break;
        case 'announcements':
            await seedAnnouncements();
            break;
        default:
            await seedAll();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Seeding failed:', error);
        process.exit(1);
    });
