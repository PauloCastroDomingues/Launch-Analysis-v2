#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumKnown(rows, field) {
  const values = rows
    .map((row) => numberOrNull(row[field]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupBy(rows, keyFn) {
  return rows.reduce((map, row) => {
    const key = keyFn(row);
    const current = map.get(key) || [];
    current.push(row);
    map.set(key, current);
    return map;
  }, new Map());
}

const metasPayload = readJson('metas_mensais.json', { rows: [] });
const midiaRows = readJson('midia_paga.json', []);
const crmRows = readJson('crm_disparos.json', []);
const manifest = readJson('manifest.json', {});
const modelos = readJson('lancamentos_modelos.json', []);

const metasRows = Array.isArray(metasPayload.rows) ? metasPayload.rows : [];
const dailyRows = metasRows.flatMap((month) => (
  (Array.isArray(month.daily) ? month.daily : []).map((row) => ({ ...row, mes: month.mes }))
));
const dailyWithInvestment = dailyRows.filter((row) => numberOrNull(row.investimento_realizado) !== null);
const windowDays = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };

function addDaysIso(iso, days) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if ([y, m, d].some(Number.isNaN)) return null;
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function investmentWindow(model, key) {
  const d0 = model.day_zero_base;
  const end = addDaysIso(d0, windowDays[key]);
  if (!d0 || !end) return null;
  const rows = dailyRows.filter((row) => row.data >= d0 && row.data <= end);
  const investmentRows = rows.filter((row) => numberOrNull(row.investimento_realizado) !== null);
  return {
    janela: key,
    range: `${d0}..${end}`,
    dias_com_investimento: investmentRows.length,
    investimento: round(sumKnown(investmentRows, 'investimento_realizado')),
    receita: round(sumKnown(investmentRows, 'realizado_receita')),
    pedidos: round(sumKnown(investmentRows, 'realizado_pedidos'))
  };
}

const monthlyInvestment = metasRows
  .filter((row) => (
    numberOrNull(row.meta_investimento) !== null
    || numberOrNull(row.investimento_realizado) !== null
    || numberOrNull(row.investimento_aquisicao) !== null
  ))
  .map((row) => ({
    mes: row.mes,
    meta_investimento: round(numberOrNull(row.meta_investimento)),
    investimento_realizado_targets: round(numberOrNull(row.investimento_realizado)),
    investimento_aquisicao: round(numberOrNull(row.investimento_aquisicao)),
    diferenca_aquisicao_vs_targets_pct: (
      numberOrNull(row.investimento_realizado) && numberOrNull(row.investimento_aquisicao) !== null
        ? round((numberOrNull(row.investimento_aquisicao) / numberOrNull(row.investimento_realizado)) - 1, 4)
        : null
    ),
    receita_aquisicao: round(numberOrNull(row.receita_aquisicao)),
    pedidos_aquisicao: round(numberOrNull(row.pedidos_aquisicao)),
    roas_aquisicao: round(numberOrNull(row.roas_aquisicao), 4),
    canais: (row.canais_aquisicao || []).map((canal) => ({
      canal: canal.canal,
      investimento: round(numberOrNull(canal.investimento)),
      receita: round(numberOrNull(canal.receita)),
      pedidos: round(numberOrNull(canal.pedidos)),
      roas: round(numberOrNull(canal.roas), 4)
    }))
  }));

const midiaByModel = [...groupBy(midiaRows, (row) => row.modelo_id || `linha:${row.linha || 'sem_modelo'}`).entries()]
  .map(([modelo_id, rows]) => ({
    modelo_id,
    linhas: rows.length,
    investimento: round(sumKnown(rows, 'investimento')),
    com_receita_atribuida: rows.filter((row) => numberOrNull(row.receita_atribuida) !== null).length,
    sem_data_inicio_ou_fim: rows.filter((row) => !row.data_inicio || !row.data_fim).length,
    marcadas_suspeitas: rows.filter((row) => row.data_suspeita || row.valor_suspeito).length
  }));

const crmByModel = [...groupBy(crmRows, (row) => row.modelo_id || 'sem_modelo').entries()]
  .map(([modelo_id, rows]) => ({
    modelo_id,
    linhas: rows.length,
    investimento: round(sumKnown(rows, 'investimento')),
    com_roas: rows.filter((row) => numberOrNull(row.roas) !== null).length,
    metodologia_correlacao: rows.filter((row) => row.metodologia === 'correlacao_por_janela_calendario').length
  }));

const ssotByLaunch = modelos
  .filter((model) => ['historico', 'ativo'].includes(String(model.status || '').toLowerCase()) && model.day_zero_base)
  .map((model) => {
    const windows = Object.keys(windowDays).map((key) => investmentWindow(model, key)).filter(Boolean);
    return {
      modelo_id: model.modelo_id,
      modelo: model.modelo,
      d0: model.day_zero_base,
      janelas_com_investimento: windows.filter((row) => row.investimento !== null).length,
      janelas: windows
    };
  });

const issues = [];
const warnings = [];
if (!metasRows.length) issues.push('metas_mensais.json sem rows.');
if (!dailyWithInvestment.length) issues.push('metas_mensais.daily sem investimento_realizado.');
if (!monthlyInvestment.some((row) => row.investimento_aquisicao !== null)) {
  issues.push('Sem investimento_aquisicao mensal vindo de aquisicao_por_canal.');
}
if (midiaRows.length && !midiaRows.some((row) => numberOrNull(row.receita_atribuida) !== null)) {
  issues.push('midia_paga.json tem investimento, mas nenhuma receita_atribuida real.');
}
ssotByLaunch
  .filter((row) => !row.janelas_com_investimento)
  .forEach((row) => warnings.push(`${row.modelo_id} sem investimento SSOT nas janelas do lancamento; dashboard usa planilha manual/fallback.`));
if (manifest?.export_status?.impacto_investimento !== 'deprecated') {
  issues.push('impacto_investimento ainda nao aparece como deprecated no manifest.');
}

const output = {
  ok: issues.length === 0,
  generated_at: new Date().toISOString(),
  manifest_generated_at: manifest.generated_at || null,
  metas_mensais: {
    meses_com_investimento: monthlyInvestment.length,
    dias_com_investimento_realizado: dailyWithInvestment.length,
    total_meta_investimento: round(sumKnown(metasRows, 'meta_investimento')),
    total_investimento_realizado_targets: round(sumKnown(metasRows, 'investimento_realizado')),
    total_investimento_aquisicao: round(sumKnown(metasRows, 'investimento_aquisicao')),
    meses: monthlyInvestment
  },
  cobertura_ssot_por_lancamento: ssotByLaunch,
  midia_paga_manual: {
    linhas: midiaRows.length,
    investimento_total: round(sumKnown(midiaRows, 'investimento')),
    por_modelo: midiaByModel
  },
  crm_manual: {
    linhas: crmRows.length,
    investimento_total: round(sumKnown(crmRows, 'investimento')),
    por_modelo: crmByModel
  },
  warnings,
  issues
};

console.log(JSON.stringify(output, null, 2));
