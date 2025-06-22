// Minimal reproduction of Kuzu ALTER TABLE getAll() hang bug
// Bug: getAll() intermittently hangs on subsequent ALTER TABLE results in batch queries
// Tested with: Kuzu 0.10.0, Node.js v22.14.0

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
  
  // Process second result - this hangs intermittently (~30-50% of the time)
  console.log('Processing result 2...');
  const rows2 = await results[1].getAll(); // <-- HANGS HERE INTERMITTENTLY
  console.log('Result 2:', rows2); // Sometimes never reached
  results[1].close();
}

reproduceBug().catch(console.error);