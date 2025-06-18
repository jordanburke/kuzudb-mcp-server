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
6. **No MERGE** - Use MATCH then CREATE, or CREATE OR REPLACE
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