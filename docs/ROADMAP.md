# kuzudb-mcp-server Roadmap

**Date**: 2025-09-02  
**Document Version**: 1.0  
**Last Updated**: September 2, 2025  
**Project Version**: 0.11.10  

This document consolidates all planned improvements, active TODOs, and future enhancements for the kuzudb-mcp-server project. It serves as the central planning document for project evolution from a basic MCP server to a sophisticated AI memory system.

## 🚨 Critical Bug Tracking

### 1. Kuzu DDL Batch Bug (RESOLVED ✅)
- **Status**: Fixed 2025-06-25 - Root cause identified and resolved
- **Issue**: DDL batch queries caused unrecoverable native crashes
- **Root Cause**: Query results in linked-list structure; closing first result closed all subsequent results
- **Solution**: Fixed result consumption order in `processQueryResults()` and `executeBatchQuery()`
- **Files Fixed**: `src/query-helpers.ts`, `src/index.ts`
- **Cleanup Needed**: Remove workaround code when test validation confirms fix stability

### 2. Automated Bug Detection System
- **Active**: CI tests detect when upstream Kuzu bugs are fixed
- **Test File**: `src/__tests__/kuzu-ddl-bug-workaround.test.ts`
- **Mechanism**: When tests start failing, it indicates bugs are fixed upstream
- **Action**: Monitor CI for celebration messages indicating workarounds can be removed
- **Reference**: See `kuzu-bug-report/KUZU_BUG_WORKAROUNDS.md` for detailed tracking

## 🔧 Active TODOs in Codebase

### Web Server & API Enhancements
**Priority**: Medium  
**Estimated Effort**: 2-3 days  

| File | Line | Description | Impact |
|------|------|-------------|---------|
| `src/web-server.ts` | 130 | Get version from package.json dynamically | Maintenance |
| `src/web-server.ts` | 404 | Create ZIP file export functionality | Feature |
| `src/web-server.ts` | 444 | Extract ZIP and implement full restore with multipart upload | Feature |
| `src/server-fastmcp.ts` | 955 | Create ZIP of exported files | Feature |
| `src/server-fastmcp.ts` | 991 | Implement full restore functionality with multipart upload | Feature |

### Debug & Logging Cleanup
**Priority**: Low  
**Estimated Effort**: 1 hour  

| File | Lines | Description | Impact |
|------|-------|-------------|---------|
| `src/server-core.ts` | 201-204 | Remove debug console.error statements for production | Production readiness |

## 📋 Documented Enhancement Roadmaps

### Batch Query System Future Enhancements
**Source**: `docs/batch-query-improvements.md`  
**Priority**: Medium-High  
**Estimated Effort**: 2-3 weeks  

1. **Composite Primary Key Support**
   - **Dependency**: Requires Kuzu engine updates
   - **Impact**: Enable complex entity relationships
   - **Status**: Blocked on upstream

2. **Transaction Control**
   - **Description**: Add explicit BEGIN/COMMIT support
   - **Impact**: Improved data consistency guarantees
   - **Estimated Effort**: 3-5 days

3. **Query Validation**
   - **Description**: Pre-flight syntax checking without execution
   - **Impact**: Better error handling and user experience
   - **Estimated Effort**: 2-3 days

4. **Bulk Import Operations**
   - **Description**: Optimized CSV/JSON import functionality
   - **Impact**: Performance improvement for large datasets
   - **Estimated Effort**: 1 week

5. **Connection Pooling**
   - **Description**: Support for concurrent operations
   - **Impact**: Scalability and performance
   - **Estimated Effort**: 1-2 weeks

### OAuth E2E Testing Improvements
**Source**: `tests/e2e/README.md`  
**Priority**: Medium  
**Estimated Effort**: 1 week  

1. **Session Management**
   - **Description**: Implement proper FastMCP session establishment after OAuth login
   - **Impact**: Better authentication flow integration

2. **Token Refresh Flow**
   - **Description**: Add comprehensive tests for refresh token mechanisms
   - **Impact**: Improved security and user experience

