#!/bin/bash
#
# archive-threads.sh - Archive old finished/canceled MESSE-AF threads
#
# Archives threads older than a threshold by:
# 1. Zipping each thread (directory or file)
# 2. Moving the zip to archive/ (tracked by Git LFS)
# 3. Removing the original from exchange/
#
# Supports both local filesystem and GitHub repository modes.
#
# Usage:
#   ./scripts/archive-threads.sh [--days=7] [--dry-run]
#   ./scripts/archive-threads.sh --github --repo=owner/repo [--days=7] [--dry-run]
#

set -euo pipefail

# Default configuration
DAYS=7
DRY_RUN=false
GITHUB_MODE=false
REPO=""
TOKEN=""
EXCHANGE_DIR="exchange"
ARCHIVE_DIR="archive"
AUTO_COMMIT=false
AUTO_PUSH=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --days=*)
            DAYS="${1#*=}"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --github)
            GITHUB_MODE=true
            shift
            ;;
        --repo=*)
            REPO="${1#*=}"
            shift
            ;;
        --token=*)
            TOKEN="${1#*=}"
            shift
            ;;
        --exchange=*)
            EXCHANGE_DIR="${1#*=}"
            shift
            ;;
        --archive=*)
            ARCHIVE_DIR="${1#*=}"
            shift
            ;;
        --commit)
            AUTO_COMMIT=true
            shift
            ;;
        --push)
            AUTO_COMMIT=true  # --push implies --commit
            AUTO_PUSH=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Archive old finished/canceled MESSE-AF threads."
            echo ""
            echo "Options:"
            echo "  --days=N        Archive threads older than N days (default: 7)"
            echo "  --dry-run       Show what would be archived without making changes"
            echo "  --commit        Automatically commit changes after archiving"
            echo "  --push          Automatically commit and push changes (implies --commit)"
            echo "  --github        Use GitHub API mode instead of local filesystem"
            echo "  --repo=OWNER/REPO  GitHub repository (required for --github)"
            echo "  --token=TOKEN   GitHub token (uses GH_TOKEN or gh auth if not set)"
            echo "  --exchange=DIR  Exchange directory path (default: exchange)"
            echo "  --archive=DIR   Archive directory path (default: archive)"
            echo "  -h, --help      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --dry-run"
            echo "  $0 --days=14"
            echo "  $0 --commit --push"
            echo "  $0 --github --repo=user/messe-exchange"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            exit 1
            ;;
    esac
done

# Calculate cutoff date (seconds since epoch)
CUTOFF_DATE=$(date -d "-${DAYS} days" +%s 2>/dev/null || date -v-${DAYS}d +%s)
CUTOFF_ISO=$(date -d "@${CUTOFF_DATE}" -Iseconds 2>/dev/null || date -r "${CUTOFF_DATE}" -Iseconds)

echo -e "${BLUE}MESSE-AF Thread Archiver${NC}"
echo "========================"
echo "Mode: $([ "$GITHUB_MODE" = true ] && echo "GitHub API" || echo "Local filesystem")"
echo "Cutoff: ${CUTOFF_ISO} (threads older than ${DAYS} days)"
echo "Dry run: ${DRY_RUN}"
echo ""

# Extract 'updated' timestamp from YAML envelope
# Works with both v1 (flat file) and v2 (directory with 000-*.yaml)
extract_updated_timestamp() {
    local content="$1"
    # Extract the updated: field from the first YAML document (envelope)
    # Handle both "updated: 2026-01-31T..." and "updated: '2026-01-31T...'"
    echo "$content" | grep -m1 "^updated:" | sed "s/updated:[[:space:]]*['\"]*//" | sed "s/['\"]$//" || true
}

# Parse ISO date to epoch seconds
parse_date_to_epoch() {
    local date_str="$1"
    # Remove trailing timezone info variations for compatibility
    # Try GNU date first, then BSD date
    date -d "$date_str" +%s 2>/dev/null || \
        date -j -f "%Y-%m-%dT%H:%M:%S" "${date_str%[-+]*}" +%s 2>/dev/null || \
        date -j -f "%Y-%m-%d" "${date_str:0:10}" +%s 2>/dev/null || \
        echo "0"
}

