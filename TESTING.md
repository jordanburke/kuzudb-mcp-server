# Testing Guide

## Overview

This project uses Vitest as the testing framework. The test suite includes unit tests, integration tests, and utilities tests to ensure the kuzudb-mcp-server functions correctly.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test

# Run tests once (CI mode)
pnpm test -- --run

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

## Test Structure

```
src/__tests__/
├── cli.test.ts         # Tests for CLI functionality
├── server-utils.test.ts # Tests for database operations
├── utils.test.ts       # Tests for utility functions
└── integration.test.ts # End-to-end integration tests
```

### CLI Tests (`cli.test.ts`)
- **Argument parsing**: Tests all CLI flags and options
- **Database operations**: Tests init, validate, and inspect commands
- **Output functions**: Tests help and version display
- **Template initialization**: Tests movies, social, and financial templates

### Server Utils Tests (`server-utils.test.ts`)
- **Query execution**: Tests basic queries, relationships, and aggregations
- **Schema retrieval**: Tests table info and connection retrieval
- **Error handling**: Tests syntax errors and non-existent tables
- **BigInt handling**: Tests large number serialization

### Utils Tests (`utils.test.ts`)
- **BigInt serialization**: Tests JSON serialization of BigInt values
- **Query classification**: Tests identification of read vs write queries
- **Error formatting**: Tests error message generation
- **Path handling**: Tests various database path formats

### Integration Tests (`integration.test.ts`)
- **End-to-end flows**: Tests complete command execution
- **Database initialization**: Tests template creation
- **Validation flow**: Tests database validation process
- **Help and version**: Tests CLI help output

## Test Coverage

The test suite aims for comprehensive coverage of:
- All CLI commands and options
- Database operations (create, read, validate)
- Error scenarios and edge cases
- MCP server functionality (via utils)

## Writing New Tests

When adding new features:

1. **Unit tests**: Add tests for individual functions in the appropriate test file
2. **Integration tests**: Add end-to-end tests if the feature involves multiple components
3. **Error cases**: Always test error scenarios and edge cases
4. **Mocking**: Use Vitest's mocking capabilities for external dependencies

Example test structure:
```typescript
describe('Feature Name', () => {
  it('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
  
  it('should handle errors gracefully', () => {
    expect(() => myFunction(null)).toThrow('Expected error');
  });
});
```

## CI Integration

Tests are automatically run:
- Before publishing (`prepublishOnly` script)
- In GitHub Actions CI pipeline
- With linting and type checking

## Debugging Tests

To debug a specific test:
1. Add `.only` to focus on a single test: `it.only('test name', ...)`
2. Use `console.log` for debugging output
3. Run with `--reporter=verbose` for detailed output
4. Use VS Code's Jest/Vitest extension for debugging support