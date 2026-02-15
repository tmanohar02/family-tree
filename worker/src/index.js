const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      if (method === "GET" && url.pathname === "/health") {
        return withCors(json({ ok: true, service: "family-tree-worker" }));
      }

      if (method === "GET" && url.pathname === "/api/tree") {
        const state = await loadState(env);
        return withCors(json({
          ok: true,
          commit: state.commitSha,
          data_blob_path: state.dataBlobPath,
          encrypted_data: state.encryptedPayload
        }));
      }

      if (method === "POST" && url.pathname === "/api/changes/propose") {
        requireAuth(request, env);
        const body = await parseJson(request);
        assert(body && typeof body.instruction === "string" && body.instruction.trim(), "instruction is required");

        const state = await loadState(env);
        const proposal = await proposeOperations(body.instruction.trim(), state, env);
        validateOperationEnvelope(proposal);

        return withCors(json({ ok: true, proposal }));
      }

      if (method === "POST" && url.pathname === "/api/changes/preview") {
        requireAuth(request, env);
        const body = await parseJson(request);
        assert(Array.isArray(body?.operations), "operations array is required");

        const state = await loadState(env);
        const result = applyOperations(state, body.operations);

        return withCors(json({
          ok: true,
          assumptions: body.assumptions || [],
          warnings: result.warnings,
          delta: result.delta,
          next: {
            people_count: result.nextPeople.length,
            relationships_count: result.nextRelationships.length
          }
        }));
      }

      if (method === "POST" && url.pathname === "/api/changes/apply") {
        requireAuth(request, env);
        const body = await parseJson(request);
        assert(Array.isArray(body?.operations), "operations array is required");

        const state = await loadState(env);
        const result = applyOperations(state, body.operations);

        const peopleCsv = stringifyCsv(result.nextPeople, ["person_id", "full_name", "birth_year", "gender", "child_order"]);
        const relsCsv = stringifyCsv(result.nextRelationships, ["relation_id", "person1_id", "person2_id", "relation_type", "relation_date", "end_date"]);

        const commitMessage = typeof body.commit_message === "string" && body.commit_message.trim()
          ? body.commit_message.trim()
          : "data: apply natural-language update";

        const commitSha = await commitCsvFiles({ env, peopleCsv, relsCsv, commitMessage });

        if (env.PUBLISH_WORKFLOW_FILE && env.PUBLISH_WORKFLOW_FILE.trim()) {
          await triggerPublishWorkflow(env, commitSha);
        }

        return withCors(json({
          ok: true,
          commit_sha: commitSha,
          delta: result.delta,
          warnings: result.warnings
        }));
      }

      return withCors(json({ ok: false, error: "Not found" }, 404));
    } catch (err) {
      const status = err.status || 400;
      return withCors(json({ ok: false, error: err.message || "Request failed" }, status));
    }
  }
};

function withCors(response) {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type,authorization");
  return response;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), { status, headers: JSON_HEADERS });
}

function assert(condition, message, status = 400) {
  if (!condition) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

function requireAuth(request, env) {
  assert(env.API_TOKEN, "API_TOKEN is not configured", 500);
  const auth = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.API_TOKEN}`;
  assert(auth === expected, "Unauthorized", 401);
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw withStatus("Invalid JSON body", 400);
  }
}

function withStatus(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadState(env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";

  assert(owner && repo, "GitHub repo config missing", 500);

  const ref = await githubApi(env, `repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const commitSha = ref.object.sha;

  const dataBlobPath = env.DATA_BLOB_PATH || "canonical.enc.json";
  const blobFile = await getFileContent(env, dataBlobPath, branch);
  const canonical = await decryptCanonical(blobFile.content, env);
  assert(typeof canonical.people_csv === "string", "people_csv missing in decrypted payload");
  assert(typeof canonical.relationships_csv === "string", "relationships_csv missing in decrypted payload");

  return {
    commitSha,
    dataBlobPath,
    blobSha: blobFile.sha,
    encryptedPayload: blobFile.content,
    people: parseCsv(canonical.people_csv),
    relationships: parseCsv(canonical.relationships_csv)
  };
}

