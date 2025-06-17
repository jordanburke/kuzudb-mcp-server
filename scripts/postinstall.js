#!/usr/bin/env node
/**
 * Postinstall script to ensure kuzu native binaries are properly installed
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function ensureKuzuInstalled() {
  const kuzuPath = path.join(__dirname, '..', 'node_modules', 'kuzu');
  const installScript = path.join(kuzuPath, 'install.js');
  const indexFile = path.join(kuzuPath, 'index.js');
  
  // Check if kuzu is already properly installed
  if (fs.existsSync(indexFile)) {
    console.log('✓ Kuzu is already properly installed');
    return;
  }
  
  // Check if kuzu directory exists
  if (!fs.existsSync(kuzuPath)) {
    console.log('⚠️  Kuzu package not found, skipping install');
    return;
  }
  
  // Check if install script exists
  if (!fs.existsSync(installScript)) {
    console.log('⚠️  Kuzu install script not found, skipping install');
    return;
  }
  
  try {
    console.log('🔧 Installing kuzu native binaries...');
    
    // Change to kuzu directory and run install script
    process.chdir(kuzuPath);
    execSync('node install.js', { stdio: 'inherit' });
    
    console.log('✓ Kuzu native binaries installed successfully');
  } catch (error) {
    console.error('❌ Failed to install kuzu native binaries:', error.message);
    console.error('This may cause the MCP server to fail at runtime');
    // Don't fail the entire install process
  }
}

// Only run if this is not a CI environment or if explicitly requested
if (!process.env.CI || process.env.FORCE_KUZU_INSTALL) {
  ensureKuzuInstalled();
} else {
  console.log('⏭️  Skipping kuzu install in CI environment');
}