# Archive a single thread (local mode)
archive_thread_local() {
    local thread_path="$1"
    local ref="$2"
    local zip_name="${ref}.messe-af.zip"
    local zip_path="${ARCHIVE_DIR}/${zip_name}"

    echo -e "  ${GREEN}Archiving:${NC} ${ref}"

    if [ "$DRY_RUN" = true ]; then
        echo -e "    ${YELLOW}[DRY RUN]${NC} Would create: ${zip_path}"
        echo -e "    ${YELLOW}[DRY RUN]${NC} Would remove: ${thread_path}"
        return 0
    fi

    # Ensure archive directory exists
    mkdir -p "${ARCHIVE_DIR}"

    # Get the parent directory and thread name
    local parent_dir=$(dirname "$thread_path")
    local thread_name=$(basename "$thread_path")

    # Create zip with the thread content
    # For directories: zip the entire directory
    # For files: zip the single file
    if [ -d "$thread_path" ]; then
        (cd "$parent_dir" && zip -rq "../${zip_name}" "$thread_name")
        mv "${parent_dir}/../${zip_name}" "${zip_path}"
    else
        (cd "$parent_dir" && zip -q "../${zip_name}" "$thread_name")
        mv "${parent_dir}/../${zip_name}" "${zip_path}"
    fi

    # Remove the original
    rm -rf "$thread_path"

    echo -e "    ${GREEN}Created:${NC} ${zip_path}"
}

