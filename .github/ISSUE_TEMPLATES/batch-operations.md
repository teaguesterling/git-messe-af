# Add batch operations for similar recurring requests

## Summary

Allow agents to create multiple related requests in a single operation, with optional dependency ordering between them.

## Current State

- Requests are created one at a time
- No way to express relationships between requests
- No batch creation API in MCP server
- Implementation plan mentions batch support but it's not implemented:

```yaml
# From docs/mess-implementation-plan.md - not yet implemented
MESS:
  - request:
      id: shop
      intent: buy yellow onions
  - request:
      id: prep
      intent: dice onions when they arrive
      constraints:
        depends_on: [shop]
```

## Proposed Implementation

### 1. MCP Server Batch Tool

Add a `mess_batch` tool to create multiple requests atomically:

```yaml
MESS:
  - v: 1.0.0
  - batch:
      name: "Morning routine check"
      requests:
        - id: coffee
          intent: "Check if coffee maker has water"
          priority: normal
        - id: plants
          intent: "Check if plants need watering"
          priority: background
        - id: water_plants
          intent: "Water plants if they looked dry"
          constraints:
            depends_on: [plants]
```

### 2. Batch Envelope Structure

Store batch metadata in a new file or extend thread envelope:

```yaml
batch_ref: 2026-01-31-batch-001
requests: [2026-01-31-001, 2026-01-31-002, 2026-01-31-003]
dependencies:
  2026-01-31-003:
    depends_on: [2026-01-31-002]
status: partial  # all_pending | in_progress | partial | completed
```

### 3. Client UI Enhancements

- Batch view showing grouped requests
- Dependency visualization (simple arrow indicators)
- Batch status aggregation (3/5 completed)
- Option to cancel remaining batch items

### 4. Dependency Handling

When a request completes, automatically:
- Check if any requests depend on it
- Notify executor of newly unblocked requests
- Update batch status

## Use Cases

1. **Multi-step errands**: "Go to store, buy milk, check expiration date"
2. **Morning checks**: "Check weather, check calendar, report summary"
3. **Conditional tasks**: "Check fridge → if low on eggs, add to shopping list"
4. **Parallel requests**: Multiple quick checks that can be done in any order

## Benefits

- Reduces notification spam for related requests
- Enables complex real-world workflows
- Allows expressing task dependencies
- Better organization for executor

## Related Files

- `mcp/index.js` - Add batch tool and dependency tracking
- `client/index.html` - Add batch UI components
- Protocol docs - Document batch envelope format
