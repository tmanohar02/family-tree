# Family Tree Architecture

This project has two data paths:
- `Read/visualize` path for the public GitHub Pages app.
- `Edit/apply` path through Cloudflare Worker to a private encrypted canonical store.

## System Diagram

```mermaid
flowchart LR
  U[User Browser] -->|HTTPS GET| GH[GitHub Pages<br/>local-csv-demo/index.html]
  GH -->|HTTPS GET| ENC[data.enc.<version>.json<br/>Encrypted payload]
  ENC -->|Base64 decode salt/iv/data| U
  U -->|PBKDF2 + AES-GCM decrypt<br/>with passphrase| TREE[Decrypted family JSON in memory]
  TREE --> CHART[family-chart render]

  U -->|HTTPS POST /api/changes/propose| W[Cloudflare Worker]
  U -->|HTTPS POST /api/changes/preview| W
  U -->|HTTPS POST /api/changes/apply| W
  W -->|HTTPS API call| OAI[OpenAI API]

  W -->|HTTPS GitHub API read| PR[Private repo: family-tree-data]
  PR -->|canonical.enc.json| W
  W -->|Base64 decode iv/data + AES-GCM decrypt<br/>with DATA_KEY_B64| CSV[people.csv + relationships.csv in memory]
  CSV -->|parse/decode CSV rows| OPS[Apply validated operations]
  OPS -->|stringify/encode CSV text| CSV2[updated CSV text]
  CSV2 -->|AES-GCM encrypt + Base64 encode iv/data| CANON[canonical.enc.json]
  W -->|HTTPS GitHub API commit| PR

  PR -.optional publish trigger.-> PUB[Publish pipeline]
  PUB -->|csv-to-family-chart + encrypt-family-data| ENC
```

## Where Security + Encoding Happen

- In flight:
  - Browser ↔ GitHub Pages: HTTPS (TLS).
  - Browser ↔ Worker: HTTPS (TLS) + `Authorization: Bearer <API_TOKEN>` for mutating endpoints.
  - Worker ↔ GitHub/OpenAI: HTTPS (TLS).

- At rest:
  - Private canonical store: `canonical.enc.json` is AES-GCM encrypted (key: `DATA_KEY_B64` in Worker secrets).
  - Public visualization payload: `data.enc.<version>.json` is AES-GCM encrypted with passphrase-derived key (PBKDF2).

- Encode/decode:
  - Encrypted binary fields (`salt`, `iv`, `ciphertext`) are Base64-encoded in JSON envelopes.
  - CSV is decoded (parse) to row objects in memory, then encoded (stringify) back to CSV before commit.
