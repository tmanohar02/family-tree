#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = '/home/tmanohar02/Projects/FamilyTree';
const peoplePath = path.join(repoRoot, 'data/templates/people.csv');
const relsPath = path.join(repoRoot, 'data/templates/relationships.csv');
const outDir = path.join(repoRoot, 'data/derived');
const outPath = path.join(outDir, 'family-chart-data.json');

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const headers = parseLine(lines.shift());
  return lines.map(line => {
    const cells = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

function parseLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function pushUnique(arr, value) {
  if (!arr.includes(value)) arr.push(value);
}

const peopleCsv = fs.readFileSync(peoplePath, 'utf8');
const relsCsv = fs.readFileSync(relsPath, 'utf8');

const people = parseCsv(peopleCsv);
const rels = parseCsv(relsCsv);

const byId = new Map();
for (const p of people) {
  if (!p.person_id) continue;
  byId.set(p.person_id, {
    id: p.person_id,
    data: {
      name: p.full_name || '',
      birth_year: p.birth_year || '',
      gender: p.gender || 'U'
    },
    rels: {
      parents: [],
      spouses: [],
      children: []
    }
  });
}

for (const r of rels) {
  const p1 = byId.get(r.person1_id);
  const p2 = byId.get(r.person2_id);
  if (!p1 || !p2) continue;

  if (r.relation_type === 'parent') {
    pushUnique(p1.rels.children, p2.id);
    pushUnique(p2.rels.parents, p1.id);
  } else if (r.relation_type === 'spouse') {
    pushUnique(p1.rels.spouses, p2.id);
    pushUnique(p2.rels.spouses, p1.id);
  }
}

const MAIN_ID = 'P0004'; // Ramana
const allData = Array.from(byId.values());
const data = [
  ...allData.filter(d => d.id === MAIN_ID),
  ...allData.filter(d => d.id !== MAIN_ID)
];
fs.mkdirSync(outDir, { recursive: true });
const out = JSON.stringify(data, null, 2);

fs.writeFileSync(outPath, out, 'utf8');
console.log(`Wrote ${outPath}`);
