## Update: Bug also affects CREATE NODE TABLE statements

I've confirmed that this bug affects more than just `ALTER TABLE` statements. The same hanging behavior occurs with `CREATE NODE TABLE` statements in batch queries.

### Additional Test Case

```javascript
const kuzu = require('kuzu');

async function testCreateTableHang() {
  const db = new kuzu.Database('./test-db');
  const conn = new kuzu.Connection(db);
  
  // Execute multiple CREATE NODE TABLE statements
  const results = await conn.query(`
    CREATE NODE TABLE IF NOT EXISTS Technology (
      id SERIAL,
      name STRING,
      PRIMARY KEY(id)
    );
    
    CREATE NODE TABLE IF NOT EXISTS Repository (
      id SERIAL,
      name STRING,
      PRIMARY KEY(id)
    );
  `);
  
  console.log('Got', results.length, 'results');
  
  // First result works
  console.log('Processing result 1...');
  const rows1 = await results[0].getAll();
  console.log('Result 1:', rows1); // Output: [{ result: 'Table Technology has been created.' }]
  results[0].close();
  
  // Second result hangs
  console.log('Processing result 2...');
  const rows2 = await results[1].getAll(); // <-- HANGS HERE
  console.log('Result 2:', rows2); // Never reached
  results[1].close();
}
```

### Updated Findings

- The bug affects **all DDL statements** in batch queries, not just `ALTER TABLE`
- Tested and confirmed with:
  - `ALTER TABLE ADD column`
  - `CREATE NODE TABLE`
  - `CREATE NODE TABLE IF NOT EXISTS`
- The pattern is consistent: first DDL result works, subsequent ones hang on `getAll()`
- This explains why our MCP server was crashing when executing multiple CREATE TABLE statements

This makes the issue more significant as it affects common schema initialization patterns where multiple tables are created in a single query.