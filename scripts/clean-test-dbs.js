#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Clean up any test databases
const cwd = process.cwd();
const entries = fs.readdirSync(cwd, { withFileTypes: true });

const testDbs = entries
  .filter(entry => entry.isDirectory() && entry.name.startsWith('test-db-'))
  .map(entry => entry.name);

if (testDbs.length === 0) {
  console.log('No test databases found to clean up.');
} else {
  console.log(`Found ${testDbs.length} test database(s) to clean up:`);
  
  for (const testDb of testDbs) {
    try {
      fs.rmSync(path.join(cwd, testDb), { recursive: true, force: true });
      console.log(`  ✓ Removed ${testDb}`);
    } catch (error) {
      console.error(`  ✗ Failed to remove ${testDb}:`, error.message);
    }
  }
}