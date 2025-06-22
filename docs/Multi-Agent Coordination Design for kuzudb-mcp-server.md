# Multi-Agent Coordination Design for kuzudb-mcp-server

## Overview

This document outlines the design for enabling multiple AI agents to safely share persistent memory through a single Kuzu database instance. The solution addresses Kuzu's single-writer limitation while maintaining the existing MCP interface.

## Problem Statement

Currently, kuzudb-mcp-server supports only a single agent at a time due to Kuzu's single-writer architecture. To enable multiple agents (e.g., Claude Desktop and Claude Code) to share persistent memory, we need a coordination mechanism that:

- Maintains data consistency
- Prevents write conflicts
- Handles process failures gracefully
- Requires no changes to existing agent code

## Solution: Transparent File-Based Write Coordination

### Core Approach

Implement automatic, transparent write coordination using file-based locking. This approach:
- Is completely transparent to agents - no API changes required
- Uses the local filesystem for coordination (suitable for local npx deployment)
- Provides automatic failure recovery
- Can be optionally enabled via configuration

### Lock File Structure

```typescript
interface WriteLock {
  processId: number;
  agentId: string;        // "claude-desktop", "claude-code", etc.
  timestamp: number;      // Lock acquisition time
  heartbeat: number;      // Last heartbeat update
  timeout: number;        // Lock expiration time
}
```

**Lock File Location:** `{database_path}/.mcp_write_lock`

### Lock Management

#### Acquisition Strategy
1. **Query Classification**: Automatically detect mutations using Cypher analysis
    - Mutations: `CREATE`, `MERGE`, `SET`, `DELETE`, `DROP`, `ALTER`
    - Reads: `MATCH`, `RETURN` (no coordination needed)

2. **Lock Acquisition**:
   ```typescript
   async function acquireWriteLock(agentId: string, timeoutMs = 10000): Promise<WriteLock>
   ```
    - Default timeout: **10 seconds** (based on performance testing)
    - Check for existing locks and validate them
    - Acquire new lock if available
    - Throw clear error if unavailable

3. **Transparent Integration**:
   ```typescript
   async function executeQuery(cypher: string) {
     const isMutation = detectMutation(cypher);
     
     if (isMutation && multiAgentMode) {
       const lock = await acquireWriteLock(agentId);
       try {
         return await kuzu.query(cypher);
       } finally {
         await releaseLock(lock);
       }
     } else {
       return await kuzu.query(cypher); // Reads are immediate
     }
   }
   ```

#### Failure Recovery

**Stale Lock Detection:**
- Locks expire after 10 seconds by default
- Process ID validation: Check if lock holder is still running
- Heartbeat validation: Locks must be refreshed every 5 seconds
- Automatic cleanup of stale locks

**Recovery Process:**
```typescript
async function isLockStale(lock: WriteLock): Promise<boolean> {
  // Check if lock has expired
  if (Date.now() - lock.timestamp > lock.timeout) return true;
  
  // Check if process is still alive
  try {
    process.kill(lock.processId, 0); // Doesn't actually kill, just checks existence
    return false;
  } catch {
    return true; // Process doesn't exist
  }
}
```

### Configuration

#### Environment Variables
- `KUZU_MULTI_AGENT=true` - Enable multi-agent coordination
- `KUZU_AGENT_ID=string` - Agent identifier (defaults to "unknown-{pid}")
- `KUZU_LOCK_TIMEOUT=number` - Lock timeout in milliseconds (default: 10000)

#### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "npx",
      "args": ["kuzudb-mcp-server", "/path/to/database"],
      "env": {
        "KUZU_MULTI_AGENT": "true",
        "KUZU_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

#### Claude Code Configuration
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "npx", 
      "args": ["kuzudb-mcp-server", "/path/to/database"],
      "env": {
        "KUZU_MULTI_AGENT": "true",
        "KUZU_AGENT_ID": "claude-code"
      }
    }
  }
}
```

### Error Handling

#### Lock Acquisition Failures
```typescript
class LockTimeoutError extends Error {
  constructor(currentHolder: string, timeRemaining: number) {
    super(`Database locked by ${currentHolder}, estimated time remaining: ${timeRemaining}ms`);
  }
}
```

#### Agent Experience
- **Successful operation**: No change in behavior
- **Lock timeout**: Clear error message with retry suggestion
- **Process failure**: Automatic recovery, brief delay possible

### Performance Characteristics

Based on testing with the current implementation:
- Simple operations (single MERGE): ~milliseconds
- Complex multi-step operations: <1 second
- Lock acquisition overhead: ~1-5ms
- Network/filesystem latency: Primary variable

**Timeout Justification:**
- 10-second default provides 10x safety margin over observed operation times
- Accounts for system variability and future growth
- Short enough to provide responsive error feedback

### Implementation Plan

#### Phase 1: Core Lock Implementation
1. Add lock file management utilities
2. Implement mutation detection
3. Add transparent lock acquisition to query execution
4. Basic stale lock detection

#### Phase 2: Enhanced Recovery
1. Process validation
2. Heartbeat system
3. Comprehensive error messages
4. Configuration options

#### Phase 3: Monitoring & Optimization
1. Lock contention metrics
2. Performance monitoring
3. Timeout tuning based on real usage
4. Optional lock extension for long operations

### Testing Strategy

#### Unit Tests
- Lock acquisition/release
- Stale lock detection
- Process validation
- Mutation detection

#### Integration Tests
- Multiple agent simulation
- Process failure scenarios
- Lock timeout handling
- Performance benchmarks

#### Manual Testing
- Claude Desktop + Claude Code coordination
- Process crash recovery
- Lock contention behavior

### Future Considerations

#### Scaling Beyond Local
If remote deployment becomes necessary:
- Replace file locks with Redis/database-based coordination
- Add network failure handling
- Implement distributed lock management

#### Performance Optimization
- Lock-free reads optimization
- Batch operation support
- Dynamic timeout adjustment

#### Monitoring
- Lock wait time metrics
- Contention frequency tracking
- Agent activity monitoring

## Success Metrics

- **Zero data corruption**: No lost updates or inconsistent state
- **Transparent operation**: Agents require no code changes
- **Fast recovery**: <30 seconds from process failure to resumed operation
- **Low latency**: <10ms overhead for coordinated operations
- **Clear feedback**: Meaningful error messages for lock conflicts

## Conclusion

This design provides a robust, transparent solution for multi-agent coordination that maintains the simplicity of the current MCP interface while safely enabling shared persistent memory across multiple AI agents. The file-based approach is well-suited for local development scenarios and provides a foundation for future distributed coordination if needed.