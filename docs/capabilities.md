# Exchange Capabilities

Capabilities describe what physical-world actions executors in an exchange can perform.

## Format

Capabilities are defined in YAML files in the `capabilities/` directory. Each file can contain multiple capabilities separated by `---`:

```yaml
id: camera
description: Take and attach photos
tags: [attachments]
---
id: hands
description: Has human hands for physical manipulation
tags: [physical-access]
---
id: check-door
description: Check if doors are locked or closed
tags: [security, physical-access]
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (kebab-case) |
| `description` | Yes | What this capability enables |
| `tags` | No | Searchable tags |
| `definition` | No | URL or path to detailed documentation |

## Examples

**Minimal:**
```yaml
id: hands
description: Has human hands
```

**With tags:**
```yaml
id: operate-garage-door
description: Open or close the garage door
tags: [automation, physical-access]
```

**With external docs:**
```yaml
id: smart-home-control
description: Control smart home devices via Home Assistant
tags: [automation, iot]
definition: https://example.com/smart-home-capabilities.md
```

## Discovery

Agents can discover capabilities via the `mess_capabilities` MCP tool:

```yaml
# Response from mess_capabilities
- id: camera
  description: Take and attach photos
  tags: [attachments]
- id: check-door
  description: Check if doors are locked or closed
  tags: [security, physical-access]
```

## Notes

- Capabilities are informational—they don't enforce request types
- Agents can send any request, even without a matching capability
- Tags help with searching and categorization
- Use `definition` to link to detailed executor instructions
