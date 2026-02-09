# MESS Protocol v1.1
## Meatspace Execution and Submission System

```yaml
version: 1.1.0
status: draft
date: 2026-02-08
authors:
  - Teague Stirling
  - Claude (Anthropic)
```

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-02-08 | Add `needed_by`, `confirm_before`, structured responses, location schema, claim estimates |
| 1.0.0 | 2026-01-31 | Initial release |

---

## Summary of Changes from v1.0

### New Request Fields

| Field | Type | Description |
|-------|------|-------------|
| `needed_by` | datetime | When the request becomes stale (top-level, simpler than `constraints.timing.expires`) |
| `confirm_before` | boolean | Require confirmation before executor proceeds |

### New Status Fields

| Field | Context | Description |
|-------|---------|-------------|
| `estimate` | `claimed` status | ISO 8601 duration for expected completion time |

### Structured Response Schemas

Responses now have defined schemas for each `response_hint` type, making them machine-readable.

---

## 1. Request Extensions

### 1.1 `needed_by` — Request Expiration

Physical-world tasks are time-sensitive. A request to check the door before bed is useless at 6am.

```yaml
MESS:
  - request:
      intent: Check if the garage door is closed
      needed_by: "2026-02-08T23:00:00-08:00"
```

**Behavior:**
- If `needed_by` passes before the request is `claimed`, the exchange MAY auto-transition to `expired` status
- If `needed_by` passes while `in_progress`, the executor decides whether to continue
- Executors SHOULD see `needed_by` when claiming to assess feasibility

**Relationship to `constraints.timing`:**
- `needed_by` is a convenience field equivalent to `constraints.timing.expires`
- If both are specified, `needed_by` takes precedence
- Use `needed_by` for simple cases; use `constraints.timing` for complex scheduling

### 1.2 `confirm_before` — Pre-execution Confirmation

For consequential or irreversible actions, the requestor may require confirmation before the executor proceeds.

```yaml
MESS:
  - request:
      intent: Turn off the main water valve
      confirm_before: true
```

**Behavior:**
- Executor MUST send `needs_confirmation` status before taking action
- Executor includes `action` description and optionally `consequences`
- Requestor replies with `confirm: true` or `confirm: false`
- If `confirm: false`, executor transitions to `cancelled` or `held`

**Enforcement:**
- If executor submits a response without prior confirmation, the exchange SHOULD reject it
- The exchange MAY allow a grace period for executors that don't support v1.1

**Example flow:**
```yaml
# Request
MESS:
  - request:
      id: water-valve
      intent: Turn off the main water valve
      confirm_before: true
---
# Executor seeks confirmation
MESS:
  - status:
      re: water-valve
      code: needs_confirmation
      executor: home-assistant
      action: Close main water shutoff valve in garage
      consequences: All water fixtures will stop working
      reversible: true
---
# Requestor confirms
MESS:
  - reply:
      re: water-valve
      confirm: true
---
# Executor completes
MESS:
  - response:
      re: water-valve
      content:
        - confirmation: true
```

---

## 2. Status Extensions

### 2.1 `estimate` on Claim

When claiming a request, executors MAY provide an estimated completion time.

```yaml
MESS:
  - status:
      re: grocery-run
      code: claimed
      executor: instacart-proxy
      estimate: PT45M          # ISO 8601 duration: 45 minutes
```

**Format:** ISO 8601 duration (`PT30M`, `PT2H`, `P1D`)

**Relationship to `eta`:**
- `estimate` is a duration (how long: `PT45M`)
- `eta` (from v1.0) is an absolute time (when done: `17:30:00`)
- Both MAY be provided; `estimate` is preferred for v1.1

**Usage:**
- Helps requestor decide whether to wait or context-switch
- Not a commitment — actual completion may vary
- Executor MAY update estimate via subsequent `in_progress` status

---

## 3. Structured Response Schemas

When a request includes `response_hint`, the response SHOULD use the corresponding structured format. This makes responses machine-readable.

### 3.1 Response Hint Types

| Hint | Response Schema | Description |
|------|-----------------|-------------|
| `text` | string | Free-form text description |
| `image` | image content entry | Photo or image |
| `video` | video content entry | Video recording |
| `audio` | audio content entry | Audio recording or voice note |
| `location` | location object | Geographic location |
| `file` | file content entry | Document or data file |
| `confirmation` | confirmation object | Yes/no acknowledgment |

### 3.2 Location Schema

Location responses include both machine-readable coordinates AND human-readable descriptions.

```yaml
location:
  # Machine-readable (at least one of lat/lng or address recommended)
  lat: 37.7749
  lng: -122.4194
  accuracy: 10              # meters, optional
  altitude: 15              # meters, optional

  # Human-readable (at least one recommended)
  name: "Kitchen"                                    # Casual/local name
  address: "52 Paradise Dr, Corte Madera, CA 94925" # Formal address
  description: "By the back door"                   # Additional context
```

