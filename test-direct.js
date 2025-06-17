#!/usr/bin/env node

// Test script to debug Kuzu MCP server query functionality using direct node execution
const { spawn } = require('child_process');
const path = require('path');

// Start the MCP server using direct node execution
const serverPath = path.join(__dirname, 'dist', 'index.js');
const serverProcess = spawn('node', [serverPath, 'E:/kuzu/mydb'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Handle server output
serverProcess.stdout.on('data', (data) => {
  console.log('Server stdout:', data.toString());
});

serverProcess.stderr.on('data', (data) => {
  console.error('Server stderr:', data.toString());
});

serverProcess.on('error', (error) => {
  console.error('Failed to start server:', error);
});

// Wait for server to initialize
setTimeout(() => {
  console.log('\nSending query request...\n');
  
  // Send a query request
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'query',
      arguments: {
        cypher: 'MATCH (p:Person) RETURN p.name LIMIT 5'
      }
    },
    id: 1
  };
  
  serverProcess.stdin.write(JSON.stringify(request) + '\n');
  
  // Also test getSchema
  setTimeout(() => {
    console.log('\nSending getSchema request...\n');
    const schemaRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'getSchema',
        arguments: {}
      },
      id: 2
    };
    
    serverProcess.stdin.write(JSON.stringify(schemaRequest) + '\n');
  }, 1000);
  
}, 2000);

// Exit after 5 seconds
setTimeout(() => {
  console.log('\nKilling server process...');
  serverProcess.kill();
  process.exit(0);
}, 5000);
