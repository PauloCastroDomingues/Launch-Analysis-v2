#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_JSON_FILES = [
  path.join(ROOT, 'data', 'lancamentos_produtos_dia.json')
];
const EMBEDDED_PATH = path.join(ROOT, 'assets', 'embedded-data.js');
const FORBIDDEN_KEYS = new Set([
  'source_order_id',
  'order_name',
  'atribuicao_match_key'
]);

function sanitize(value, stats) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, stats));
  if (!value || typeof value !== 'object') return value;

  const output = {};
  Object.entries(value).forEach(([key, child]) => {
    if (FORBIDDEN_KEYS.has(key)) {
      stats[key] = (stats[key] || 0) + 1;
      return;
    }
    output[key] = sanitize(child, stats);
  });
  return output;
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function sanitizeJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const stats = {};
  const sanitized = sanitize(payload, stats);
  if (Object.keys(stats).length) writeJson(filePath, sanitized);
  return { file: path.relative(ROOT, filePath), removed: stats };
}

function readEmbeddedData(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/window\.REISE_FALLBACK_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error(`Formato inesperado em ${path.relative(ROOT, filePath)}.`);
  return JSON.parse(match[1]);
}

function sanitizeEmbedded(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const payload = readEmbeddedData(filePath);
  const stats = {};
  const sanitized = sanitize(payload, stats);
  if (Object.keys(stats).length) {
    fs.writeFileSync(filePath, `window.REISE_FALLBACK_DATA = ${JSON.stringify(sanitized, null, 2)};\n`, 'utf8');
  }
  return { file: path.relative(ROOT, filePath), removed: stats };
}

const results = [
  ...PUBLIC_JSON_FILES.map(sanitizeJsonFile),
  sanitizeEmbedded(EMBEDDED_PATH)
].filter(Boolean);

console.log(JSON.stringify({
  ok: true,
  forbidden_keys: [...FORBIDDEN_KEYS],
  results
}, null, 2));
