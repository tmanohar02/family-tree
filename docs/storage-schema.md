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
