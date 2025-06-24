# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables Claude to interact with Kuzu graph databases. The server provides tools for executing Cypher queries and retrieving database schemas, along with prompts for generating Kuzu-specific Cypher queries.

## Architecture

### Core Components

- **MCP Server** (`src/index.ts`): TypeScript implementation using `@modelcontextprotocol/sdk`
- **Database Connection**: Uses the `kuzu` NPM package to connect to local Kuzu databases
- **Transport**: Communicates via stdio with Claude Desktop
- **Build System**: Uses tsup for building TypeScript to JavaScript

### Tools Provided

1. **query**: Execute Cypher queries on the database
   - Input: `query` (string) - The Cypher query to execute
   - Returns: Query results as JSON objects
   - Respects read-only mode when `KUZU_READ_ONLY=true`

2. **getSchema**: Retrieve database schema
   - No inputs required
   - Returns: Lists of node and relationship schemas with properties

### Prompts Provided

1. **generateKuzuCypher**: Generate Kuzu-specific Cypher queries from natural language
   - Uses detailed prompt engineering with Kuzu-specific Cypher rules
   - Includes comprehensive examples and edge case handling

## Connection Recovery and Error Handling

The server includes robust connection recovery features to handle database connection failures:

### Recovery Behavior
- **Retry Attempts**: Configurable via `KUZU_MAX_RETRIES` environment variable (default: 2)
- **Exponential Backoff**: 1s, 2s, 4s delays (capped at 5s) between reconnection attempts
- **Connection Health Checks**: Automatic validation before query execution
- **Automatic Reconnection**: Creates new database connections when failures are detected

### Environment Variables for Recovery
```bash
# Maximum retry attempts for connection errors (default: 2)
export KUZU_MAX_RETRIES=3

# Other existing variables
export KUZU_READ_ONLY=true
export KUZU_MULTI_AGENT=true
export KUZU_AGENT_ID=agent-1
export KUZU_LOCK_TIMEOUT=10000
```

### Error Types Handled
- Connection errors (`Connection`, `Database`, `closed`)  
- DDL timeout errors (`getAll timeout`)
- Process-level exceptions (uncaught/unhandled)

When all recovery attempts are exhausted, the LLM receives a clear `CONNECTION_RECOVERY_FAILED` error with retry count and suggested actions.

## Development Workflow

### Setup
```bash
pnpm install
```

### Build
```bash
pnpm run build
```

### Development
```bash
# Watch mode for development
pnpm run dev

# Type checking
pnpm run typecheck

# Linting
pnpm run lint
pnpm run lint:fix

# Formatting
pnpm run format
pnpm run format:check
```

### Running the Server
```bash
# Build first
pnpm run build

# With database path as argument
node dist/index.js /path/to/database

# Using environment variable
export KUZU_MCP_DATABASE_PATH=/path/to/database
pnpm start

# Read-only mode
export KUZU_READ_ONLY=true
node dist/index.js /path/to/database
```

### Docker Usage
```bash
# Build
docker build -t kuzu-mcp .

# Run with mounted database
docker run -v /path/to/database:/database kuzu-mcp
```

## Important Kuzu-Specific Cypher Rules

When working with Cypher queries in this codebase, these Kuzu-specific differences from Neo4j must be followed:

1. **No CREATE INDEX** - Kuzu doesn't support index creation via Cypher
2. **LOAD FROM** instead of LOAD CSV - Use `LOAD FROM '/path/file.csv' ...`
3. **No WHERE on CREATE** - Use separate MATCH/WHERE then CREATE
4. **Primary keys required** - All node tables need PRIMARY KEY defined
5. **SERIAL for auto-increment** - Use SERIAL data type, not AUTO_INCREMENT
6. **Limited MERGE support** - MERGE works but with strict requirements:
   - All properties in MERGE must be predefined in the table schema
   - Properties not in schema will cause server crashes
   - Server validates MERGE queries to prevent crashes
   - Consider using CREATE OR REPLACE for updates instead
7. **CREATE OR REPLACE** - Kuzu-specific for upsert operations
8. **No variable-length paths in CREATE** - Only in MATCH clauses
9. **LIST() not COLLECT()** - Use LIST() for aggregation
10. **RETURN * includes internal IDs** - May include _id and _label
11. **Copy FROM for bulk load** - Use `COPY User FROM '/path/users.csv'`
12. **Header in CSV required** - CSV files must have headers matching properties
13. **No SET on non-existent properties** - Property must be in table schema
14. **Table names are case-sensitive**
15. **CALL for CSV with headers** - Use `CALL ... IN TRANSACTIONS`
16. **No property existence check** - Use `CASE WHEN` for conditionals

### MERGE Query Validation

The server includes automatic MERGE query validation to prevent crashes:
- Validates all properties exist in the table schema before execution
- Provides clear error messages listing undefined properties
- Suggests alternative patterns (CREATE OR REPLACE, MATCH/CREATE)
- Caches schema information for performance (5-minute TTL)
- Clears cache after DDL operations automatically

Example of a problematic MERGE that will be caught:
```cypher
// This will fail validation if 'salary' is not in Person table schema
MERGE (p:Person {name: 'John'})
SET p.salary = 100000
```

Suggested alternatives:
```cypher
// Option 1: Use CREATE OR REPLACE
CREATE OR REPLACE (p:Person {name: 'John', salary: 100000})

// Option 2: Use MATCH then CREATE
MATCH (p:Person {name: 'John'})
SET p.salary = 100000
```

## Code Standards

### TypeScript
- Strict mode enabled in `tsconfig.json`
- No use of `any` type - use `unknown` or proper type definitions
- Explicit return types for functions
- Proper type guards for narrowing union types

### Error Handling
- Always wrap database operations in try-catch blocks
- Use descriptive error messages that indicate the operation that failed
- Include query details in error responses for debugging

### BigInt Handling
- The codebase includes a custom JSON serializer for BigInt values:
  ```typescript
  const bigIntReplacer = (_: string, value: unknown): unknown => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
  ```

### Connection Management
- Database connection is established once at server startup
- Connection errors result in server exit with error code 1
- Always check connection status before operations

### Code Quality
- ESLint configured with TypeScript rules
- Prettier for consistent code formatting
- Pre-publish build step ensures code is compiled

## Testing Queries

When testing the MCP server:
1. Start with `getSchema` to understand the database structure
2. Use simple queries first (e.g., `MATCH (n) RETURN n LIMIT 5`)
3. Test both read and write operations (if not in read-only mode)
4. Verify BigInt handling with large numeric values

## Claude Desktop Integration

Configure in Claude Desktop settings:
```json
{
  "command": "node",
  "args": ["/path/to/dist/index.js", "/path/to/database"],
  "env": {
    "KUZU_READ_ONLY": "true"
  }
}
```

## Debugging Tips

- Check server console output for connection and query execution logs
- Database path issues are the most common problem
- Ensure Kuzu database version compatibility with the NPM package
- For permission issues, verify read-only mode is properly set

## Security Considerations

- **Read-only mode**: Always use `KUZU_READ_ONLY=true` for untrusted environments
- **Path validation**: The server trusts the provided database path
- **Query validation**: No built-in query sanitization - relies on Kuzu's parser

## Performance Notes

- All query results are loaded into memory before returning
- Large result sets may cause memory issues
- No pagination support currently implemented
- Schema retrieval queries full catalog tables