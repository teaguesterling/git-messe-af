# Add request templates for common tasks

## Summary

Allow agents and executors to create and use templates for frequently requested tasks, reducing friction for common operations.

## Current State

- Every request is created from scratch
- No template library or quick-actions
- Executor profiles exist in `executors/*.yaml` but no request templates
- No way to reuse previous request patterns

## Proposed Implementation

### 1. Template Storage

Create `templates/` directory for shared templates:

```yaml
# templates/check-laundry.yaml
template_id: check-laundry
name: "Check Laundry Status"
description: "Check if laundry needs attention"
category: household
intent: "Check if the laundry in the {location} is done"
context:
  - "Looking to know if laundry cycle completed"
response_hint:
  - text
  - image
variables:
  location:
    type: string
    default: "washer"
    options: ["washer", "dryer"]
suggested_priority: normal
```

### 2. MCP Server Template Support

Extend the `mess` tool to accept template references:

```yaml
MESS:
  - v: 1.0.0
  - from_template:
      id: check-laundry
      variables:
        location: dryer
      # Optional overrides
      priority: elevated
      additional_context:
        - "Need to know before leaving for work"
```

### 3. Client Template Browser

Add a template picker UI:
- Browse templates by category (household, errands, info, etc.)
- Search/filter templates
- Fill in template variables via form
- Preview before sending
- "Create template from this request" option

### 4. Personal Templates

Allow executors to save personal templates in localStorage:
- Quick-create from successful past requests
- Pin frequently used templates
- Sync to GitHub as `templates/personal/{executor_id}/*.yaml`

## Example Templates

| Template | Intent | Variables |
|----------|--------|-----------|
| `check-laundry` | Check laundry status | location |
| `package-check` | Check for delivered packages | — |
| `fridge-inventory` | Photo of fridge contents | — |
| `weather-check` | Current weather conditions | — |
| `pet-status` | Check on pet | pet_name |
| `plant-water` | Water the plants | area |

## Benefits

- **Faster request creation**: One click vs. writing intent
- **Consistency**: Standardized requests produce better responses
- **Discoverability**: Browse what's possible
- **Learning**: Templates serve as documentation

## Implementation Notes

### Template Variables

Support simple variable substitution:
- `{variable_name}` in intent and context strings
- Variables defined with type, default, and optional enum
- Client shows appropriate input (text, select, etc.)

### Template Validation

Templates should validate:
- Required fields present (template_id, name, intent)
- Variables used in intent are defined
- Category is from known list

### Template Discovery

For MCP server, allow agents to list available templates:
```javascript
// New tool: mess_templates
{
  "name": "mess_templates",
  "description": "List available request templates",
  "inputSchema": {
    "type": "object",
    "properties": {
      "category": { "type": "string" }
    }
  }
}
```

## Related Files

- New: `templates/*.yaml` - Shared templates
- `mcp/index.js` - Template loading and variable substitution
- `client/index.html` - Template browser UI
- Protocol docs - Document template format