async function getFileContent(env, path, branch) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const res = await githubApi(env, `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  const content = atob((res.content || "").replace(/\n/g, ""));
  return { sha: res.sha, content };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return [];
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function stringifyCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    const cells = headers.map((h) => encodeCsvValue(row[h] ?? ""));
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function encodeCsvValue(value) {
  const v = String(value ?? "");
  if (!/[",\n]/.test(v)) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

function validateOperationEnvelope(proposal) {
  assert(proposal && typeof proposal === "object", "proposal must be object");
  assert(Array.isArray(proposal.operations), "proposal.operations must be array");
}

function applyOperations(state, operations) {
  const people = state.people.map((p) => ({ ...p }));
  const relationships = state.relationships.map((r) => ({ ...r }));

  const peopleById = new Map(people.map((p) => [p.person_id, p]));
  const relById = new Map(relationships.map((r) => [r.relation_id, r]));

  const warnings = [];

  for (const op of operations) {
    assert(op && typeof op === "object", "operation must be object");
    const kind = op.op;

    if (kind === "add_person") {
      const person = op.person || {};
      const personId = person.person_id || nextId("P", peopleById.keys());
      assert(!peopleById.has(personId), `person_id already exists: ${personId}`);

      const row = {
        person_id: personId,
        full_name: person.full_name || "",
        birth_year: person.birth_year || "",
        gender: person.gender || "U",
        child_order: person.child_order || ""
      };

      people.push(row);
      peopleById.set(row.person_id, row);
      continue;
    }

    if (kind === "update_person") {
      assert(typeof op.person_id === "string" && op.person_id, "update_person.person_id required");
      const row = peopleById.get(op.person_id);
      assert(row, `person not found: ${op.person_id}`);
      const changes = op.changes || {};

      for (const key of ["full_name", "birth_year", "gender", "child_order"]) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          row[key] = changes[key] ?? "";
        }
      }
      continue;
    }

    if (kind === "add_relationship") {
      const rel = op.relationship || {};
      const relationId = rel.relation_id || nextId("R", relById.keys());
      assert(!relById.has(relationId), `relation_id already exists: ${relationId}`);
      assert(peopleById.has(rel.person1_id), `person1_id not found: ${rel.person1_id}`);
      assert(peopleById.has(rel.person2_id), `person2_id not found: ${rel.person2_id}`);
      assert(["parent", "spouse"].includes(rel.relation_type), "relation_type must be parent or spouse");

      const row = {
        relation_id: relationId,
        person1_id: rel.person1_id,
        person2_id: rel.person2_id,
        relation_type: rel.relation_type,
        relation_date: rel.relation_date || "",
        end_date: rel.end_date || ""
      };

      relationships.push(row);
      relById.set(row.relation_id, row);
      continue;
    }

    if (kind === "update_relationship") {
      assert(typeof op.relation_id === "string" && op.relation_id, "update_relationship.relation_id required");
      const row = relById.get(op.relation_id);
      assert(row, `relationship not found: ${op.relation_id}`);
      const changes = op.changes || {};

      for (const key of ["person1_id", "person2_id", "relation_type", "relation_date", "end_date"]) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          row[key] = changes[key] ?? "";
        }
      }

      if (changes.person1_id) assert(peopleById.has(row.person1_id), `person1_id not found: ${row.person1_id}`);
      if (changes.person2_id) assert(peopleById.has(row.person2_id), `person2_id not found: ${row.person2_id}`);
      if (changes.relation_type) assert(["parent", "spouse"].includes(row.relation_type), "relation_type must be parent or spouse");

      continue;
    }

    if (kind === "delete_relationship") {
      assert(typeof op.relation_id === "string" && op.relation_id, "delete_relationship.relation_id required");
      const row = relById.get(op.relation_id);
      assert(row, `relationship not found: ${op.relation_id}`);
      relById.delete(op.relation_id);
      const idx = relationships.findIndex((r) => r.relation_id === op.relation_id);
      if (idx >= 0) relationships.splice(idx, 1);
      continue;
    }

    throw withStatus(`Unsupported operation: ${kind}`, 400);
  }

  validateState(people, relationships, warnings);
  const delta = computeDelta(state.people, state.relationships, people, relationships);

  return {
    nextPeople: people,
    nextRelationships: relationships,
    warnings,
    delta
  };
}

function validateState(people, relationships, warnings) {
  const peopleIds = new Set(people.map((p) => p.person_id));

  for (const rel of relationships) {
    if (!peopleIds.has(rel.person1_id) || !peopleIds.has(rel.person2_id)) {
      throw withStatus(`relationship ${rel.relation_id} references unknown person`, 400);
    }
    if (!["parent", "spouse"].includes(rel.relation_type)) {
      throw withStatus(`relationship ${rel.relation_id} has invalid relation_type`, 400);
    }
  }

  const seen = new Set();
  for (const rel of relationships) {
    if (seen.has(rel.relation_id)) {
      throw withStatus(`duplicate relation_id: ${rel.relation_id}`, 400);
    }
    seen.add(rel.relation_id);
  }

  const names = new Map();
  for (const p of people) {
    const name = (p.full_name || "").trim().toLowerCase();
    if (!name) continue;
    names.set(name, (names.get(name) || 0) + 1);
  }
  for (const [name, count] of names.entries()) {
    if (count > 1) {
      warnings.push(`duplicate_name:${name}`);
    }
  }
}

function computeDelta(prevPeople, prevRels, nextPeople, nextRels) {
  const peopleDelta = computeRowDelta(prevPeople, nextPeople, "person_id");
  const relDelta = computeRowDelta(prevRels, nextRels, "relation_id");
  return {
    people: peopleDelta,
    relationships: relDelta
  };
}

function computeRowDelta(prevRows, nextRows, key) {
  const prev = new Map(prevRows.map((r) => [r[key], r]));
  const next = new Map(nextRows.map((r) => [r[key], r]));

  const added = [];
  const updated = [];
  const removed = [];

  for (const [id, row] of next.entries()) {
    if (!prev.has(id)) {
      added.push(row);
      continue;
    }
    const before = prev.get(id);
    if (JSON.stringify(before) !== JSON.stringify(row)) {
      updated.push({ before, after: row });
    }
  }

  for (const [id, row] of prev.entries()) {
    if (!next.has(id)) {
      removed.push(row);
    }
  }

  return { added, updated, removed };
}

function nextId(prefix, existingKeys) {
  let max = 0;
  for (const id of existingKeys) {
    const m = String(id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function proposeOperations(instruction, state, env) {
  assert(env.OPENAI_API_KEY, "OPENAI_API_KEY is not configured", 500);

  const system = [
    "You generate family tree CSV update operations.",
    "Output strict JSON only with keys: operations, assumptions, questions.",
    "Allowed operations: add_person, update_person, add_relationship, update_relationship, delete_relationship.",
    "Never invent person IDs if person can be matched by exact existing name; prefer update/add relationships.",
    "If ambiguous, return no risky operation and put clarification prompts in questions."
  ].join(" ");

  const payload = {
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "family_tree_ops",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            operations: {
              type: "array",
              items: { type: "object" }
            },
            assumptions: {
              type: "array",
              items: { type: "string" }
            },
            questions: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["operations", "assumptions", "questions"]
        }
      }
    },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          instruction,
          schema: {
            people_columns: ["person_id", "full_name", "birth_year", "gender", "child_order"],
            relationship_columns: ["relation_id", "person1_id", "person2_id", "relation_type", "relation_date", "end_date"]
          },
          people: state.people,
          relationships: state.relationships
        })
      }
    ]
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw withStatus(`OpenAI error: ${response.status} ${text}`, 502);
  }

  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content;
  assert(typeof content === "string" && content.trim(), "LLM returned empty response", 502);

  try {
    return JSON.parse(content);
  } catch {
    throw withStatus("LLM response was not valid JSON", 502);
  }
}

async function commitCsvFiles({ env, peopleCsv, relsCsv, commitMessage }) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";

  assert(env.GITHUB_TOKEN, "GITHUB_TOKEN is not configured", 500);

  const ref = await githubApi(env, `repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const parentCommitSha = ref.object.sha;
  const parentCommit = await githubApi(env, `repos/${owner}/${repo}/git/commits/${parentCommitSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  const encryptedPayload = await encryptCanonical({ people_csv: peopleCsv, relationships_csv: relsCsv }, env);

  const dataBlob = await githubApi(env, `repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    body: {
      content: encryptedPayload,
      encoding: "utf-8"
    }
  });

  const newTree = await githubApi(env, `repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseTreeSha,
      tree: [
        {
          path: env.DATA_BLOB_PATH || "canonical.enc.json",
          mode: "100644",
          type: "blob",
          sha: dataBlob.sha
        }
      ]
    }
  });

  const newCommit = await githubApi(env, `repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: {
      message: commitMessage,
      tree: newTree.sha,
      parents: [parentCommitSha]
    }
  });

  await githubApi(env, `repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: {
      sha: newCommit.sha,
      force: false
    }
  });

  return newCommit.sha;
}

async function encryptCanonical(payload, env) {
  assert(env.DATA_KEY_B64, "DATA_KEY_B64 is not configured", 500);
  const key = b64ToBytes(env.DATA_KEY_B64);
  assert(key.length === 32, "DATA_KEY_B64 must decode to 32 bytes", 500);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext);
  const encrypted = new Uint8Array(encryptedBuffer);
  const envelope = {
    version: 1,
    alg: "AES-GCM-256",
    iv: bytesToB64(iv),
    data: bytesToB64(encrypted)
  };
  return JSON.stringify(envelope, null, 2);
}

async function decryptCanonical(content, env) {
  assert(env.DATA_KEY_B64, "DATA_KEY_B64 is not configured", 500);
  const key = b64ToBytes(env.DATA_KEY_B64);
  assert(key.length === 32, "DATA_KEY_B64 must decode to 32 bytes", 500);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);

  let envelope;
  try {
    envelope = JSON.parse(content);
  } catch {
    throw withStatus("Canonical encrypted blob is not valid JSON", 500);
  }
  assert(envelope && envelope.version === 1, "Unsupported canonical blob version", 500);
  assert(envelope.alg === "AES-GCM-256", "Unsupported canonical blob algorithm", 500);

  const iv = b64ToBytes(envelope.iv || "");
  const data = b64ToBytes(envelope.data || "");
  let decrypted;
  try {
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, data);
    decrypted = new Uint8Array(out);
  } catch {
    throw withStatus("Failed to decrypt canonical blob", 500);
  }
  try {
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw withStatus("Failed to decrypt canonical blob", 500);
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function triggerPublishWorkflow(env, commitSha) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const workflow = env.PUBLISH_WORKFLOW_FILE;

  await githubApi(env, `repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: "POST",
    body: {
      ref: branch,
      inputs: {
        commit_sha: commitSha
      }
    }
  });
}

async function githubApi(env, path, options = {}) {
  assert(env.GITHUB_TOKEN, "GITHUB_TOKEN is not configured", 500);
  const url = `https://api.github.com/${path}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "family-tree-worker",
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    throw withStatus(`GitHub API ${response.status}: ${text}`, 502);
  }

  return text ? JSON.parse(text) : {};
}
