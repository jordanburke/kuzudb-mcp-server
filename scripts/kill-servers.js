#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🔍 Looking for running Kuzu MCP servers...');

try {
  // Try to find processes listening on port 3000 and 3001
  const findProcessCommand = process.platform === 'win32' 
    ? 'netstat -ano | findstr :3000 && netstat -ano | findstr :3001'
    : "lsof -i :3000 -t 2>/dev/null; lsof -i :3001 -t 2>/dev/null";
  
  let pids = [];
  
  try {
    const output = execSync(findProcessCommand, { encoding: 'utf8' });
    if (output) {
      if (process.platform === 'win32') {
        // Parse Windows netstat output
        const lines = output.split('\n');
        lines.forEach(line => {
          const match = line.match(/\s+(\d+)\s*$/);
          if (match) {
            pids.push(match[1]);
          }
        });
      } else {
        // Unix/Linux - lsof outputs PIDs directly
        pids = output.split('\n').filter(pid => pid.trim());
      }
      
      // Remove duplicates
      pids = [...new Set(pids)];
    }
  } catch (e) {
    // No processes found
  }
  
  // Also look for node processes running our server
  try {
    const psCommand = process.platform === 'win32'
      ? 'wmic process where "name=\'node.exe\'" get processid,commandline /format:csv'
      : "ps aux | grep 'node.*dist/index.js' | grep -v grep";
    
    const psOutput = execSync(psCommand, { encoding: 'utf8' });
    
    if (process.platform === 'win32') {
      // Parse Windows wmic output
      const lines = psOutput.split('\n');
      lines.forEach(line => {
        if (line.includes('dist/index.js') || line.includes('dist\\index.js')) {
          const parts = line.split(',');
          const pid = parts[parts.length - 1]?.trim();
          if (pid && !isNaN(pid)) {
            pids.push(pid);
          }
        }
      });
    } else {
      // Unix/Linux - parse ps output
      const lines = psOutput.split('\n');
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 1) {
          pids.push(parts[1]);
        }
      });
    }
    
    // Remove duplicates again
    pids = [...new Set(pids)];
  } catch (e) {
    // No node processes found
  }
  
  if (pids.length === 0) {
    console.log('✅ No running servers found');
    process.exit(0);
  }
  
  console.log(`📍 Found ${pids.length} process(es): ${pids.join(', ')}`);
  
  // Kill the processes
  pids.forEach(pid => {
    if (!pid || isNaN(pid)) return;
    
    try {
      const killCommand = process.platform === 'win32'
        ? `taskkill /F /PID ${pid}`
        : `kill -9 ${pid}`;
      
      execSync(killCommand);
      console.log(`✅ Killed process ${pid}`);
    } catch (e) {
      console.log(`⚠️  Could not kill process ${pid} - it may have already exited`);
    }
  });
  
  console.log('🎯 All servers stopped');
  
} catch (error) {
  console.error('❌ Error stopping servers:', error.message);
  process.exit(1);
}