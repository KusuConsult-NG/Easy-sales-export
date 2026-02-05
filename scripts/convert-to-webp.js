#!/usr/bin/env node

/**
 * Image Optimization Script
 * Converts PNG/JPG images to WebP format
 * 
 * Usage: node scripts/convert-to-webp.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '../public/images/platform');
const OUTPUT_DIR = path.join(__dirname, '../public/images/platform/webp');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function convertImage(filename) {
    const inputPath = path.join(IMAGE_DIR, filename);
    const outputFilename = filename.replace(/\.(png|jpg|jpeg)$/i, '.webp');
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const info = await sharp(inputPath)
            .webp({ quality: 85 })
            .toFile(outputPath);

        const inputStats = fs.statSync(inputPath);
        const reduction = ((1 - info.size / inputStats.size) * 100).toFixed(1);

        console.log(`✅ ${filename} → ${outputFilename}`);
        console.log(`   ${(inputStats.size / 1024).toFixed(1)}KB → ${(info.size / 1024).toFixed(1)}KB (${reduction}% smaller)\n`);
    } catch (error) {
        console.error(`❌ Error converting ${filename}:`, error.message);
    }
}

async function main() {
    console.log('🖼️  Converting images to WebP...\n');

    const files = fs.readdirSync(IMAGE_DIR)
        .filter(file => /\.(png|jpg|jpeg)$/i.test(file));

    if (files.length === 0) {
        console.log('No PNG/JPG images found in', IMAGE_DIR);
        return;
    }

    for (const file of files) {
        await convertImage(file);
    }

    console.log(`✅ Converted ${files.length} images to WebP format`);
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