# Local filesystem mode
run_local() {
    local archived_count=0
    local skipped_count=0

    # Process both finished and canceled folders
    for state_folder in "state=finished" "state=canceled"; do
        local folder_path="${EXCHANGE_DIR}/${state_folder}"

        if [ ! -d "$folder_path" ]; then
            echo -e "${YELLOW}Folder not found: ${folder_path}${NC}"
            continue
        fi

        echo -e "${BLUE}Scanning: ${folder_path}${NC}"

        # Find all threads (directories for v2, .yaml files for v1)
        # Exclude .gitkeep and other dot files
        for item in "$folder_path"/*; do
            [ -e "$item" ] || continue  # Skip if no matches

            local basename=$(basename "$item")

            # Skip hidden files
            [[ "$basename" == .* ]] && continue

            local ref=""
            local yaml_content=""

            if [ -d "$item" ]; then
                # V2 format: directory
                ref="$basename"
                local envelope_file="${item}/000-${ref}.messe-af.yaml"
                if [ -f "$envelope_file" ]; then
                    yaml_content=$(cat "$envelope_file")
                else
                    echo -e "  ${YELLOW}Skip:${NC} ${ref} (no envelope file)"
                    skipped_count=$((skipped_count + 1))
                    continue
                fi
            elif [[ "$basename" == *.messe-af.yaml ]]; then
                # V1 format: flat file
                ref="${basename%.messe-af.yaml}"
                yaml_content=$(cat "$item")
            else
                continue  # Not a thread
            fi

            # Extract and parse the updated timestamp
            local updated=$(extract_updated_timestamp "$yaml_content")

            if [ -z "$updated" ]; then
                echo -e "  ${YELLOW}Skip:${NC} ${ref} (no updated timestamp)"
                skipped_count=$((skipped_count + 1))
                continue
            fi

            local updated_epoch=$(parse_date_to_epoch "$updated")

            if [ "$updated_epoch" -eq 0 ]; then
                echo -e "  ${YELLOW}Skip:${NC} ${ref} (couldn't parse date: ${updated})"
                skipped_count=$((skipped_count + 1))
                continue
            fi

            # Check if thread is older than cutoff
            if [ "$updated_epoch" -lt "$CUTOFF_DATE" ]; then
                archive_thread_local "$item" "$ref"
                archived_count=$((archived_count + 1))
            else
                echo -e "  ${BLUE}Recent:${NC} ${ref} (updated: ${updated})"
                skipped_count=$((skipped_count + 1))
            fi
        done
    done

    echo ""
    echo -e "${GREEN}Summary:${NC}"
    echo "  Archived: ${archived_count}"
    echo "  Skipped: ${skipped_count}"

    if [ "$DRY_RUN" = false ] && [ "$archived_count" -gt 0 ]; then
        echo ""
        echo -e "${BLUE}Git operations:${NC}"
        git add "${ARCHIVE_DIR}/"*.zip 2>/dev/null || true
        git add "${EXCHANGE_DIR}/" 2>/dev/null || true
        echo "  Changes staged."

        if [ "$AUTO_COMMIT" = true ]; then
            local commit_msg="Archive ${archived_count} old thread(s)"
            git commit -m "$commit_msg"
            echo -e "  ${GREEN}Committed:${NC} ${commit_msg}"

            if [ "$AUTO_PUSH" = true ]; then
                git push
                echo -e "  ${GREEN}Pushed to remote${NC}"
            fi
        else
            echo "  Review with 'git status' and commit when ready."
        fi
    fi
}

# GitHub API mode
run_github() {
    if [ -z "$REPO" ]; then
        echo -e "${RED}Error: --repo=OWNER/REPO is required for GitHub mode${NC}" >&2
        exit 1
    fi

    # Determine token source
    if [ -z "$TOKEN" ]; then
        if [ -n "${GH_TOKEN:-}" ]; then
            TOKEN="$GH_TOKEN"
        else
            # Try to get token from gh CLI
            TOKEN=$(gh auth token 2>/dev/null || echo "")
        fi
    fi

    if [ -z "$TOKEN" ]; then
        echo -e "${RED}Error: No GitHub token found. Set --token, GH_TOKEN, or run 'gh auth login'${NC}" >&2
        exit 1
    fi

    local archived_count=0
    local skipped_count=0

    # Create temp directory for downloads
    local tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    echo -e "${BLUE}Fetching repository contents...${NC}"

    # Process both finished and canceled folders
    for state_folder in "state=finished" "state=canceled"; do
        local folder_path="${EXCHANGE_DIR}/${state_folder}"

        echo -e "${BLUE}Scanning: ${folder_path}${NC}"

        # List contents of the folder
        local contents=$(gh api "repos/${REPO}/contents/${folder_path}" \
            --header "Authorization: token ${TOKEN}" \
            --jq '.[] | select(.name != ".gitkeep") | "\(.name)|\(.type)|\(.sha)"' 2>/dev/null || echo "")

        if [ -z "$contents" ]; then
            echo -e "  ${YELLOW}Empty or not found${NC}"
            continue
        fi

        while IFS='|' read -r name type sha; do
            [ -z "$name" ] && continue

            local ref=""
            local updated=""

            if [ "$type" = "dir" ]; then
                # V2 format: directory
                ref="$name"
                local envelope_path="${folder_path}/${name}/000-${ref}.messe-af.yaml"

                # Fetch envelope file content
                local envelope_content=$(gh api "repos/${REPO}/contents/${envelope_path}" \
                    --header "Authorization: token ${TOKEN}" \
                    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")

                if [ -z "$envelope_content" ]; then
                    echo -e "  ${YELLOW}Skip:${NC} ${ref} (no envelope file)"
                    skipped_count=$((skipped_count + 1))
                    continue
                fi

                updated=$(extract_updated_timestamp "$envelope_content")
            elif [[ "$name" == *.messe-af.yaml ]]; then
                # V1 format: flat file
                ref="${name%.messe-af.yaml}"

                # Fetch file content
                local file_content=$(gh api "repos/${REPO}/contents/${folder_path}/${name}" \
                    --header "Authorization: token ${TOKEN}" \
                    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")

                if [ -z "$file_content" ]; then
                    echo -e "  ${YELLOW}Skip:${NC} ${ref} (couldn't fetch content)"
                    skipped_count=$((skipped_count + 1))
                    continue
                fi

                updated=$(extract_updated_timestamp "$file_content")
            else
                continue
            fi

            if [ -z "$updated" ]; then
                echo -e "  ${YELLOW}Skip:${NC} ${ref} (no updated timestamp)"
                skipped_count=$((skipped_count + 1))
                continue
            fi

            local updated_epoch=$(parse_date_to_epoch "$updated")

            if [ "$updated_epoch" -eq 0 ]; then
                echo -e "  ${YELLOW}Skip:${NC} ${ref} (couldn't parse date: ${updated})"
                skipped_count=$((skipped_count + 1))
                continue
            fi

            # Check if thread is older than cutoff
            if [ "$updated_epoch" -lt "$CUTOFF_DATE" ]; then
                echo -e "  ${GREEN}Archiving:${NC} ${ref}"

                if [ "$DRY_RUN" = true ]; then
                    echo -e "    ${YELLOW}[DRY RUN]${NC} Would archive: ${ref}"
                    archived_count=$((archived_count + 1))
                    continue
                fi

                # Download thread contents
                local thread_tmp="${tmp_dir}/${ref}"
                mkdir -p "$thread_tmp"

                if [ "$type" = "dir" ]; then
                    # Download all files in directory
                    local dir_contents=$(gh api "repos/${REPO}/contents/${folder_path}/${name}" \
                        --header "Authorization: token ${TOKEN}" \
                        --jq '.[] | "\(.name)|\(.download_url)"' 2>/dev/null || echo "")

                    while IFS='|' read -r fname url; do
                        [ -z "$fname" ] && continue
                        curl -sL "$url" -o "${thread_tmp}/${fname}"
                    done <<< "$dir_contents"
                else
                    # Download single file
                    gh api "repos/${REPO}/contents/${folder_path}/${name}" \
                        --header "Authorization: token ${TOKEN}" \
                        --jq '.content' | base64 -d > "${thread_tmp}/${name}"
                fi

                # Create zip
                local zip_name="${ref}.messe-af.zip"
                local zip_path="${tmp_dir}/${zip_name}"
                (cd "$tmp_dir" && zip -rq "${zip_name}" "${ref}")

                # Upload zip to archive folder via GitHub API
                local zip_b64=$(base64 -w0 "$zip_path" 2>/dev/null || base64 "$zip_path")
                local upload_path="${ARCHIVE_DIR}/${zip_name}"

                # Create/update file in repo
                gh api "repos/${REPO}/contents/${upload_path}" \
                    --method PUT \
                    --header "Authorization: token ${TOKEN}" \
                    --field message="Archive thread ${ref}" \
                    --field content="$zip_b64" \
                    >/dev/null 2>&1 || {
                        echo -e "    ${RED}Failed to upload:${NC} ${upload_path}"
                        continue
                    }

                echo -e "    ${GREEN}Uploaded:${NC} ${upload_path}"

                # Delete original from exchange
                if [ "$type" = "dir" ]; then
                    # For directories, need to delete each file then the directory
                    # This is complex with GitHub API, use the tree API approach
                    echo -e "    ${YELLOW}Note:${NC} Directory deletion requires manual git commit"
                else
                    # Delete single file
                    local file_sha=$(gh api "repos/${REPO}/contents/${folder_path}/${name}" \
                        --header "Authorization: token ${TOKEN}" \
                        --jq '.sha' 2>/dev/null || echo "")

                    if [ -n "$file_sha" ]; then
                        gh api "repos/${REPO}/contents/${folder_path}/${name}" \
                            --method DELETE \
                            --header "Authorization: token ${TOKEN}" \
                            --field message="Archive thread ${ref}" \
                            --field sha="$file_sha" \
                            >/dev/null 2>&1 || true
                        echo -e "    ${GREEN}Deleted:${NC} ${folder_path}/${name}"
                    fi
                fi

                archived_count=$((archived_count + 1))

                # Clean up temp files for this thread
                rm -rf "$thread_tmp" "$zip_path"
            else
                echo -e "  ${BLUE}Recent:${NC} ${ref} (updated: ${updated})"
                skipped_count=$((skipped_count + 1))
            fi
        done <<< "$contents"
    done

    echo ""
    echo -e "${GREEN}Summary:${NC}"
    echo "  Archived: ${archived_count}"
    echo "  Skipped: ${skipped_count}"
}

# Main execution
if [ "$GITHUB_MODE" = true ]; then
    run_github
else
    run_local
fi
