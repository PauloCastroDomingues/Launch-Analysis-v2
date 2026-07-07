/**
 * Reise Launch Analysis v2
 * Exporta Google Sheets + BigQuery para /data/*.json do repositório GitHub.
 *
 * Propriedades esperadas em Script Properties:
 * - BQ_PROJECT_ID = reise-ssot
 * - GITHUB_TOKEN
 * - GITHUB_REPO = owner/repo
 * - GITHUB_BRANCH = main
 * - DATA_PATH = data
 *
 * Serviços avançados necessários:
 * - BigQuery API
 */

const CONFIG = {
  bqProjectId: getProp_('BQ_PROJECT_ID', 'reise-ssot'),
  bqLocation: 'southamerica-east1',
  githubRepo: getProp_('GITHUB_REPO', ''),
  githubBranch: getProp_('GITHUB_BRANCH', 'main'),
  dataPath: getProp_('DATA_PATH', 'data'),
  timeZone: 'America/Sao_Paulo'
};

function exportarTudo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const modelos = sheetToObjects_(ss.getSheetByName('lancamentos_modelos'));
  const midia = sheetToObjects_(ss.getSheetByName('midia_paga'));
  const crm = sheetToObjects_(ss.getSheetByName('crm_disparos'));
  const ativos = modelos.filter(m => ['ativo', 'pipeline'].includes(String(m.status || '').toLowerCase()));

  const produtosDia = ativos.length ? consultarProdutosDia_(ativos) : [];
  const estoque = ativos.length ? consultarEstoque_(ativos) : [];
  const manifest = {
    generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    project: 'Reise Launch Analysis v2',
    active_models: ativos.map(m => m.modelo_id),
    files: [
      'lancamentos_modelos.json',
      'lancamentos_produtos_dia.json',
      'midia_paga.json',
      'crm_disparos.json',
      'estoque.json',
      'manifest.json'
    ],
    warnings: [
      'Filtros de data usam >= para incluir D0.',
      'Dados ausentes devem permanecer null/—; nunca transformar em zero.',
      'GT deve usar day_zero_base 2025-02-11.'
    ]
  };

  escreverJsonGitHub_('lancamentos_modelos.json', modelos);
  escreverJsonGitHub_('midia_paga.json', midia);
  escreverJsonGitHub_('crm_disparos.json', crm);
  escreverJsonGitHub_('lancamentos_produtos_dia.json', produtosDia);
  escreverJsonGitHub_('estoque.json', estoque);
  escreverJsonGitHub_('manifest.json', manifest);
}

function instalarTrigger() {
  removerTriggers_('exportarTudo');
  ScriptApp.newTrigger('exportarTudo')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(15)
    .inTimezone(CONFIG.timeZone)
    .create();
}

function removerTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
}

