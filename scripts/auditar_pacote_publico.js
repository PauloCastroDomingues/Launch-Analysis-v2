#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const EMBEDDED_PATH = path.join(ROOT, 'assets', 'embedded-data.js');
const FORBIDDEN_KEYS = new Set([
  'source_order_id',
  'order_name',
  'atribuicao_match_key',
  'customer_email',
  'customer_phone',
  'customer_phone_digits',
  'email_norm',
  'phone_norm',
  'cpf',
  'cnpj',
  'documento'
]);
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SECRET_PATTERN = /(api[_-]?key|secret|token|password|passwd|bearer|private_key|client_secret|refresh_token)\s*[:=]\s*["'][^"']{8,}/i;

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function walk(value, location, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${location}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== 'object') return;

  Object.entries(value).forEach(([key, child]) => {
    const childLocation = `${location}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) {
      findings.push({ type: 'forbidden_key', location: childLocation });
    }
    if (typeof child === 'string') {
      if (EMAIL_PATTERN.test(child)) findings.push({ type: 'email_value', location: childLocation });
      if (SECRET_PATTERN.test(child)) findings.push({ type: 'secret_like_value', location: childLocation });
    }
    walk(child, childLocation, findings);
  });
}

function readEmbeddedData(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/window\.REISE_FALLBACK_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error(`Formato inesperado em ${relative(filePath)}.`);
  return JSON.parse(match[1]);
}

function auditJsonFile(filePath) {
  const findings = [];
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  walk(payload, relative(filePath), findings);
  return findings;
}

function auditEmbedded(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const findings = [];
  walk(readEmbeddedData(filePath), relative(filePath), findings);
  return findings;
}

const dataFiles = fs.readdirSync(DATA_DIR)
  .filter((name) => name.endsWith('.json') && !name.includes('.local-'))
  .map((name) => path.join(DATA_DIR, name));

const findings = [
  ...dataFiles.flatMap(auditJsonFile),
  ...auditEmbedded(EMBEDDED_PATH)
];

if (findings.length) {
  console.error(JSON.stringify({
    ok: false,
    message: 'Pacote publico contem chaves ou valores sensiveis.',
    findings: findings.slice(0, 80),
    total_findings: findings.length
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checked_files: dataFiles.length + (fs.existsSync(EMBEDDED_PATH) ? 1 : 0),
  forbidden_keys: [...FORBIDDEN_KEYS]
}, null, 2));