3. **Error Message Consistency**
   - **Description**: Standardize error responses (use 401 for auth failures)
   - **Impact**: Better API consistency

4. **Password Grant Support**
   - **Description**: Consider adding password grant for programmatic access
   - **Impact**: Enhanced integration capabilities

## 🤖 Agentic Memory System Enhancements

### Phase 1: Core Memory Schema
**Priority**: High  
**Estimated Effort**: 2-3 weeks  
**Impact**: Foundation for AI memory capabilities  

#### New Node Types
```cypher
// Conversation tracking
CREATE NODE TABLE Conversation(
    id UUID, 
    created_date DATE, 
    context STRING, 
    summary STRING, 
    participant_count INT64,
    topic STRING,
    PRIMARY KEY(id)
);

// Explicit memory fragments
CREATE NODE TABLE Memory(
    id UUID, 
    content STRING, 
    importance_score FLOAT, 
    embedding FLOAT[],
    memory_type STRING,
    created_date DATE,
    last_accessed DATE,
    access_count INT64,
    PRIMARY KEY(id)
);

// Context clustering
CREATE NODE TABLE Context(
    id UUID, 
    topic STRING, 
    semantic_cluster STRING,
    relevance_score FLOAT,
    created_date DATE,
    PRIMARY KEY(id)
);

// Decision tracking
CREATE NODE TABLE Decision(
    id UUID, 
    reasoning STRING, 
    outcome STRING, 
    confidence_level FLOAT,
    decision_type STRING,
    created_date DATE,
    PRIMARY KEY(id)
);
```

#### New Relationships
```cypher
// Entity-conversation links
CREATE REL TABLE DISCUSSED_IN(
    FROM Person TO Conversation, 
    mentioned_at DATE,
    sentiment STRING,
    context_relevance FLOAT
);

CREATE REL TABLE REFERENCED_BY(
    FROM Project TO Conversation, 
    relevance_score FLOAT,
    mention_count INT64
);

// Decision influence tracking
CREATE REL TABLE INFLUENCED_BY(
    FROM Decision TO Conversation, 
    influence_weight FLOAT,
    reasoning_path STRING
);

// Semantic similarity
CREATE REL TABLE SIMILAR_TO(
    FROM Memory TO Memory, 
    similarity_score FLOAT,
    similarity_type STRING
);

// Context relationships
CREATE REL TABLE HAS_CONTEXT(
    FROM Conversation TO Context,
    context_strength FLOAT
);
```

### Phase 2: Semantic Search Integration
**Priority**: High  
**Estimated Effort**: 3-4 weeks  
**Dependencies**: Phase 1 complete  

#### Vector Embedding Support
- **Add embedding properties**: `embedding FLOAT[]` to Person, Project, Task, Memory nodes
- **Similarity functions**: Implement cosine similarity, euclidean distance
- **Embedding generation**: Integration with OpenAI/local embedding models
- **Vector indexing**: Optimize vector search performance

#### Context-Aware Retrieval
- **Smart memory retrieval**: Based on conversation context and semantic similarity
- **Relevance scoring**: Dynamic importance calculation based on recency, access patterns, and semantic relevance
- **Context windows**: Time-based and topic-based memory filtering

#### Implementation Tasks
1. **Add vector support to existing schema**
2. **Implement similarity calculation functions**
3. **Create context-aware query generation**
4. **Add embedding generation pipeline**
5. **Optimize vector search performance**

### Phase 3: Temporal Intelligence
**Priority**: Medium-High  
**Estimated Effort**: 2-3 weeks  
**Dependencies**: Phase 2 complete  

#### Memory Aging System
- **Importance decay**: Automatic reduction of memory importance over time
- **Access pattern learning**: Improve relevance based on usage patterns
- **Recency bias**: Weight recent interactions higher in relevance calculations

#### Temporal Query Enhancement
- **Time-window queries**: Retrieve memories from specific time periods
- **Temporal relationship analysis**: Track how relationships evolve over time
- **Predictive relevance**: Predict memory relevance based on temporal patterns

### Phase 4: Advanced Query Intelligence
**Priority**: Medium  
**Estimated Effort**: 2-3 weeks  
**Dependencies**: Phase 3 complete  

