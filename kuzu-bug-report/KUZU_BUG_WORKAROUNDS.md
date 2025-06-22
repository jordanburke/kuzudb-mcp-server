# Kuzu Bug Workarounds

This file tracks temporary workarounds for known Kuzu bugs. Remove these workarounds once the bugs are fixed upstream.

## 1. DDL getAll() Hang Bug

**Issue**: https://github.com/kuzudb/kuzu/issues/[PENDING - Update with actual issue number]  
**Kuzu Version Affected**: 0.10.0  
**Status**: 🔴 Active Workaround  
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