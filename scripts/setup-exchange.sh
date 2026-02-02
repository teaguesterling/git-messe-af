#!/usr/bin/env bash
#
# Setup a minimal MESSE-AF exchange repository
#
# Usage:
#   ./setup-exchange.sh                    # Create in current directory
#   ./setup-exchange.sh my-exchange        # Create new directory
#   ./setup-exchange.sh --help
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] [DIRECTORY]

Setup a minimal MESSE-AF exchange repository.

Arguments:
  DIRECTORY     Target directory (default: current directory)

Options:
  -h, --help    Show this help message
  --no-commit   Skip git init and initial commit
  --no-readme   Skip creating README

Examples:
  $(basename "$0")                    # Setup in current directory
  $(basename "$0") my-mess-exchange   # Create new directory
  $(basename "$0") . --no-commit      # Setup without git
EOF
}

# Parse arguments
TARGET_DIR=""
DO_COMMIT=true
DO_README=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        --no-commit)
            DO_COMMIT=false
            shift
            ;;
        --no-readme)
            DO_README=false
            shift
            ;;
        -*)
            echo "Error: Unknown option $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            if [[ -z "$TARGET_DIR" ]]; then
                TARGET_DIR="$1"
            else
                echo "Error: Multiple directories specified" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# Default to current directory
TARGET_DIR="${TARGET_DIR:-.}"

# Create target if it doesn't exist
if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Creating directory: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
fi

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo "Setting up MESSE-AF exchange in: $TARGET_DIR"

# Create exchange directory structure
echo "Creating exchange directory structure..."
mkdir -p "$TARGET_DIR/exchange/state=received"
mkdir -p "$TARGET_DIR/exchange/state=executing"
mkdir -p "$TARGET_DIR/exchange/state=finished"
mkdir -p "$TARGET_DIR/exchange/state=canceled"
mkdir -p "$TARGET_DIR/exchange/archive"

# Add .gitkeep files to empty directories
touch "$TARGET_DIR/exchange/state=received/.gitkeep"
touch "$TARGET_DIR/exchange/state=executing/.gitkeep"
touch "$TARGET_DIR/exchange/state=finished/.gitkeep"
touch "$TARGET_DIR/exchange/state=canceled/.gitkeep"
touch "$TARGET_DIR/exchange/archive/.gitkeep"

# Copy executors directory
echo "Copying executors directory..."
mkdir -p "$TARGET_DIR/executors"
cp "$REPO_ROOT/executors/README.md" "$TARGET_DIR/executors/"
cp "$REPO_ROOT/executors/_example.yaml" "$TARGET_DIR/executors/"

# Copy scripts/notify directory (excluding node_modules)
echo "Copying notification scripts..."
mkdir -p "$TARGET_DIR/scripts/notify/lib/senders"
cp "$REPO_ROOT/scripts/notify/package.json" "$TARGET_DIR/scripts/notify/"
cp "$REPO_ROOT/scripts/notify/package-lock.json" "$TARGET_DIR/scripts/notify/"
cp "$REPO_ROOT/scripts/notify/index.js" "$TARGET_DIR/scripts/notify/"
cp "$REPO_ROOT/scripts/notify/README.md" "$TARGET_DIR/scripts/notify/"
cp "$REPO_ROOT/scripts/notify/lib/http.js" "$TARGET_DIR/scripts/notify/lib/"
cp "$REPO_ROOT/scripts/notify/lib/senders/"*.js "$TARGET_DIR/scripts/notify/lib/senders/"

# Copy GitHub workflow
echo "Copying GitHub Actions workflow..."
mkdir -p "$TARGET_DIR/.github/workflows"
cp "$REPO_ROOT/.github/workflows/notify.yml" "$TARGET_DIR/.github/workflows/"

# Create README
if [[ "$DO_README" == true ]]; then
    echo "Creating README..."
    cat > "$TARGET_DIR/README.md" << 'EOF'
# MESS Exchange

A minimal [MESSE-AF](https://github.com/teaguesterling/git-messe-af) exchange for dispatching physical-world tasks from AI agents to human executors.

## Structure

```
exchange/
  state=received/     # New requests awaiting claim
  state=executing/    # Requests being worked on
  state=finished/     # Completed requests
  state=canceled/     # Cancelled/failed requests
  archive/            # Old archived threads

executors/            # Executor registration files
  _example.yaml       # Example executor config

scripts/notify/       # Notification dispatcher (used by GitHub Actions)

.github/workflows/
  notify.yml          # Sends notifications on new requests
```

## Setup

### 1. Register Executors

Copy `executors/_example.yaml` to `executors/your-name.yaml` and configure:

```yaml
executor_id: your-name
display_name: "Your Name"
capabilities:
  - check:visual
  - photo:capture
notifications:
  - type: ntfy
    topic: your-secret-topic
```

### 2. Configure Notifications

Add secrets in your repo settings for the notification services you use:

| Secret | Service |
|--------|---------|
| `PUSHOVER_APP_TOKEN` | Pushover |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio SMS |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | SendGrid email |
| `GMAIL_EMAIL`, `GMAIL_APP_PASSWORD` | Gmail SMTP |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Google Tasks |

### 3. Connect Claude (optional)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mess": {
      "command": "node",
      "args": ["/path/to/mcp/index.js"],
      "env": {
        "MESS_GITHUB_REPO": "your-username/this-repo",
        "MESS_GITHUB_TOKEN": "github_pat_xxxxx",
        "MESS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

## Protocol

See [MESS Protocol v1](https://github.com/teaguesterling/git-messe-af/blob/main/docs/mess-protocol-v1.md) for the full specification.

## Quick Reference

### Submit a request (via MCP)

```yaml
MESS:
  - request:
      intent: Check if the garage door is closed
```

### With context and response hints

```yaml
MESS:
  - request:
      intent: What's in the fridge?
      context:
        - Planning dinner for 4
      response_hint:
        - text
        - image
```

---

Generated by [git-messe-af](https://github.com/teaguesterling/git-messe-af)
EOF
fi

# Create .gitignore
echo "Creating .gitignore..."
cat > "$TARGET_DIR/.gitignore" << 'EOF'
# Dependencies
node_modules/

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
*.swp
*.swo

# Logs
*.log
EOF

# Initialize git and commit
if [[ "$DO_COMMIT" == true ]]; then
    echo "Initializing git repository..."
    cd "$TARGET_DIR"

    if [[ ! -d .git ]]; then
        git init
    fi

    git add .
    git commit -m "Initialize MESSE-AF exchange

Created with git-messe-af setup script.
See: https://github.com/teaguesterling/git-messe-af"

    echo ""
    echo "Git repository initialized with initial commit."
fi

echo ""
echo "MESSE-AF exchange setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create an executor in executors/your-name.yaml"
echo "  2. Configure notification secrets in your GitHub repo settings"
echo "  3. Push to GitHub to enable the notification workflow"
echo ""
