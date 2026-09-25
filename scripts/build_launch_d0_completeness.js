const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
}

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function buildCompleteness({ models, ramp, manifest }) {
  const snapshot = dateOnly(manifest.generated_at);
  const firstObserved = new Map();

  ramp.forEach((row) => {
    const id = row.modelo_id;
    const value = dateOnly(row.data || row.data_venda);
    if (!id || !value) return;
    if (!firstObserved.has(id) || value < firstObserved.get(id)) firstObserved.set(id, value);
  });

  const launches = models
    .filter((model) => ['historico', 'ativo'].includes(String(model.status || '').toLowerCase()))
    .map((model) => {
      const officialDate = dateOnly(model.data_oficial || model.data_lancamento);
      const analyticalD0 = dateOnly(model.day_zero_base);
      const coverageStart = firstObserved.get(model.modelo_id) || analyticalD0;
      const expectedDays = officialDate && snapshot && officialDate <= snapshot
        ? daysBetween(officialDate, snapshot) + 1
        : null;
      const coveredDays = coverageStart && snapshot && coverageStart <= snapshot
        ? daysBetween(coverageStart, snapshot) + 1
        : 0;
      const gapDays = Number.isFinite(expectedDays) ? Math.max(0, expectedDays - coveredDays) : null;
      const coveragePct = expectedDays ? coveredDays / expectedDays : null;
      const missingRanges = gapDays > 0 && officialDate && coverageStart
        ? [{ start: officialDate, end: addDays(coverageStart, -1), days: gapDays }]
        : [];
      const status = gapDays === 0
        ? 'completo'
        : coveredDays > 0
          ? 'gap_historico'
          : 'sem_cobertura';

      return {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        data_oficial: officialDate,
        d0_analitico_atual: analyticalD0,
        primeiro_dia_coberto: coverageStart,
        ultimo_dia_coberto: coveredDays ? snapshot : null,
        dias_esperados: expectedDays,
        dias_cobertos: coveredDays,
        dias_em_gap: gapDays,
        cobertura_pct: Number.isFinite(coveragePct) ? Number(coveragePct.toFixed(6)) : null,
        status,
        intervalos_sem_cobertura: missingRanges,
        fonte_coberta_atual: 'reise-ssot.mart_shared.fct_order_item',
        fonte_backfill_planejada: 'reise-ssot.stg.shoppub_orders_tbl + fct_order_item',
        regra_zero: 'zero somente dentro de periodo com fonte confirmada'
      };
    });

  return {
    generated_at: new Date().toISOString(),
    snapshot,
    status: launches.every((item) => item.status === 'completo') ? 'completo' : 'incompleto',
    launches
  };
}

function build() {
  return buildCompleteness({
    models: readJson('lancamentos_modelos.json'),
    ramp: readJson('lancamentos_rampa_dia.json'),
    manifest: readJson('manifest.json')
  });
}

if (require.main === module) {
  const output = build();
  fs.writeFileSync(path.join(DATA, 'lancamentos_completude_d0.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Completude D0 gerada para ${output.launches.length} lancamentos.\n`);
}

module.exports = { addDays, build, buildCompleteness, daysBetween };