function consultarProdutosDia_(modelos) {
  const modelosSql = modelos.map(m => {
    const regex = String(m.termos_busca || m.modelo || '').replace(/'/g, "\\'");
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, DATE('${sql_(m.day_zero_base || m.data_lancamento)}') AS d0, r'${regex}' AS regex`;
  }).join('\nUNION ALL\n');

  const query = `
WITH modelos AS (
  ${modelosSql}
), vendas AS (
  SELECT
    DATE(o.paid_at, 'America/Sao_Paulo') AS data,
    o.source_order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.item_name, '') AS nome_produto,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita
  FROM \`reise-ssot.stg.shopify_order_items\` i
  JOIN \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
    ON o.source_order_id = i.source_order_id
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos)
), match AS (
  SELECT
    m.modelo_id,
    v.data,
    v.source_order_id,
    v.sku,
    v.nome_produto,
    REGEXP_EXTRACT(v.nome_produto, r'^(.*?)(?: - | / |\\|)') AS sub_modelo,
    NULL AS cor,
    v.pares,
    v.receita
  FROM vendas v
  JOIN modelos m
    ON v.data >= m.d0 -- inclui D0
   AND REGEXP_CONTAINS(LOWER(CONCAT(v.nome_produto, ' ', v.sku)), LOWER(m.regex))
)
SELECT
  modelo_id,
  data,
  COALESCE(NULLIF(sub_modelo, ''), nome_produto) AS sub_modelo,
  cor,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CAST(NULL AS INT64) AS novos,
  CAST(NULL AS INT64) AS recorrentes
FROM match
GROUP BY 1,2,3,4
ORDER BY modelo_id, data, sub_modelo`;

  return runBq_(query);
}

function consultarEstoque_(modelos) {
  const modelosSql = modelos.map(m => {
    const regex = String(m.termos_busca || m.modelo || '').replace(/'/g, "\\'");
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, r'${regex}' AS regex`;
  }).join('\nUNION ALL\n');

  const query = `
WITH modelos AS (
  ${modelosSql}
), estoque AS (
  SELECT
    sku,
    product_title,
    variant_title,
    SUM(available) AS estoque_atual,
    MAX(updated_at) AS updated_at
  FROM \`reise-ssot.core.inventory_sku_current\`
  GROUP BY 1,2,3
)
SELECT
  m.modelo_id,
  e.product_title AS sub_modelo,
  e.variant_title AS cor,
  SUM(e.estoque_atual) AS estoque_atual,
  CAST(NULL AS INT64) AS vendas_d30,
  CAST(NULL AS FLOAT64) AS cobertura_dias,
  MAX(e.updated_at) AS updated_at
FROM estoque e
JOIN modelos m
  ON REGEXP_CONTAINS(LOWER(CONCAT(e.product_title, ' ', e.sku)), LOWER(m.regex))
GROUP BY 1,2,3
ORDER BY modelo_id, sub_modelo, cor`;

  return runBq_(query);
}

function runBq_(query) {
  const request = { query, useLegacySql: false, location: CONFIG.bqLocation };
  let job = BigQuery.Jobs.query(request, CONFIG.bqProjectId);
  const jobId = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(500);
    job = BigQuery.Jobs.getQueryResults(CONFIG.bqProjectId, jobId, { location: CONFIG.bqLocation });
  }
  const schema = job.schema.fields.map(f => f.name);
  const rows = [];
  let pageToken;
  do {
    const page = BigQuery.Jobs.getQueryResults(CONFIG.bqProjectId, jobId, { location: CONFIG.bqLocation, pageToken });
    (page.rows || []).forEach(r => {
      const obj = {};
      r.f.forEach((cell, i) => obj[schema[i]] = castBq_(cell.v));
      rows.push(obj);
    });
    pageToken = page.pageToken;
  } while (pageToken);
  return rows;
}

function sheetToObjects_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1)
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = normalizeCell_(row[i]));
      return obj;
    });
}

function escreverJsonGitHub_(fileName, payload) {
  const token = getProp_('GITHUB_TOKEN', '');
  if (!token || !CONFIG.githubRepo) throw new Error('Configure GITHUB_TOKEN e GITHUB_REPO nas Script Properties.');
  const path = `${CONFIG.dataPath}/${fileName}`;
  const api = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${path}`;
  const current = UrlFetchApp.fetch(`${api}?ref=${CONFIG.githubBranch}`, {
    method: 'get',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  const currentJson = current.getResponseCode() === 200 ? JSON.parse(current.getContentText()) : null;
  const body = {
    message: `chore(data): update ${fileName}`,
    branch: CONFIG.githubBranch,
    content: Utilities.base64Encode(JSON.stringify(payload, null, 2), Utilities.Charset.UTF_8),
    sha: currentJson && currentJson.sha ? currentJson.sha : undefined
  };
  UrlFetchApp.fetch(api, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify(body),
    muteHttpExceptions: false
  });
}

function normalizeCell_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM-dd');
  if (value === '') return null;
  return value;
}

function castBq_(value) {
  if (value === null || value === undefined) return null;
  if (/^-?\d+$/.test(String(value))) return Number(value);
  if (/^-?\d+\.\d+$/.test(String(value))) return Number(value);
  return value;
}

function sql_(value) {
  return String(value || '').replace(/'/g, "\\'");
}

function getProp_(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}