#### Context-Aware Query Generation
- **Conversation flow analysis**: Generate queries based on discussion context
- **Entity auto-completion**: Smart completion for names and relationships
- **Pattern recognition**: Identify and reuse common query patterns

#### Query Optimization
- **Template library**: Pre-built queries for common agentic memory operations
- **Performance caching**: Intelligent caching of frequent memory access patterns
- **Batch optimization**: Optimize multiple related queries

## 🛠️ Development Infrastructure Improvements

### Schema Evolution Support
**Priority**: Medium  
**Estimated Effort**: 1-2 weeks  

#### Features
- **Migration tools**: Safe schema updates without data loss
- **Version tracking**: Maintain history of schema changes
- **Dynamic extensions**: Runtime relationship type creation
- **Backward compatibility**: Handle schema evolution gracefully

#### Implementation
1. **Schema version tracking system**
2. **Migration script framework**
3. **Rollback capability**
4. **Schema validation tools**

### Enhanced MCP Tools
**Priority**: Medium  
**Estimated Effort**: 2 weeks  

#### New Capabilities
- **Bulk operations**: Batch entity creation and updates
- **Transaction support**: Atomic memory operations across multiple entities
- **Streaming support**: Handle large result sets efficiently
- **Advanced caching**: Intelligent query result caching with invalidation

### Performance & Scalability
**Priority**: Medium  
**Estimated Effort**: 2-3 weeks  

#### Optimizations
- **Query performance**: Index optimization for common access patterns
- **Memory usage**: Efficient handling of large embedding vectors
- **Connection management**: Advanced connection pooling and management
- **Concurrent access**: Multi-agent coordination improvements

## 📊 Monitoring & Observability

### Memory Analytics Dashboard
**Priority**: Low-Medium  
**Estimated Effort**: 1-2 weeks  

#### Metrics
- **Usage patterns**: Track entity access frequency and patterns
- **Relevance effectiveness**: Monitor memory retrieval success rates
- **Performance monitoring**: Query execution time tracking and optimization
- **Memory health**: Detect stale, unused, or low-quality memories

#### Implementation
- **Metrics collection**: Automated usage tracking
- **Visualization**: Web dashboard for memory system health
- **Alerting**: Notifications for performance issues or data quality problems

## 🎯 Milestone Timeline

### Q4 2025: Foundation
- [ ] Complete remaining active TODOs
- [ ] Implement core memory schema (Phase 1)
- [ ] Enhanced testing framework
- [ ] Documentation updates

### Q1 2026: Intelligence
- [ ] Semantic search integration (Phase 2)
- [ ] Temporal intelligence system (Phase 3)
- [ ] Schema evolution support
- [ ] Performance optimization baseline

### Q2 2026: Advanced Features
- [ ] Query intelligence system (Phase 4)
- [ ] Enhanced MCP tools
- [ ] Multi-agent coordination improvements
- [ ] Advanced caching and optimization

### Q3 2026: Production Readiness
- [ ] Performance & scalability improvements
- [ ] Monitoring and observability
- [ ] Production deployment tools
- [ ] Comprehensive documentation

## 🤝 Contributing Guidelines

### Priority Levels
- **High**: Core functionality, critical bugs, agentic memory foundation
- **Medium**: Performance improvements, enhanced features, developer experience
- **Low**: Nice-to-have features, cosmetic improvements, optional optimizations

### Implementation Phases
1. **Research & Design**: Investigate requirements and design approach
2. **Prototype**: Build minimal viable implementation
3. **Integration**: Integrate with existing codebase
4. **Testing**: Comprehensive test coverage
5. **Documentation**: Update docs and examples
6. **Release**: Version bump and changelog update

### Review Process
- All major features require design review
- Performance improvements need benchmarking
- Schema changes require migration planning
- Breaking changes need deprecation period

---

**Next Review**: December 2025  
**Maintainer**: Jordan Burke  
**Contributors**: Open to community contributions

*This roadmap is a living document and will be updated as the project evolves and new requirements emerge.*