# Exchange Capabilities

**Version:** 1.0.0
**Date:** 2026-02-01

---

## Overview

Capabilities define the physical-world actions that executors in an exchange can perform. They help:

- **Agents** discover what they can request
- **Executors** understand what's expected of them
- **Exchanges** customize available actions for their context

Capabilities are defined per-exchange and stored in the `capabilities/` directory.

---

## Storage Format

### Directory Structure

```
exchange/
  capabilities/
    _index.yaml              # Optional: capability ordering/metadata
    check-door.yaml          # One file per capability
    fridge-inventory.yaml
    water-plants.yaml
    ...
  state=received/
  state=executing/
  ...
```

### Alternative: Single Manifest

For simpler exchanges, all capabilities can be in one file:

```
exchange/
  capabilities.yaml          # All capabilities in one file
  state=received/
  ...
```

---

## Capability Definition

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (kebab-case, e.g., `check-door`) |
| `name` | string | Human-readable display name |
| `description` | string | Brief description (1-2 sentences) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `extended_description` | string | Detailed instructions for executors |
| `tools` | list | Equipment/capabilities needed (e.g., `camera`, `physical-access`) |
| `examples` | list | Sample intent phrases |
| `response_hints` | list | Typical response types: `text`, `image`, `video`, `audio` |
| `priority_default` | string | Default priority: `background`, `normal`, `elevated`, `urgent` |
| `category` | string | Grouping category (e.g., `home`, `security`, `maintenance`) |
| `tags` | list | Searchable tags |
| `estimated_duration` | string | Typical time to complete (e.g., `1-2 minutes`, `< 30 seconds`) |

---

## Example Capabilities

### Simple Capability

```yaml
id: check-door
name: Check Door Status
description: Verify if a door is open, closed, or locked.

examples:
  - Is the garage door closed?
  - Check if the front door is locked
  - Is the back door open?

response_hints:
  - image
  - text
```

### Detailed Capability

```yaml
id: fridge-inventory
name: Fridge Inventory
description: Check and report contents of the refrigerator.
category: home

extended_description: |
  Open the refrigerator and take stock of its contents. Report:
  - Proteins (meat, eggs, tofu)
  - Vegetables and fruits
  - Dairy products
  - Leftovers with approximate age
  - Items that need to be used soon

  Take photos if requested. Note any items that are expired or
  running low.

tools:
  - camera
  - physical-access

examples:
  - What's in the fridge?
  - Do we have eggs?
  - Quick inventory for dinner planning

response_hints:
  - image
  - text

estimated_duration: 2-3 minutes
tags:
  - kitchen
  - food
  - inventory
```

### Capability with Required Tools

```yaml
id: water-plants
name: Water Plants
description: Water indoor or outdoor plants as needed.
category: maintenance

extended_description: |
  Check soil moisture and water plants that need it.
  Report which plants were watered and any that look unhealthy.

tools:
  - water-access
  - physical-access

examples:
  - Water the houseplants
  - Check if the garden needs watering
  - Water the tomatoes

response_hints:
  - text
  - image

priority_default: background
estimated_duration: 5-15 minutes
```

---

## Index File

The optional `_index.yaml` provides ordering and exchange-level metadata:

```yaml
# capabilities/_index.yaml

exchange_name: Home Exchange
description: Capabilities for home task automation

# Display order (capabilities not listed appear alphabetically after)
order:
  - check-door
  - fridge-inventory
  - water-plants

# Categories for grouping in UI
categories:
  security:
    name: Security
    icon: shield
  home:
    name: Home
    icon: home
  maintenance:
    name: Maintenance
    icon: wrench

# Default tools available to all executors
default_tools:
  - camera
  - physical-access
```

---

## Loading Capabilities

### MCP Server

The MCP server exposes capabilities via:

1. **`mess_capabilities` tool** - List available capabilities
2. **`capabilities://` resource** - Browse capability definitions

```yaml
# mess_capabilities response
capabilities:
  - id: check-door
    name: Check Door Status
    description: Verify if a door is open, closed, or locked.
    examples:
      - Is the garage door closed?

  - id: fridge-inventory
    name: Fridge Inventory
    description: Check and report contents of the refrigerator.
    examples:
      - What's in the fridge?
```

### Client

The web client can display capabilities to help executors understand available tasks and to help requestors (if enabled) formulate requests.

### Server API

The Exchange Server exposes capabilities via:

```
GET /api/v1/exchanges/:id/capabilities
```

---

## Matching Requests to Capabilities

Capabilities are informational—they don't enforce request types. Agents can still send any request, even if no matching capability is defined. Capabilities help with:

1. **Discovery** - "What can I ask for?"
2. **Examples** - "How should I phrase this?"
3. **Expectations** - "What response will I get?"

Future enhancements may include:
- Capability-based request templates
- Auto-routing based on required tools
- Executor capability matching

---

## Executor Tool Declarations

Executors declare their available tools when registering:

```yaml
# executors/teague-phone.yaml
id: teague-phone
display_name: Teague's Phone
tools:
  - camera
  - physical-access
  - mobility
```

This enables future matching of requests to capable executors based on the capability's `tools` requirements.

---

*Capabilities v1.0.0 — Exchange-defined physical-world actions*
