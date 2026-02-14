# Cloudflare Worker Backend (Option 1)

This document defines the backend service that handles natural-language updates, confirmation deltas, and git-backed persistence.

## What this worker does

- Reads canonical CSV files from GitHub (`main` branch)
- Accepts plain-text change instructions
- Calls an LLM to produce structured operations
- Previews delta before apply
- Applies approved operations and writes CSV changes as a single Git commit
- Optionally triggers a GitHub Actions publish workflow

## Location

- Worker code: `worker/src/index.js`
- Worker config: `worker/wrangler.toml`

## Required secrets

Set these with `wrangler secret put <NAME>`:

- `API_TOKEN` (Bearer token for protected endpoints)
- `GITHUB_TOKEN` (repo write access for `family-tree`)
- `OPENAI_API_KEY`

Optional secret/config:

- `PUBLISH_WORKFLOW_FILE` (for example: `publish.yml`) to trigger publish workflow after apply

## Non-secret vars

Configured in `worker/wrangler.toml`:

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `PEOPLE_PATH`
- `RELATIONSHIPS_PATH`
- `OPENAI_MODEL`

## API endpoints

### `GET /health`
- Returns service status.

### `GET /api/tree`
- Returns parsed `people` and `relationships` from canonical CSV plus current commit SHA.

### `POST /api/changes/propose` (auth required)
- Input: `{ "instruction": "..." }`
- Output: JSON proposal from LLM with keys:
  - `operations`
  - `assumptions`
  - `questions`

### `POST /api/changes/preview` (auth required)
- Input: `{ "operations": [...] }`
- Applies operations in memory only.
- Output:
  - `delta.people.added|updated|removed`
  - `delta.relationships.added|updated|removed`
  - `warnings`

### `POST /api/changes/apply` (auth required)
- Input: `{ "operations": [...], "commit_message": "optional" }`
- Applies operations, validates, writes both CSVs in one Git commit to `main`.
- Output: `commit_sha`, `delta`, `warnings`.

## Operation schema (current)

Supported operation types:

- `add_person`
- `update_person`
- `add_relationship`
- `update_relationship`
- `delete_relationship`

Relationship types allowed:

- `parent`
- `spouse`

## Local development

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
# fill secrets in .dev.vars for local testing only
npm run dev
```

## Deploy

```bash
cd worker
npm install
wrangler secret put API_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put OPENAI_API_KEY
# optional
wrangler secret put PUBLISH_WORKFLOW_FILE
wrangler deploy
```

## Security notes

- All mutating endpoints require `Authorization: Bearer <API_TOKEN>`.
- Keep `GITHUB_TOKEN` scoped to the target repo only.
- Do not log full bearer tokens or secrets in request/response logs.

## Current limitations

- No identity/user-level auth yet (single API token model).
- No queue/retry layer for external API failures.
- No rollback endpoint yet (can still rollback by git commit manually).
- No strict JSON schema validation library yet; validation is inline and minimal.