**Design rationale:**
- `lat`/`lng` are canonical for machine processing
- `name` captures local/casual references ("Kitchen", "Samuel P. Taylor Park")
- `address` captures formal postal addresses
- `description` adds context that doesn't fit elsewhere
- Executors SHOULD provide what's natural; consumers pick what's useful

**Request vs Response locations:**
- Request `constraints.location` (v1.0) defines a *target area*: `{ lat, lng, radius_km }`
- Response `location` (v1.1) describes a *specific place*: `{ lat, lng, name, address, description }`
- These serve different purposes and have different schemas intentionally

**Examples:**

```yaml
# Indoor location
location:
  name: Kitchen
  description: By the refrigerator

# Outdoor with coordinates
location:
  lat: 37.9542
  lng: -122.7261
  name: Samuel P. Taylor Park
  description: Near the main picnic area

# Delivery address
location:
  address: "52 Paradise Dr, Corte Madera, CA 94925"
  description: Leave at front door
```

### 3.3 Confirmation Schema

```yaml
confirmation:
  confirmed: true           # or false
  details: "Completed"      # optional elaboration
```

Or shorthand: `confirmation: true`

### 3.4 Full Response Example

Request:
```yaml
MESS:
  - request:
      intent: Where are you right now?
      response_hint:
        - location
        - text
```

Response:
```yaml
MESS:
  - response:
      re: last
      content:
        - location:
            lat: 37.9234
            lng: -122.5193
            name: Safeway
            address: "180 Donahue St, Sausalito, CA 94965"
        - Picking up groceries, should be home in 20 minutes
```

### 3.5 Multiple Hints

When multiple hints are specified, response SHOULD include matching content entries:

```yaml
# Request
response_hint:
  - image
  - location
  - text

# Response content
content:
  - image: data:image/jpeg;base64,...
  - location:
      name: Backyard
      description: The garden bed by the fence
  - The tomatoes are looking healthy, about 2 weeks from harvest
```

---

## 4. Updated Request Schema

```yaml
MESS:
  - request:
      # === REQUIRED ===
      intent: string

      # === NEW IN v1.1 ===
      needed_by: datetime           # When request becomes stale
      confirm_before: boolean       # Require confirmation before action

      # === OPTIONAL (unchanged from v1.0) ===
      id: string
      precision: loose | guided | exact
      requires:
        - <capability-id>
      context:
        - <entry>
      constraints:
        location: string | { lat, lng, radius_km }
        timing:
          not_before: datetime
          expires: datetime | duration
          urgency: whenever | soon | now
        environment: [string]
        depends_on: [id]
      response_hint:
        - <type>
      priority: background | normal | elevated | urgent
      compensation:
        shells: integer
        note: string
```

---

## 5. Compatibility

### 5.1 Version Negotiation

- v1.1 messages SHOULD include `v: 1.1.0`
- v1.0 consumers that encounter unknown fields MUST ignore them
- v1.1 features gracefully degrade:
  - `needed_by` ignored → request never auto-expires (v1.0 behavior)
  - `confirm_before` ignored → executor proceeds without confirmation
  - `estimate` ignored → requestor has no ETA information
  - Structured responses parsed as generic content entries

### 5.2 Migration

No migration required. v1.1 is fully backward compatible with v1.0.

---

## 6. Examples

### 6.1 Time-Sensitive Request

```yaml
MESS:
  - v: 1.1.0
  - request:
      intent: Check if the garage door is closed
      needed_by: "2026-02-08T23:00:00-08:00"
      response_hint:
        - image
        - confirmation
```

### 6.2 Consequential Action with Confirmation

```yaml
MESS:
  - v: 1.1.0
  - request:
      intent: Delete all photos from the shared album
      confirm_before: true
      context:
        - The album named "Old Vacation Photos"
        - We've already backed these up to the NAS
```

### 6.3 Location Request and Response

```yaml
# Request
MESS:
  - v: 1.1.0
  - request:
      intent: Where did I leave my keys?
      response_hint:
        - location
        - image
---
# Response
MESS:
  - response:
      re: last
      content:
        - location:
            name: Kitchen counter
            description: Next to the fruit bowl
        - image: data:image/jpeg;base64,...
```

### 6.4 Claim with Estimate

```yaml
MESS:
  - status:
      re: grocery-run
      code: claimed
      executor: teague-phone
      estimate: PT30M
      message: Heading to Safeway now
```

---

## Appendix: Response Hint Reference

| Hint | Structured Schema | Example |
|------|-------------------|---------|
| `text` | bare string | `- The door is closed` |
| `image` | `image: <uri or data>` | `- image: data:image/jpeg;base64,...` |
| `video` | `video: <uri or data>` | `- video: data:video/mp4;base64,...` |
| `audio` | `audio: <uri or data>` | `- audio: data:audio/wav;base64,...` |
| `location` | `location: {lat?, lng?, name?, address?, description?}` | See section 3.2 |
| `file` | `file: <uri or {uri, name?, mime?}>` | `- file: file://report.pdf` |
| `confirmation` | `confirmation: true` or `{confirmed, details?}` | `- confirmation: true` |

---

*MESS Protocol v1.1 — Draft*
