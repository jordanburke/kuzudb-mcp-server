#!/usr/bin/env node

// Simple test script to verify MCP server functionality
const { spawn } = require('child_process');
const readline = require('readline');

const dbPath = process.argv[2] || './test-kuzu-db';

console.log(`Testing MCP server with database: ${dbPath}`);

// Start the MCP server
const mcp = spawn('node', ['dist/index.js', dbPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Create readline interface for interactive communication
const rl = readline.createInterface({
  input: mcp.stdout,
  output: process.stdout
});

// Handle server output
rl.on('line', (line) => {
  console.log('Server:', line);
});

mcp.stderr.on('data', (data) => {
  console.error('Error:', data.toString());
});

// Send a test request after a short delay
setTimeout(() => {
  console.log('\nSending test query request...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'query',
      arguments: {
        cypher: 'MATCH (m:Movie) RETURN m.title as title LIMIT 2'
      }
    },
    id: 1
  };
  
  mcp.stdin.write(JSON.stringify(request) + '\n');
}, 1000);

// Send schema request
setTimeout(() => {
  console.log('\nSending schema request...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'getSchema',
      arguments: {}
    },
    id: 2
  };
  
  mcp.stdin.write(JSON.stringify(request) + '\n');
}, 2000);

// Close after 5 seconds
setTimeout(() => {
  console.log('\nTest complete. Closing...');
  mcp.kill();
  process.exit(0);
}, 5000);

mcp.on('close', (code) => {
  console.log(`MCP server exited with code ${code}`);
});