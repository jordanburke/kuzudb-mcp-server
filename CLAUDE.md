# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

kuzudb-mcp-server is a Model Context Protocol (MCP) server that enables AI agents to interact with Kuzu graph databases. It provides tools for executing Cypher queries, retrieving schemas, and generating Kuzu-specific Cypher queries through both stdio and HTTP transports.

## Development Commands

### Building and Running
```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Development mode with watch
pnpm dev

# Quick test with auto-created database
pnpm serve:test              # stdio transport (default)
pnpm serve:test:http         # HTTP transport
pnpm serve:test:inspect      # HTTP with MCP Inspector

# Initialize databases manually
pnpm db:init                 # Create empty test database
pnpm db:init:movies          # Create database with movie data

# Type checking and linting
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
```

### Testing
```bash
# Run all tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage

# Run a single test file
pnpm test src/__tests__/query-helpers.test.ts

# Run tests matching a pattern
pnpm test -- -t "MERGE validation"

# Clean test databases
pnpm clean:test-dbs
```

### Docker Operations
```bash
# Build Docker image
docker build -t kuzu-mcp .

# Build HTTP-specific image
docker build -f Dockerfile.http -t kuzu-mcp-http .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f kuzu-mcp-http

# Check health status
docker-compose ps
```

## Architecture

### Core Module Structure

The codebase is organized into distinct modules with clear responsibilities:

1. **Entry Points**
   - `src/index.ts` - Main CLI entry point, handles command parsing and transport selection
   - `src/server-fastmcp.ts` - FastMCP HTTP server implementation
   - `src/server-core.ts` - Core database operations and connection management

2. **Connection & Recovery Layer** (`src/server-core.ts`)
   - Manages Kuzu database connections with automatic reconnection
   - Implements exponential backoff retry logic (1s, 2s, 4s delays)
   - Handles connection health monitoring and validation
   - Process-level error recovery (uncaught exceptions, unhandled rejections)

3. **Query Processing Layer**
   - `src/query-helpers.ts` - Batch query execution, error formatting, DDL detection
   - `src/merge-validation.ts` - MERGE query validation to prevent schema crashes
   - Schema caching with 5-minute TTL for performance

4. **Multi-Agent Coordination** (`src/lock-manager.ts`)
   - File-based locking for write operations
   - Automatic lock cleanup for stale processes
   - Read queries execute without locking

5. **CLI Layer** (`src/cli.ts`)
   - Database initialization with templates (movies, social, financial)
   - Path validation and inspection
   - Help and version display

### Transport Architecture

The server supports two transport modes with shared core logic:

```
┌─────────────┐     ┌──────────────┐
│ stdio Mode  │     │  HTTP Mode   │
│ (index.ts)  │     │(FastMCP/3000)│
└──────┬──────┘     └──────┬───────┘
       │                   │
       └───────┬───────────┘
               │
       ┌───────▼────────┐
       │  server-core   │
       │ - executeQuery │
       │ - getSchema    │
       │ - reconnect    │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │ Kuzu Database  │
       └────────────────┘
```

### Error Recovery Flow

Connection failures trigger automatic recovery without requiring server restart:

```
Query Request → Check Connection Health
                      ↓ (if invalid)
                 Discard Old Connection
                      ↓
                 Create New Connection
                      ↓
                 Validate Connection
                      ↓
                 Retry Query (with backoff)
                      ↓
                 Return Results or Recovery Failed Error
```

## Important Kuzu-Specific Behaviors

### MERGE Query Validation
The server validates MERGE queries before execution to prevent Kuzu crashes:
- Checks all properties exist in table schema
- Caches schema for 5 minutes
- Clears cache after DDL operations
- Suggests CREATE OR REPLACE as alternative

### DDL Timeout Workaround
Kuzu has a bug where `getAll()` hangs on DDL operations. The server implements a 5-second timeout:
```typescript
const rows = await Promise.race([
  result.getAll(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("getAll timeout")), 5000)
  )
])
```

### BigInt Serialization
Kuzu returns BigInt values that aren't JSON-serializable. All responses use a custom replacer:
```typescript
JSON.stringify(data, bigIntReplacer)
```

### Multi-Agent Lock Files
When `KUZU_MULTI_AGENT=true`, lock files are created in the database directory:
- `.mcp_write_lock` - Contains agent ID and timestamp
- Automatic cleanup after 30 seconds (stale lock detection)

## Environment Variables

| Variable | Description | Default | Impact |
|----------|-------------|---------|---------|
| `KUZU_MCP_DATABASE_PATH` | Database path if not provided as argument | - | Server startup |
| `KUZU_READ_ONLY` | Enable read-only mode | `false` | Query validation |
| `KUZU_MAX_RETRIES` | Connection recovery retry attempts | `2` | Error recovery |
| `KUZU_MULTI_AGENT` | Enable multi-agent coordination | `false` | Write locking |
| `KUZU_AGENT_ID` | Unique agent identifier | `unknown-{pid}` | Lock ownership |
| `KUZU_LOCK_TIMEOUT` | Lock acquisition timeout (ms) | `10000` | Write operations |

## Common Issues and Solutions

### Connection Issues
- **"Database connection could not be restored"** - Check database file exists and is accessible
- **"getAll timeout"** - DDL operation hung, server will retry with new connection
- **Lock timeout** - Another agent is writing, wait and retry

### Docker Health Check Failures
The healthcheck uses the `/health` endpoint. If failing:
1. Ensure server started successfully (check logs)
2. Verify port 3000 is not already in use
3. Check database mount path is correct

### MERGE Query Failures
If MERGE queries fail with "undefined properties":
1. Check table schema with `getSchema`
2. Ensure all properties in MERGE exist in schema
3. Consider using CREATE OR REPLACE instead

## Testing Strategy

Tests are organized by functionality:
- `cli.test.ts` - CLI argument parsing and commands
- `query-helpers.test.ts` - Query classification and batch execution  
- `merge-validation.test.ts` - MERGE query validation
- `lock-manager.test.ts` - Multi-agent coordination
- `integration.test.ts` - End-to-end flows
- `server-utils.test.ts` - Legacy tests (being migrated)

When adding features:
1. Add unit tests for new functions
2. Add integration tests for user-facing changes
3. Test error cases and edge conditions
4. Mock external dependencies (kuzu module)