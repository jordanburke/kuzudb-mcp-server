# Kuzu Bug Workarounds

This file tracks temporary workarounds for known Kuzu bugs. Remove these workarounds once the bugs are fixed upstream.

## UPDATE 2025-06-25: DDL Batch Bug Root Cause Fixed

The root cause of the DDL batch bug has been identified and fixed. The issue was that query results in multi-statement queries are stored in a linked-list structure, and closing the first result was causing all subsequent results to be closed. The fix involves consuming all results before closing any of them.

**Fix implemented in:**
- `src/query-helpers.ts`: processQueryResults and executeBatchQuery functions
- `src/index.ts`: getSchema function

The DDL timeout workaround has been removed as it's no longer needed.

## 1. DDL Batch Protection System (CRITICAL)

**Issue**: https://github.com/kuzudb/kuzu/issues/[PENDING]  
**Kuzu Version Affected**: 0.10.0+  
**Status**: ✅ RESOLVED - Root cause fixed 2025-06-25  
**Added**: 2025-06-22  

### Description
Multiple DDL statements in batch queries cause unrecoverable native crashes. The `getAll()` method hangs indefinitely on the 2nd+ DDL results, causing the entire Node.js process to crash at the native level.

### Protection Strategy
**Pre-query validation** blocks dangerous DDL batches before execution to prevent unrecoverable crashes.

### Workaround Locations
- **Protection Module**: `src/ddl-batch-protection.ts` (entire file)
- **Integration**: `src/index.ts:360-376`
- **Detection Tests**: `src/__tests__/ddl-batch-bug-detection.test.ts`

### Workaround Implementation
```typescript
// Pre-query validation in index.ts
const ddlAnalysis = analyzeDDLBatch(cypher)
if (ddlAnalysis.isDangerous) {
  const ddlError = createDDLBatchError(ddlAnalysis)
  return { /* Error response with splitting suggestions */ }
}
```

### Automated Fix Detection
- **CI Test**: `🚨 CRITICAL: Tests if DDL batch bug is FIXED` 
- **Detection**: Test executes known problematic query with timeout
- **Alert**: When test passes, displays celebration message in CI logs
- **Action**: CI failure will alert when workaround can be removed

### Removal Checklist ⚠️
**When test passes, remove these files/code:**
- [ ] Delete `src/ddl-batch-protection.ts` entirely
- [ ] Remove validation from `src/index.ts:360-376`
- [ ] Remove import in `src/index.ts:20`
- [ ] Delete `src/__tests__/ddl-batch-bug-detection.test.ts`
- [ ] Update CLAUDE.md to remove DDL batch protection docs
- [ ] Mark this section as RESOLVED

## 2. DDL getAll() Hang Bug (Backup Protection)

**Issue**: https://github.com/kuzudb/kuzu/issues/[PENDING - Update with actual issue number]  
**Kuzu Version Affected**: 0.10.0  
**Status**: ✅ RESOLVED - Root cause fixed 2025-06-25  
**Added**: 2024-06-22  

### Description
When executing multiple DDL statements (ALTER TABLE, CREATE NODE TABLE, etc.) in a batch query, the `getAll()` method hangs indefinitely on all QueryResult objects except the first one.

### Workaround Location
- **File**: `src/query-helpers.ts`
- **Lines**: 154-173
- **Function**: `executeBatchQuery()`

### Workaround Implementation
```typescript
// Add timeout for getAll() to prevent hanging on certain DDL operations
const rows = await Promise.race([
  result.getAll(),
  new Promise<Record<string, unknown>[]>((_, reject) =>
    setTimeout(() => reject(new Error("getAll timeout")), 5000),
  ),
]).catch((err) => {
  if (isDDL) {
    return [] // Return empty array for DDL timeouts
  }
  throw err
})
```

### Test Coverage
- Integration tests: `src/__tests__/kuzu-ddl-bug-workaround.test.ts`
- Tests verify the workaround prevents hanging for:
  - Multiple ALTER TABLE statements
  - Multiple CREATE NODE TABLE statements
  - Mixed DDL/DML batches

### Removal Checklist
When Kuzu fixes this bug:
- [ ] Verify fix in Kuzu release notes
- [ ] Update minimum Kuzu version in package.json
- [ ] Remove timeout workaround from `query-helpers.ts`
- [ ] Remove integration tests in `kuzu-ddl-bug-workaround.test.ts`
- [ ] Update this tracking document
- [ ] Run full test suite to ensure nothing breaks

### Related Code Comments
Search for: "DDL statement", "getAll timeout", "Kuzu bug"