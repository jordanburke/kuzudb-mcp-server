# getAll() hangs on subsequent DDL results in batch queries

## Description
When executing multiple DDL statements (ALTER TABLE, CREATE NODE TABLE, etc.) in a single batch query, the `getAll()` method hangs indefinitely on all QueryResult objects except the first one.

## Environment
- **Kuzu Version**: 0.10.0
- **Node.js Version**: v22.14.0 
- **Platform**: Linux (WSL2)
- **API**: Node.js bindings

## Minimal Reproduction

```javascript
const kuzu = require('kuzu');

async function reproduceBug() {
  const db = new kuzu.Database('./test-db');
  const conn = new kuzu.Connection(db);
  
  // Create table
  await conn.query('CREATE NODE TABLE Test(id INT64, PRIMARY KEY(id));');
  
  // Execute multiple ALTER TABLE statements
  const results = await conn.query(`
    ALTER TABLE Test ADD col1 STRING;
    ALTER TABLE Test ADD col2 STRING;
  `);
  
  console.log('Got', results.length, 'results');
  
  // Process first result - this works
  console.log('Processing result 1...');
  const rows1 = await results[0].getAll();
  console.log('Result 1:', rows1);  // Output: [{ result: 'Table Test altered.' }]
  results[0].close();
  
  // Process second result - this hangs
  console.log('Processing result 2...');
  const rows2 = await results[1].getAll(); // <-- HANGS HERE INDEFINITELY
  console.log('Result 2:', rows2); // Never reached
  results[1].close();
}

reproduceBug().catch(console.error);
```

## Expected Behavior
All QueryResult objects should allow `getAll()` to complete, either returning:
- A result message (like the first ALTER TABLE does)
- An empty array
- Or throw an appropriate error

## Actual Behavior
- First ALTER TABLE result: `getAll()` returns `[{ result: 'Table Test altered.' }]`
- Second and subsequent ALTER TABLE results: `getAll()` hangs indefinitely

## Impact
This affects any application that executes batch queries containing multiple ALTER TABLE statements. Applications must implement timeout workarounds to prevent hanging.

## Additional Information
- **The bug is intermittent** - it occurs approximately 30-50% of the time in our testing
- Single DDL statements work correctly (ALTER TABLE, CREATE NODE TABLE, etc.)
- **Confirmed**: The same issue occurs with `CREATE NODE TABLE IF NOT EXISTS` statements in batch queries
- The schema changes are successfully applied despite the hanging
- The connection remains responsive after the hang
- This affects all DDL statements (CREATE, ALTER, DROP) when executed in batch

## Workaround
Currently using Promise.race() with a timeout:
```javascript
const rows = await Promise.race([
  result.getAll(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("getAll timeout")), 5000)
  )
]);
```

## Reproduction Gist
https://gist.github.com/jordanburke/5f5838b64faa7a79b8760b758a4d12b1
