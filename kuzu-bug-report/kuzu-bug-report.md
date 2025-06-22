# Bug Report: getAll() Hangs on Subsequent ALTER TABLE Results in Batch Queries

## Summary
When executing multiple ALTER TABLE statements in a single batch query, the `getAll()` method hangs indefinitely on all QueryResult objects except the first one. This forces applications to implement timeout workarounds to prevent hanging.

## Environment
- **Kuzu Version**: 0.10.0 (confirmed)
- **Node.js Version**: v22.14.0 (also tested on other versions)
- **Platform**: Linux (WSL2), but likely affects all platforms
- **API**: Node.js Kuzu bindings

## Steps to Reproduce

1. Install Kuzu: `npm install kuzu`
2. Run the provided test script: `node kuzu-alter-table-bug.js`

## Expected Behavior
All QueryResult objects from a batch query should allow `getAll()` to complete successfully, returning appropriate results or empty arrays for DDL statements.

## Actual Behavior
- First ALTER TABLE result: `getAll()` returns successfully with `[{ result: 'Table TestTable altered.' }]`
- Subsequent ALTER TABLE results: `getAll()` hangs indefinitely, never returning or throwing
- **Confirmed**: Running `test-alter-hang.js` demonstrates the hang occurs on the 2nd result's `getAll()` call

## Minimal Reproduction Code

```javascript
const kuzu = require('kuzu');

async function reproduceBug() {
  const db = new kuzu.Database('./test-db');
  const conn = new kuzu.Connection(db);
  
  // Create test table
  await conn.query('CREATE NODE TABLE TestTable(id INT64, name STRING, PRIMARY KEY(id));');
  
  // Single ALTER TABLE works fine
  const singleResult = await conn.query('ALTER TABLE TestTable ADD column1 STRING;');
  const singleRows = await singleResult.getAll(); // Works: returns []
  singleResult.close();
  
  // Multiple ALTER TABLE statements cause hanging
  const batchQuery = `
    ALTER TABLE TestTable ADD column2 STRING DEFAULT 'default2';
    ALTER TABLE TestTable ADD column3 INT64;
    ALTER TABLE TestTable ADD column4 FLOAT DEFAULT 1.0;
  `;
  
  const results = await conn.query(batchQuery); // Returns array of 3 QueryResult objects
  
  // Process each result
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    console.log(`Processing result ${i + 1}...`);
    
    try {
      // First result works, subsequent results hang here
      const rows = await result.getAll(); 
      console.log('Success:', rows);
    } catch (error) {
      console.log('Error:', error);
    }
    
    result.close();
  }
}
```

## Full Test Script
See attached `kuzu-alter-table-bug.js` for a complete test script with timeout detection.

## Impact
This bug affects any application that:
1. Executes batch queries containing multiple ALTER TABLE statements
2. Needs to process results from all statements in the batch
3. Cannot use individual query execution as a workaround

## Current Workaround
We've implemented a timeout-based workaround in our MCP server:

```javascript
const rows = await Promise.race([
  result.getAll(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("getAll timeout")), 5000)
  )
]).catch((err) => {
  if (isDDL) {
    return []; // Return empty array for DDL timeouts
  }
  throw err;
});
```

## Additional Notes
1. The ALTER TABLE statements are successfully executed (schema changes are applied)
2. The connection remains responsive after the hanging occurs
3. Only affects ALTER TABLE in batch queries; other DDL statements not tested
4. Single ALTER TABLE statements work correctly
5. The issue appears to be with how Kuzu handles multiple DDL results in a batch

## Suggested Fix
The QueryResult objects for DDL statements should either:
1. Return empty arrays immediately from `getAll()`
2. Return a status message (as they do for single DDL queries)
3. Throw an appropriate error if results cannot be retrieved

## References
- Related code in kuzu-mcp-server: `src/query-helpers.ts` lines 156-173
- Test reproduction script: `kuzu-alter-table-bug.js`