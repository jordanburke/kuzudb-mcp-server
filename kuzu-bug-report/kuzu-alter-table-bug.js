#!/usr/bin/env node

/**
 * Minimal reproduction of Kuzu ALTER TABLE bug
 * 
 * Bug: When executing multiple ALTER TABLE statements in a batch query,
 * the getAll() method hangs on all QueryResult objects except the first.
 * 
 * Requirements: 
 * - Node.js
 * - npm install kuzu
 */

const kuzu = require('kuzu');
const fs = require('fs');
const path = require('path');

async function reproduceBug() {
  const dbPath = './test-alter-bug-db';
  
  // Clean up any existing test database
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }

  console.log('Kuzu ALTER TABLE Bug Reproduction\n');
  console.log('Environment:');
  console.log(`- Node.js: ${process.version}`);
  console.log(`- Kuzu: ${kuzu.VERSION || 'version not available'}`);
  console.log(`- Platform: ${process.platform}\n`);

  try {
    // Create database and connection
    console.log('1. Creating database...');
    const db = new kuzu.Database(dbPath);
    const conn = new kuzu.Connection(db);
    console.log('✓ Database created\n');

    // Create a test table
    console.log('2. Creating test table...');
    await conn.query('CREATE NODE TABLE TestTable(id INT64, name STRING, PRIMARY KEY(id));');
    console.log('✓ Table created\n');

    // Test single ALTER TABLE (this works)
    console.log('3. Testing single ALTER TABLE...');
    const singleResult = await conn.query('ALTER TABLE TestTable ADD column1 STRING;');
    console.log('Query returned:', typeof singleResult);
    console.log('Has getAll method?', typeof singleResult.getAll === 'function');
    
    const singleRows = await singleResult.getAll();
    console.log('Result:', singleRows);
    singleResult.close();
    console.log('✓ Single ALTER TABLE works correctly\n');

    // Test multiple ALTER TABLE statements (this is where the bug occurs)
    console.log('4. Testing multiple ALTER TABLE statements in one query...');
    console.log('Executing batch query with 3 ALTER TABLE statements...\n');
    
    const batchQuery = `
      ALTER TABLE TestTable ADD column2 STRING DEFAULT 'default2';
      ALTER TABLE TestTable ADD column3 INT64;
      ALTER TABLE TestTable ADD column4 FLOAT DEFAULT 1.0;
    `;

    const results = await conn.query(batchQuery);
    console.log('Query returned:', typeof results);
    console.log('Is array?', Array.isArray(results));
    console.log('Number of results:', results.length);
    console.log('');

    // Process each result
    for (let i = 0; i < results.length; i++) {
      console.log(`Processing result ${i + 1} of ${results.length}...`);
      const result = results[i];
      
      if (!result) {
        console.log('  ERROR: Result is null/undefined');
        continue;
      }

      console.log('  Type:', typeof result);
      console.log('  Has getAll?', typeof result.getAll === 'function');
      console.log('  Has close?', typeof result.close === 'function');

      // Set a timeout to detect hanging
      const timeoutMs = 5000;
      let timedOut = false;
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`getAll() timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      try {
        console.log(`  Calling getAll() with ${timeoutMs}ms timeout...`);
        const startTime = Date.now();
        
        const rows = await Promise.race([
          result.getAll(),
          timeoutPromise
        ]);
        
        const elapsed = Date.now() - startTime;
        console.log(`  ✓ getAll() returned in ${elapsed}ms:`, rows);
        
        // Close the result
        result.close();
        console.log('  ✓ Result closed\n');
        
      } catch (error) {
        if (timedOut) {
          console.log(`  ✗ BUG DETECTED: ${error.message}`);
          console.log('  This is the bug - getAll() should not hang!\n');
          
          // Try to close the result even after timeout
          try {
            result.close();
            console.log('  Result closed after timeout\n');
          } catch (closeError) {
            console.log('  Could not close result after timeout\n');
          }
        } else {
          console.log(`  ✗ Unexpected error: ${error.message}\n`);
        }
      }
    }

    // Verify the schema changes were applied despite the bug
    console.log('5. Verifying schema changes...');
    const schemaResult = await conn.query("CALL TABLE_INFO('TestTable') RETURN *;");
    const schema = await schemaResult.getAll();
    schemaResult.close();
    
    console.log('Table columns:');
    schema.forEach(col => {
      console.log(`  - ${col.name}: ${col.type}`);
    });
    console.log('');

    // Test if connection is still responsive
    console.log('6. Testing if connection is still responsive...');
    const testResult = await conn.query('RETURN 1 as test;');
    const testRows = await testResult.getAll();
    testResult.close();
    console.log('Connection test result:', testRows);
    console.log('✓ Connection is still responsive\n');

    console.log('SUMMARY:');
    console.log('- Single ALTER TABLE statements work correctly');
    console.log('- Multiple ALTER TABLE statements in a batch query cause getAll() to hang');
    console.log('- This appears to be a bug in Kuzu\'s handling of DDL statement results');

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    // Clean up
    setTimeout(() => {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
      }
      process.exit(0);
    }, 1000);
  }
}

// Run the test
reproduceBug().catch(console.error);