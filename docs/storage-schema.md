# Family Tree Storage Schema (Google Sheets Friendly)

This schema is designed for easy import/export to Google Sheets. Use one spreadsheet with multiple sheets. Keep values small and consistent to minimize data entry effort.

## Sheets

### 1) People

Store one row per person.

Columns:
- `person_id` (required): stable unique id. Example: `P0001`
- `full_name` (required): display name
- `birth_year` (optional): 4-digit year, e.g. `1984`
- `gender` (optional): `M`, `F`, `X`, `U` (unknown)
- `child_order` (optional): numeric sort order for siblings (smaller = earlier)

Example:

```
person_id,full_name,birth_year,gender
P0001,Asha Patel,1954,F
P0002,Dev Patel,1952,M
P0003,Neha Patel,1980,F
```

### 2) Relationships

Store one row per relationship. Use `person1_id` and `person2_id` to reference `People.person_id`.

Columns:
- `relation_id` (required): stable unique id. Example: `R0001`
- `person1_id` (required)
- `person2_id` (required)
- `relation_type` (required): `parent` or `spouse`
- `relation_date` (optional): for `spouse`, date or year of marriage (YYYY or YYYY-MM-DD)
- `end_date` (optional): for `spouse`, date/year of divorce or separation

Direction rules:
- If `relation_type = parent`, then `person1_id` is the parent and `person2_id` is the child.
- If `relation_type = spouse`, order does not matter.

Example:

```
relation_id,person1_id,person2_id,relation_type,relation_date,end_date
R0001,P0001,P0003,parent,,
R0002,P0002,P0003,parent,,
R0003,P0001,P0002,spouse,1977,
```

## Google Sheets Tips
- Use separate sheets named `People` and `Relationships`.
- Keep IDs stable so you can import/export without breaking links.
- When exporting CSV, export each sheet separately (one CSV per sheet).

## Notes
- This schema intentionally limits personal details (name, birth year, gender).
- If you later need adoption, guardianship, or step-relationships, we can extend `relation_type` and add a `relation_note` column.

## TODO: Natural-Language Update Workflow

Goal: Let a user submit plain text updates (for example, "Add X as spouse of Y"), show a confirmation diff, and apply changes to a single server-side source of truth with git commits.

Reference implementation scaffold: see `docs/cloudflare-worker.md` and `worker/src/index.js`.

### Phase 1: Server Source of Truth
- [ ] Move authoritative data from local-only workflow to server-managed storage.
- [ ] Keep canonical CSV files (`people.csv`, `relationships.csv`) in a server-side git repo.
- [ ] Expose read API for current tree data and metadata (latest commit SHA, last update time).

### Phase 2: LLM Change Proposal
- [ ] Add endpoint to accept user text instructions.
- [ ] Build prompt contract that returns structured operations, not free text.
- [ ] Required operation types:
  - `add_person`
  - `update_person`
  - `add_relationship`
  - `update_relationship`
  - `delete_relationship` (optional, but useful for corrections)
- [ ] Require each operation to include machine-checkable fields (ids, names, relation types, confidence, assumptions).

### Phase 3: Validation + Delta Preview
- [ ] Validate proposed operations against schema and referential integrity.
- [ ] Detect ambiguities (for example duplicate names) and return clarification questions.
- [ ] Generate a user-facing delta preview before apply:
  - rows to add
  - rows to update
  - rows to delete
  - inferred links (for example spouse->parent assumptions) explicitly flagged
- [ ] Require explicit user confirmation token before apply.

### Phase 4: Apply + Git Commit
- [ ] Apply approved operations to canonical CSV files server-side.
- [ ] Re-run generator and encryption pipeline after apply.
- [ ] Commit changes with deterministic commit message template:
  - `data: apply natural-language update <request_id>`
- [ ] Push commit to remote branch (`main`) and publish encrypted site payload.

### Phase 5: Safety and Auditability
- [ ] Persist request log: raw prompt, model response, validation result, approver, commit SHA.
- [ ] Add rollback endpoint to revert to a prior commit SHA.
- [ ] Add branch protection and token-scoped CI user for server commits.
- [ ] Add PII-safe logging policy (never log passphrases, redact sensitive fields).

### Acceptance Criteria
- [ ] A plain-text instruction can be transformed into a valid proposal without editing files manually.
- [ ] User sees exact deltas and can approve/reject before changes are applied.
- [ ] Approved changes are committed and pushed automatically.
- [ ] Live page reflects updated encrypted payload after publish.
