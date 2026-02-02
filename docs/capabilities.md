# Exchange Capabilities

Capabilities describe what physical-world actions an exchange can delegate to its executors. Executors claim capabilities; requests require them.

## Overview

- **Exchange-level**: Capabilities are defined at the exchange, not per-executor
- **Open creation**: Exchanges may allow executors/requestors to define new capabilities
- **Simple IDs**: Each capability has a unique identifier
- **Optional metadata**: Requests and registrations may include exchange-specific metadata

## Format

Capabilities are defined in YAML files in the `capabilities/` directory. Each file can contain multiple capabilities separated by `---`:

```yaml
id: take-photo
description: Capture and attach photos
tags: [visual, attachments]
---
id: check-visual
description: Look at something, read a display
tags: [visual, inspection]
---
id: vacuum-floor
description: Vacuum floors and carpets
tags: [cleaning, maintenance]
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (kebab-case recommended) |
| `description` | Yes | What this capability enables |
| `tags` | No | Searchable tags for categorization |
| `definition` | No | URL or path to detailed documentation |

## ID Conventions

Recommended (not enforced):

- Use `kebab-case` for readability: `take-photo`, `vacuum-floor`
- Be specific: `vacuum-floor` not just `cleaning`
- Create distinct IDs for skill levels: `woodworking`, `expert-woodworking`
- Create distinct IDs for variants: `3d-print-fdm`, `3d-print-resin`
- Include location for access: `home-kitchen-access`, `garage-access`

## Examples

**Minimal:**
```yaml
id: take-photo
description: Capture and attach photos
```

**With tags:**
```yaml
id: operate-garage-door
description: Open or close the garage door
tags: [automation, home-access]
```

**With external docs:**
```yaml
id: smart-home-control
description: Control smart home devices via Home Assistant
tags: [automation, iot]
definition: https://example.com/smart-home-capabilities.md
```

## Usage

**Executor registration:**
```yaml
capabilities:
  - take-photo
  - check-visual
  - home-kitchen-access
```

**Request requirements:**
```yaml
requires:
  - vacuum-floor
  - home-kitchen-access
```

**With metadata (exchange-specific):**
```yaml
requires:
  - fabricator: { variant: fdm, material: pla }
```

## Discovery

Agents can discover capabilities via the `mess_capabilities` MCP tool or MESS query:

```yaml
MESS:
  - query:
      type: capabilities
      filter:
        tags: [visual]
```

## Notes

- Capabilities are informational—they help with routing but don't restrict requests
- Agents can send any request, even without a matching capability
- Tags help with searching and categorization
- Use `definition` to link to detailed executor instructions
- Metadata interpretation is exchange-specific
