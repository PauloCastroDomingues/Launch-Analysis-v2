/**
 * Reise Launch Analysis v2
 * Exporta BigQuery + fontes opcionais para /data/*.json do repositório GitHub.
 *
 * Propriedades esperadas em Script Properties:
 * - BQ_PROJECT_ID = reise-ssot
 * - GITHUB_TOKEN
 * - GITHUB_REPO = PauloCastroDomingues/Launch-Analysis-v2
 * - GITHUB_BRANCH = main
 * - DATA_PATH = data
 * - MIDIA_SPREADSHEET_ID (opcional, usado apenas para midia_paga e crm_disparos)
 *
 * Serviços avançados necessários:
 * - BigQuery API
 */

const CONFIG = {
  bqProjectId: getProp_('BQ_PROJECT_ID', 'reise-ssot'),
  bqLocation: 'southamerica-east1',
  githubRepo: normalizeGitHubRepo_(getProp_('GITHUB_REPO', '')),
  githubBranch: getProp_('GITHUB_BRANCH', 'main'),
  dataPath: getProp_('DATA_PATH', 'data'),
  timeZone: 'America/Sao_Paulo'
};

function exportarTudo() {
  validarGithubConfig_();
  const modelos = carregarModelos_();
  const ativos = modelos.filter(ehModeloAtivoExportavel_);
  Logger.log(`exportarTudo: ${modelos.length} modelos carregados de data/lancamentos_modelos.json; ${ativos.length} ativos com day_zero_base valido.`);

  const produtosDia = ativos.length ? consultarProdutosDia_(ativos) : [];
  const auditoriaMonochrome = consultarAuditoriaMonochromeSeAtivo_(ativos);
  const dataQuality = {};
  const warnings = [
    'Filtros de data usam >= para incluir D0.',
    'Dados ausentes devem permanecer null/—; nunca transformar em zero.',
    'Modelos elegiveis para analise usam status historico/ativo e day_zero_base valido.',
    'day_zero_base define o D0 analitico de cada modelo.'
  ];

  if (auditoriaMonochrome) {
    dataQuality.rs8_monochrome = compararMonochromeExportAuditoria_(produtosDia, auditoriaMonochrome);
    if (dataQuality.rs8_monochrome.status === 'divergente') {
      const alerta = 'ALERTA: rs8_monochrome divergente entre lancamentos_produtos_dia.json e auditoria_monochrome.json.';
      Logger.log(alerta);
      warnings.push(alerta);
    }
  }

  logProdutosDiaExport_(ativos, produtosDia);
  escreverJsonGitHub_('lancamentos_produtos_dia.json', produtosDia);
  if (auditoriaMonochrome) escreverJsonGitHub_('auditoria_monochrome.json', auditoriaMonochrome);

  const estoqueStatus = exportarEstoqueSeDisponivel_(ativos);
  const midiaStatus = exportarMidiaPagaSeConfigurada_(modelos);
  const crmStatus = exportarCrmSeConfigurado_();

  const manifest = {
    generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    project: 'Reise Launch Analysis v2',
    model_source: 'github_json',
    sales_source: 'bigquery_ssot_shopify_shoppub',
    active_models: ativos.map(m => m.modelo_id),
    row_counts: {
      lancamentos_produtos_dia: produtosDia.length,
      auditoria_monochrome: auditoriaMonochrome ? 1 : 'skipped',
      estoque: estoqueStatus.rows,
      midia_paga: midiaStatus.rows,
      crm_disparos: crmStatus.rows
    },
    data_quality: dataQuality,
    export_status: {
      estoque: estoqueStatus.status,
      midia_paga: midiaStatus.status,
      crm_disparos: crmStatus.status
    },
    files: [
      'lancamentos_modelos.json',
      'lancamentos_produtos_dia.json',
      'auditoria_monochrome.json',
      'midia_paga.json',
      'crm_disparos.json',
      'estoque.json',
      'manifest.json'
    ],
    warnings
  };

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

function auditarVendasMonochrome() {
  validarGithubConfig_();
  const modelos = carregarModelos_();
  const mono = modelos.find(isMonochromeModel_);
  if (!mono || !dateOnly_(mono.day_zero_base)) {
    throw new Error('rs8_monochrome nao encontrado em data/lancamentos_modelos.json com day_zero_base valido.');
  }

  const auditoria = consultarAuditoriaMonochrome_(mono);
  escreverJsonGitHub_('auditoria_monochrome.json', auditoria);
  Logger.log(`auditoria_monochrome.json exportado: ${JSON.stringify(auditoria.resumo)}`);
  return auditoria;
}

function diagnosticarRs8Monochrome() {
  return diagnosticarMonochrome();
}

function diagnosticarMonochrome() {
  const query = `
WITH params AS (
  SELECT
    DATE('2026-06-25') AS d0,
    TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
), pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= p.d0
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
), shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount) AS NUMERIC) AS receita
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  JOIN \`reise-ssot.mart_shared.fct_order\` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
), shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM \`reise-ssot.stg.shoppub_orders_tbl\` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
), shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS quantidade,
    COALESCE(
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_total'),
        JSON_EXTRACT_SCALAR(item_json, '$.total'),
        JSON_EXTRACT_SCALAR(item_json, '$.subtotal'),
        JSON_EXTRACT_SCALAR(item_json, '$.total_price'),
        JSON_EXTRACT_SCALAR(item_json, '$.line_total')
      ) AS NUMERIC),
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_unitario'),
        JSON_EXTRACT_SCALAR(item_json, '$.valor'),
        JSON_EXTRACT_SCALAR(item_json, '$.preco'),
        JSON_EXTRACT_SCALAR(item_json, '$.price'),
        JSON_EXTRACT_SCALAR(item_json, '$.unit_price')
      ) AS NUMERIC)
      * SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
        JSON_EXTRACT_SCALAR(item_json, '$.qty'),
        JSON_EXTRACT_SCALAR(item_json, '$.quantity')
      ) AS INT64)
    ) AS receita
  FROM shoppub_item_json
), itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
), vendas AS (
  SELECT
    p.data,
    LOWER(p.source_system) AS origem,
    p.source_order_id AS order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.nome_produto, i.product_title, '') AS nome_produto,
    COALESCE(i.product_title, i.nome_produto, '') AS product_title,
    COALESCE(i.variant_title, '') AS variant_title,
    i.quantidade,
    i.receita,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.sku, '')
    ), NFD), r'\\p{M}', '') AS match_text_norm
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.quantidade IS NOT NULL
    AND i.quantidade > 0
)
SELECT
  data,
  origem,
  order_id,
  sku,
  nome_produto,
  product_title,
  variant_title,
  quantidade,
  receita,
  match_text_norm
FROM vendas
WHERE REGEXP_CONTAINS(
  match_text_norm,
  r'(rs8|avant|mono|monochrome|monochrome rs8|rs8 monochrome|rs8 avant)'
)
ORDER BY data, origem, order_id, sku`;

  const rows = runBq_(query);
  Logger.log(JSON.stringify(rows.slice(0, 200), null, 2));
  return rows;
}

function diagnosticarMonochromeAmplo() {
  const query = `
WITH params AS (
  SELECT
    DATE('2026-06-25') AS d0,
    CURRENT_DATE('America/Sao_Paulo') AS data_fim,
    TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
), pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') BETWEEN p.d0 AND p.data_fim
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
), shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount) AS NUMERIC) AS receita
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  JOIN \`reise-ssot.mart_shared.fct_order\` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
), shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM \`reise-ssot.stg.shoppub_orders_tbl\` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
), shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS quantidade,
    COALESCE(
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_total'),
        JSON_EXTRACT_SCALAR(item_json, '$.total'),
        JSON_EXTRACT_SCALAR(item_json, '$.subtotal'),
        JSON_EXTRACT_SCALAR(item_json, '$.total_price'),
        JSON_EXTRACT_SCALAR(item_json, '$.line_total')
      ) AS NUMERIC),
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_unitario'),
        JSON_EXTRACT_SCALAR(item_json, '$.valor'),
        JSON_EXTRACT_SCALAR(item_json, '$.preco'),
        JSON_EXTRACT_SCALAR(item_json, '$.price'),
        JSON_EXTRACT_SCALAR(item_json, '$.unit_price')
      ) AS NUMERIC)
      * SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
        JSON_EXTRACT_SCALAR(item_json, '$.qty'),
        JSON_EXTRACT_SCALAR(item_json, '$.quantity')
      ) AS INT64)
    ) AS receita
  FROM shoppub_item_json
), itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
), vendas AS (
  SELECT
    p.data,
    LOWER(p.source_system) AS origem,
    p.source_order_id AS order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.nome_produto, i.product_title, '') AS nome_produto,
    COALESCE(i.product_title, i.nome_produto, '') AS product_title,
    COALESCE(i.variant_title, '') AS variant_title,
    i.quantidade,
    i.receita,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.sku, '')
    ), NFD), r'\\p{M}', '') AS match_text_norm
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.quantidade IS NOT NULL
    AND i.quantidade > 0
)
SELECT
  origem,
  sku,
  nome_produto,
  product_title,
  variant_title,
  COUNT(DISTINCT order_id) AS pedidos,
  SUM(quantidade) AS quantidade,
  SUM(receita) AS receita,
  MIN(data) AS primeira_data,
  MAX(data) AS ultima_data,
  ANY_VALUE(match_text_norm) AS match_text_norm
FROM vendas
GROUP BY 1,2,3,4,5
ORDER BY receita DESC, quantidade DESC
LIMIT 200`;

  const rows = runBq_(query);
  Logger.log('diagnosticarMonochromeAmplo: produtos mais vendidos desde 2026-06-25 ate hoje');
  Logger.log(JSON.stringify(rows.slice(0, 200), null, 2));
  return rows;
}

function consultarProdutosDia_(modelos) {
  const modelosSql = modelos.map(m => {
    const termosRegex = termosRegex_(m);
    const skuPrefixos = skuPrefixos_(m);
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, DATE('${sql_(m.day_zero_base)}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos`;
  }).join('\nUNION ALL\n');

  const query = `
WITH params AS (
  SELECT TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
), modelos AS (
  ${modelosSql}
), modelos_norm AS (
  SELECT
    *,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS sku_prefixos_norm
  FROM modelos
), pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    o.paid_at,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos_norm)
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
), shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS title_text,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS name_text,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount) AS NUMERIC) AS receita
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  JOIN \`reise-ssot.mart_shared.fct_order\` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
), shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM \`reise-ssot.stg.shoppub_orders_tbl\` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
), shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title')
    )), '') AS title_text,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.name'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS name_text,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS pares,
    COALESCE(
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_total'),
        JSON_EXTRACT_SCALAR(item_json, '$.total'),
        JSON_EXTRACT_SCALAR(item_json, '$.subtotal'),
        JSON_EXTRACT_SCALAR(item_json, '$.total_price'),
        JSON_EXTRACT_SCALAR(item_json, '$.line_total')
      ) AS NUMERIC),
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_unitario'),
        JSON_EXTRACT_SCALAR(item_json, '$.valor'),
        JSON_EXTRACT_SCALAR(item_json, '$.preco'),
        JSON_EXTRACT_SCALAR(item_json, '$.price'),
        JSON_EXTRACT_SCALAR(item_json, '$.unit_price')
      ) AS NUMERIC)
      * SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
        JSON_EXTRACT_SCALAR(item_json, '$.qty'),
        JSON_EXTRACT_SCALAR(item_json, '$.quantity')
      ) AS INT64)
    ) AS receita
  FROM shoppub_item_json
), itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
), vendas AS (
  SELECT
    p.data,
    p.source_system,
    LOWER(p.source_system) AS origem,
    p.source_order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.nome_produto, i.product_title, '') AS nome_produto,
    COALESCE(i.product_title, i.nome_produto, '') AS product_title,
    COALESCE(i.variant_title, '') AS variant_title,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.sku, ''), ' ',
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.title_text, ''), ' ',
      COALESCE(i.name_text, '')
    ), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    i.pares,
    i.receita
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.pares IS NOT NULL
    AND i.pares > 0
), candidatos AS (
  SELECT
    v.*,
    m.modelo_id,
    m.d0,
    GREATEST(
      IFNULL((
        SELECT MAX(LENGTH(TRIM(term)))
        FROM UNNEST(SPLIT(IFNULL(m.termos_norm, ''), '|')) AS term
        WHERE TRIM(term) != ''
          AND REGEXP_CONTAINS(
            v.match_text_norm,
            CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(term), r'\\s+', r'\\\\s+'), r'([^a-z0-9]|$)')
          )
      ), 0),
      IFNULL((
        SELECT MAX(1000 + LENGTH(TRIM(prefixo)))
        FROM UNNEST(SPLIT(IFNULL(m.sku_prefixos_norm, ''), '|')) AS prefixo
        WHERE TRIM(prefixo) != ''
          AND STARTS_WITH(v.sku_norm, TRIM(prefixo))
      ), 0)
    ) AS match_score
  FROM vendas v
  JOIN modelos_norm m
    ON m.modelo_id != 'rs8_monochrome'
   AND v.data >= m.d0 -- inclui D0
), match AS (
  SELECT
    c.modelo_id,
    c.data,
    c.origem,
    c.source_order_id,
    c.sku,
    c.nome_produto,
    c.variant_title,
    COALESCE(
      NULLIF(c.product_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'^(.*?)(?: - | / |\\|)'), ''),
      NULLIF(c.nome_produto, '')
    ) AS sub_modelo,
    COALESCE(
      NULLIF(c.variant_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'(?i)(?:cor|color)[: -]+([^|/,-]+)'), '')
    ) AS cor,
    NULLIF(REGEXP_EXTRACT(c.match_text_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    c.pares,
    c.receita,
    c.match_text_norm,
    c.modelo_id AS modelo_id_detectado
  FROM candidatos c
  WHERE c.match_score > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY c.source_system, c.source_order_id, c.sku, c.nome_produto, c.variant_title
    ORDER BY c.match_score DESC, c.d0 DESC, c.modelo_id
  ) = 1
), monochrome_item_source AS (
  SELECT
    'rs8_monochrome' AS modelo_id,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    'SSOT_CORE' AS source_system,
    'ssot_core' AS origem,
    CAST(o.order_name AS STRING) AS source_order_id,
    CAST(o.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), '') AS line_item_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount - IFNULL(i.line_discount_amount, 0)) AS NUMERIC) AS receita,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.item_name, ''), ' ', COALESCE(i.sku, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.core.order_item\` i
  JOIN \`reise-ssot.core.order\` o
    ON o.order_sk = i.order_sk
  JOIN modelos_norm m
    ON m.modelo_id = 'rs8_monochrome'
   AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= m.d0
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND SAFE_CAST(i.quantity AS INT64) > 0
), monochrome_flags AS (
  SELECT
    *,
    REGEXP_CONTAINS(item_name_norm, r'(^|[^a-z0-9])monochrome([^a-z0-9]|$)') AS has_title_match,
    (
      STARTS_WITH(sku_norm, 'rs8 avant mono')
      OR STARTS_WITH(sku_norm, 'rs8 mono')
      OR STARTS_WITH(sku_norm, 'rs8avantmono')
    ) AS has_sku_match
  FROM monochrome_item_source
), monochrome_filtrado AS (
  SELECT
    *,
    COALESCE(
      NULLIF(line_item_id, ''),
      TO_JSON_STRING(STRUCT(order_sk, sku, nome_produto, pares, receita))
    ) AS dedupe_key
  FROM monochrome_flags
  WHERE has_title_match OR has_sku_match
), monochrome_match AS (
  SELECT
    modelo_id,
    data,
    origem,
    source_order_id,
    COALESCE(sku, '') AS sku,
    COALESCE(nome_produto, '') AS nome_produto,
    variant_title,
    'RS8 Avant Monochrome' AS sub_modelo,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), '') AS cor,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    pares,
    receita,
    match_text_norm,
    'rs8_monochrome' AS modelo_id_detectado
  FROM monochrome_filtrado
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY dedupe_key
    ORDER BY source_order_id, sku, nome_produto, pares, receita
  ) = 1
), match_unificado AS (
  SELECT * FROM match
  UNION ALL
  SELECT * FROM monochrome_match
)
SELECT
  modelo_id,
  data,
  source_order_id,
  origem,
  sku,
  nome_produto,
  variant_title,
  COALESCE(NULLIF(sub_modelo, ''), nome_produto) AS sub_modelo,
  NULLIF(cor, '') AS cor,
  NULLIF(tamanho, '') AS tamanho,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CAST(NULL AS INT64) AS novos,
  CAST(NULL AS INT64) AS recorrentes,
  match_text_norm,
  modelo_id_detectado
FROM match_unificado
GROUP BY 1,2,3,4,5,6,7,8,9,10,16,17
ORDER BY modelo_id, data, source_order_id, sku`;

  return runBq_(query);
}

function consultarAuditoriaMonochromeSeAtivo_(modelos) {
  const mono = modelos.find(isMonochromeModel_);
  if (!mono) return null;
  return consultarAuditoriaMonochrome_(mono);
}

function consultarAuditoriaMonochrome_(modelo) {
  const d0 = sql_(modelo.day_zero_base);
  const query = `
WITH modelo AS (
  SELECT DATE('${d0}') AS d0
), base AS (
  SELECT
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_venda,
    CAST(o.order_name AS STRING) AS pedido,
    CAST(o.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), '') AS line_item_id,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS titulo_produto,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount - IFNULL(i.line_discount_amount, 0)) AS NUMERIC) AS valor_liquido_item,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm
  FROM \`reise-ssot.core.order_item\` i
  JOIN \`reise-ssot.core.order\` o
    ON o.order_sk = i.order_sk
  CROSS JOIN modelo m
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= m.d0
    AND SAFE_CAST(i.quantity AS INT64) > 0
), flags AS (
  SELECT
    *,
    REGEXP_CONTAINS(item_name_norm, r'(^|[^a-z0-9])monochrome([^a-z0-9]|$)') AS has_title_match,
    (
      STARTS_WITH(sku_norm, 'rs8 avant mono')
      OR STARTS_WITH(sku_norm, 'rs8 mono')
      OR STARTS_WITH(sku_norm, 'rs8avantmono')
    ) AS has_sku_match,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), '') AS cor,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho
  FROM base
), classificadas AS (
  SELECT
    *,
    COALESCE(
      NULLIF(line_item_id, ''),
      TO_JSON_STRING(STRUCT(order_sk, sku, titulo_produto, quantidade, valor_liquido_item))
    ) AS dedupe_key
  FROM flags
  WHERE has_title_match OR has_sku_match
), dedup AS (
  SELECT *
  FROM classificadas
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY dedupe_key
    ORDER BY pedido, sku, titulo_produto, quantidade, valor_liquido_item
  ) = 1
), duplicidades AS (
  SELECT
    dedupe_key,
    COUNT(*) AS linhas,
    ARRAY_AGG(STRUCT(
      pedido,
      sku,
      titulo_produto,
      quantidade,
      valor_liquido_item
    ) ORDER BY pedido LIMIT 5) AS exemplos
  FROM classificadas
  GROUP BY dedupe_key
  HAVING COUNT(*) > 1
  ORDER BY linhas DESC
  LIMIT 100
), linhas_suspeitas AS (
  SELECT
    pedido,
    sku,
    titulo_produto,
    quantidade,
    valor_liquido_item,
    item_name_norm,
    sku_norm
  FROM classificadas
  WHERE NOT has_title_match
    AND NOT has_sku_match
  LIMIT 100
)
SELECT TO_JSON_STRING(STRUCT(
  'rs8_monochrome' AS modelo_id,
  'reise-ssot.core.order_item + core.order' AS fonte,
  'item_name normalizado contem monochrome; SKU especifico permitido apenas para RS8-AVANT-MONO, RS8-MONO, RS8AVANTMONO' AS regra_match,
  STRUCT(
    CAST((SELECT d0 FROM modelo) AS STRING) AS inicio,
    CAST(CURRENT_DATE('America/Sao_Paulo') AS STRING) AS fim
  ) AS periodo,
  (
    SELECT AS STRUCT
      CAST(MIN(data_venda) AS STRING) AS primeira_venda,
      CAST(MAX(data_venda) AS STRING) AS ultima_venda,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_liquido_item), SUM(quantidade)), 2) AS preco_medio_liquido
    FROM dedup
  ) AS resumo,
  ARRAY(
    SELECT AS STRUCT
      CAST(data_venda AS STRING) AS data,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_liquido_item), SUM(quantidade)), 2) AS preco_medio_liquido
    FROM dedup
    GROUP BY data_venda
    ORDER BY data_venda
  ) AS por_dia,
  ARRAY(
    SELECT AS STRUCT
      titulo_produto,
      sku,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_liquido_item), SUM(quantidade)), 2) AS preco_medio_liquido
    FROM dedup
    GROUP BY titulo_produto, sku
    ORDER BY receita_liquida_itens DESC, pares_vendidos DESC
    LIMIT 200
  ) AS por_produto,
  ARRAY(
    SELECT AS STRUCT
      COALESCE(cor, 'sem_cor') AS cor,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens
    FROM dedup
    GROUP BY cor
    ORDER BY pares_vendidos DESC, receita_liquida_itens DESC
  ) AS por_cor,
  ARRAY(
    SELECT AS STRUCT
      COALESCE(tamanho, 'sem_tamanho') AS tamanho,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens
    FROM dedup
    GROUP BY tamanho
    ORDER BY pares_vendidos DESC, receita_liquida_itens DESC
  ) AS por_tamanho,
  ARRAY(SELECT AS STRUCT * FROM duplicidades) AS duplicidades,
  ARRAY(SELECT AS STRUCT * FROM linhas_suspeitas) AS linhas_suspeitas
)) AS payload`;

  const rows = runBq_(query);
  if (!rows.length || !rows[0].payload) {
    throw new Error('Auditoria Monochrome nao retornou payload do BigQuery.');
  }

  try {
    return JSON.parse(rows[0].payload);
  } catch (error) {
    throw new Error(`Auditoria Monochrome retornou JSON invalido: ${error.message}`);
  }
}

function compararMonochromeExportAuditoria_(produtosDia, auditoria) {
  const rows = (produtosDia || []).filter(row => String(row.modelo_id || '') === 'rs8_monochrome');
  const pedidosDistintos = {};
  let pedidosSemId = 0;
  let paresExportados = 0;
  let receitaExportada = 0;

  rows.forEach(row => {
    const orderId = String(row.source_order_id || '').trim();
    if (orderId) pedidosDistintos[orderId] = true;
    else pedidosSemId += Number(row.pedidos || 0);
    paresExportados += Number(row.pares || 0);
    receitaExportada += Number(row.receita || 0);
  });

  const resumo = auditoria.resumo || {};
  const pedidosAuditoria = Number(resumo.pedidos || 0);
  const paresAuditoria = Number(resumo.pares_vendidos || 0);
  const receitaAuditoria = Number(resumo.receita_liquida_itens || 0);
  const pedidosExportados = Object.keys(pedidosDistintos).length || pedidosSemId;
  const diferencaPedidosPct = pctDiff_(pedidosExportados, pedidosAuditoria);
  const diferencaParesPct = pctDiff_(paresExportados, paresAuditoria);
  const diferencaReceitaPct = pctDiff_(receitaExportada, receitaAuditoria);
  const status = Math.max(diferencaPedidosPct, diferencaParesPct, diferencaReceitaPct) > 0.01
    ? 'divergente'
    : 'ok';

  const quality = {
    status,
    auditado: status === 'ok',
    pedidos_auditoria: pedidosAuditoria,
    pares_auditoria: paresAuditoria,
    receita_auditoria: round2_(receitaAuditoria),
    pedidos_exportados: pedidosExportados,
    pares_exportados: paresExportados,
    receita_exportada: round2_(receitaExportada),
    diferenca_pedidos_pct: round6_(diferencaPedidosPct),
    diferenca_pares_pct: round6_(diferencaParesPct),
    diferenca_receita_pct: round6_(diferencaReceitaPct),
    linhas_suspeitas: (auditoria.linhas_suspeitas || []).length,
    duplicidades: (auditoria.duplicidades || []).length
  };

  Logger.log(`data_quality.rs8_monochrome=${JSON.stringify(quality)}`);
  return quality;
}

function pctDiff_(value, reference) {
  const ref = Number(reference || 0);
  const val = Number(value || 0);
  if (!ref && !val) return 0;
  if (!ref) return 1;
  return Math.abs(val - ref) / Math.abs(ref);
}

function round2_(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round6_(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
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

function diagnosticarPipelineMonochrome_() {
  const query = `
WITH params AS (
  SELECT
    DATE('2026-06-25') AS d0,
    CURRENT_DATE('America/Sao_Paulo') AS data_fim,
    TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
), pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') BETWEEN p.d0 AND p.data_fim
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
), shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS quantidade
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  JOIN \`reise-ssot.mart_shared.fct_order\` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
), shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM \`reise-ssot.stg.shoppub_orders_tbl\` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
), shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS quantidade
  FROM shoppub_item_json
), itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
), vendas AS (
  SELECT
    LOWER(p.source_system) AS origem,
    p.source_order_id AS order_id,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.sku, '')
    ), NFD), r'\\p{M}', '') AS match_text_norm
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.quantidade IS NOT NULL
    AND i.quantidade > 0
)
SELECT
  origem,
  COUNT(*) AS linhas_fonte,
  COUNT(DISTINCT order_id) AS pedidos_fonte,
  COUNTIF(REGEXP_CONTAINS(match_text_norm, r'(rs8|avant|mono|monochrome|rs8 monochrome|rs8 avant)')) AS linhas_diagnostico,
  COUNTIF(
    (
      REGEXP_CONTAINS(match_text_norm, r'\\brs8\\b')
      OR REGEXP_CONTAINS(match_text_norm, r'\\bavant\\b')
    )
    AND REGEXP_CONTAINS(match_text_norm, r'(monochrome|mono)')
  ) AS linhas_match_monochrome
FROM vendas
GROUP BY origem
ORDER BY origem`;

  const rows = runBq_(query);
  Logger.log(`diagnosticarPipelineMonochrome_: ${JSON.stringify(rows)}`);
  return rows;
}

function logProdutosDiaExport_(modelos, produtosDia) {
  const tables = [
    'reise-ssot.mart_shared.orders_all_valid_no_migracao',
    'reise-ssot.mart_shared.fct_order_item',
    'reise-ssot.mart_shared.fct_order',
    'reise-ssot.stg.shoppub_orders_tbl'
  ];
  const byModelo = {};
  const byOrigem = {};
  produtosDia.forEach(row => {
    const modeloId = row.modelo_id || 'sem_modelo';
    const origem = row.origem || 'sem_origem';
    byModelo[modeloId] = (byModelo[modeloId] || 0) + 1;
    byOrigem[origem] = (byOrigem[origem] || 0) + 1;
  });

  Logger.log(`exportarTudo: ${produtosDia.length} linhas em lancamentos_produtos_dia.json.`);
  Logger.log(`exportarTudo: tabelas consultadas = ${tables.join(', ')}`);
  Logger.log('exportarTudo: classificacao de linha dinamica por termos_busca e sku_prefixos de cada modelo, sem CASE fixo por linha.');
  Logger.log(`exportarTudo: linhas por modelo = ${JSON.stringify(byModelo)}`);
  Logger.log(`exportarTudo: linhas por origem = ${JSON.stringify(byOrigem)}`);

  modelos.forEach(modelo => {
    Logger.log(`modelo ${modelo.modelo_id}: d0=${modelo.day_zero_base || modelo.data_lancamento}; termos_busca=${modelo.termos_busca || ''}; sku_prefixos=${modelo.sku_prefixos || ''}`);
    const rows = produtosDia.filter(row => row.modelo_id === modelo.modelo_id);
    const receita = rows.reduce((acc, row) => acc + Number(row.receita || 0), 0);
    const pares = rows.reduce((acc, row) => acc + Number(row.pares || 0), 0);
    Logger.log(`modelo ${modelo.modelo_id}: ${rows.length} linhas, receita=${receita}, pares=${pares}.`);
    if (!rows.length) Logger.log(`modelo ${modelo.modelo_id}: sem linhas no match final. Verifique BigQuery, termos_busca, sku_prefixos e exportacao.`);
  });
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

function validarGithubConfig_() {
  const missing = [];
  if (!getProp_('GITHUB_TOKEN', '')) missing.push('GITHUB_TOKEN');
  if (!CONFIG.githubRepo) missing.push('GITHUB_REPO');
  if (missing.length) {
    throw new Error(`Exportacao interrompida antes de consultar o BigQuery: configure ${missing.join(', ')} nas Script Properties. Sem GITHUB_TOKEN e GITHUB_REPO, o Apps Script nao consegue ler data/lancamentos_modelos.json no GitHub.`);
  }
  if (!/^[^\/\s]+\/[^\/\s]+$/.test(CONFIG.githubRepo)) {
    throw new Error(`Exportacao interrompida antes de consultar o BigQuery: GITHUB_REPO invalido (${CONFIG.githubRepo}). Use "PauloCastroDomingues/Launch-Analysis-v2" ou a URL do repositorio GitHub.`);
  }
}

function ehModeloAtivoExportavel_(modelo) {
  return String(modelo.status || '').trim().toLowerCase() === 'ativo'
    && Boolean(dateOnly_(modelo.day_zero_base));
}

function isMonochromeModel_(modelo) {
  return String(modelo && modelo.modelo_id || '') === 'rs8_monochrome';
}

function normalizeGitHubRepo_(value) {
  const clean = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return clean;
}

function githubHeaders_(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubRequestContext_(path) {
  return `repo=${CONFIG.githubRepo}; branch=${CONFIG.githubBranch}; path=${path}`;
}

function carregarModelos_() {
  const modelos = lerJsonGitHub_('lancamentos_modelos.json');
  if (!Array.isArray(modelos)) {
    throw new Error('data/lancamentos_modelos.json precisa conter um array de modelos.');
  }

  const validos = [];
  modelos.forEach((modelo, index) => {
    const missing = [];
    if (!modelo.modelo_id) missing.push('modelo_id');
    if (!modelo.modelo) missing.push('modelo');
    if (!modelo.linha) missing.push('linha');
    if (!modelo.data_lancamento && !modelo.day_zero_base) missing.push('data_lancamento/day_zero_base');
    if (!modelo.termos_busca && !modelo.sku_prefixos) missing.push('termos_busca/sku_prefixos');
    if (!modelo.status) missing.push('status');

    if (missing.length) {
      Logger.log(`lancamentos_modelos.json item ${index + 1}: campos ausentes = ${missing.join(', ')}`);
    }

    const bloqueantes = ['modelo_id', 'modelo', 'data_lancamento/day_zero_base', 'status'];
    if (missing.some(field => bloqueantes.includes(field))) {
      Logger.log(`lancamentos_modelos.json item ${index + 1}: ignorado por falta de campo essencial.`);
      return;
    }

    validos.push(modelo);
  });

  if (!validos.length) {
    throw new Error('Nenhum modelo valido encontrado em data/lancamentos_modelos.json.');
  }

  return validos;
}

function lerJsonGitHub_(path) {
  validarGithubConfig_();
  const token = getProp_('GITHUB_TOKEN', '');

  const repoPath = githubDataPath_(path);
  const api = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${repoPath}`;
  const url = `${api}?ref=${encodeURIComponent(CONFIG.githubBranch)}`;
  let response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  });

  let code = response.getResponseCode();
  let body = response.getContentText();
  if ([401, 403, 404].includes(code)) {
    const publicResponse = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: githubHeaders_(''),
      muteHttpExceptions: true
    });
    if (publicResponse.getResponseCode() === 200) {
      Logger.log(`Aviso GitHub: leitura autenticada falhou com HTTP ${code}, mas leitura publica funcionou. O GITHUB_TOKEN provavelmente nao tem acesso/Contents ao repositorio configurado. ${githubRequestContext_(repoPath)}`);
      response = publicResponse;
      code = 200;
      body = response.getContentText();
    }
  }

  if (code !== 200) {
    throw new Error(`Nao consegui ler ${repoPath} no GitHub. HTTP ${code}: ${body.slice(0, 300)}. Contexto: ${githubRequestContext_(repoPath)}. Verifique se GITHUB_REPO esta como PauloCastroDomingues/Launch-Analysis-v2, GITHUB_BRANCH como main e se o token tem acesso ao repositorio com Contents read/write.`);
  }

  let metadata;
  try {
    metadata = JSON.parse(body);
  } catch (error) {
    throw new Error(`Resposta invalida do GitHub ao ler ${repoPath}: ${error.message}`);
  }

  const encoded = String(metadata.content || '').replace(/\s/g, '');
  if (!encoded) throw new Error(`Arquivo ${repoPath} nao retornou conteudo pelo GitHub.`);

  let text;
  try {
    text = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString('UTF-8');
  } catch (error) {
    throw new Error(`Nao consegui decodificar ${repoPath}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON invalido em ${repoPath}: ${error.message}`);
  }
}

function githubDataPath_(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  const dataPath = String(CONFIG.dataPath || 'data').replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('Caminho JSON vazio.');
  if (clean === dataPath || clean.startsWith(`${dataPath}/`)) return clean;
  if (clean.indexOf('/') >= 0) return clean;
  return `${dataPath}/${clean}`;
}

function exportarEstoqueSeDisponivel_(ativos) {
  if (!ativos.length) {
    Logger.log('Sem modelos ativos com day_zero_base valido; estoque nao consultado.');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const estoque = consultarEstoque_(ativos);
    escreverJsonGitHub_('estoque.json', estoque);
    Logger.log(`estoque.json exportado com ${estoque.length} linhas.`);
    return { status: 'exported', rows: estoque.length };
  } catch (error) {
    Logger.log(`Estoque nao exportado; mantendo estoque.json atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
}

function exportarMidiaPagaSeConfigurada_(modelos) {
  const spreadsheetId = getProp_('MIDIA_SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    Logger.log('MIDIA_SPREADSHEET_ID nao configurado; mantendo midia_paga.json atual');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('midia_paga');
    if (!sheet) {
      Logger.log('Aba midia_paga nao encontrada; mantendo midia_paga.json atual');
      return { status: 'skipped', rows: 'skipped' };
    }

    const midia = normalizeMidiaPaga_(sheetToObjects_(sheet), modelos);
    escreverJsonGitHub_('midia_paga.json', midia);
    Logger.log(`midia_paga.json exportado com ${midia.length} linhas.`);
    return { status: 'exported', rows: midia.length };
  } catch (error) {
    Logger.log(`midia_paga.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
}

function exportarCrmSeConfigurado_() {
  const spreadsheetId = getProp_('MIDIA_SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    Logger.log('MIDIA_SPREADSHEET_ID nao configurado; mantendo crm_disparos.json atual');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('crm_disparos');
    if (!sheet) {
      Logger.log('Aba crm_disparos nao encontrada; mantendo crm_disparos.json atual');
      return { status: 'skipped', rows: 'skipped' };
    }

    const crm = normalizeCrmDisparos_(sheetToObjects_(sheet));
    escreverJsonGitHub_('crm_disparos.json', crm);
    Logger.log(`crm_disparos.json exportado com ${crm.length} linhas.`);
    return { status: 'exported', rows: crm.length };
  } catch (error) {
    Logger.log(`crm_disparos.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
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

function normalizeMidiaPaga_(rows, modelos) {
  const modelosById = {};
  modelos.forEach(m => modelosById[String(m.modelo_id || '').trim()] = m);

  return rows.map((row, index) => {
    const campanha = String(row.campanha || '').trim();
    if (!campanha) {
      throw new Error(`midia_paga linha ${index + 2}: coluna campanha e obrigatoria.`);
    }

    const modeloId = String(row.modelo_id || '').trim();
    const modelo = modelosById[modeloId] || {};
    const investimento = numberOrNull_(row.investimento);
    const receita = numberOrNull_(row.receita_atribuida);
    const pedidos = numberOrNull_(row.pedidos);

    return {
      modelo_id: modeloId || null,
      campanha,
      canal: row.canal || null,
      data_inicio: row.data_inicio || null,
      data_fim: row.data_fim || null,
      janela: row.janela || inferJanelaMidia_(row, modelo),
      investimento,
      receita_atribuida: receita,
      pedidos,
      roas: numberOrNull_(row.roas) ?? (investimento && receita !== null ? receita / investimento : null),
      cpa: numberOrNull_(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null),
      observacao: row.observacao || null,
      status: row.status || null
    };
  });
}

function normalizeCrmDisparos_(rows) {
  return rows.map(row => ({
    modelo_id: row.modelo_id || null,
    modelo: row.modelo || null,
    data_disparo: row.data_disparo || null,
    campanha: row.campanha || null,
    canal: row.canal || null,
    investimento: numberOrNull_(row.investimento),
    receita_linha: numberOrNull_(row.receita_linha),
    receita_dia: numberOrNull_(row.receita_dia),
    pedidos: numberOrNull_(row.pedidos),
    roas_proxy: numberOrNull_(row.roas_proxy),
    cpa: numberOrNull_(row.cpa),
    observacao: row.observacao || null,
    status: row.status || null
  }));
}

function inferJanelaMidia_(row, modelo) {
  const d0 = dateOnly_(modelo.day_zero_base || modelo.data_lancamento);
  const end = dateOnly_(row.data_fim || row.data_inicio);
  if (!d0 || !end) return null;
  if (end < d0) return 'pre-d0';
  const days = Math.floor((end - d0) / 86400000) + 1;
  if (days <= 15) return '15d';
  if (days <= 30) return '30d';
  if (days <= 90) return '90d';
  return `${days}d`;
}

function dateOnly_(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const parts = String(value).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function numberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const usesDecimalComma = cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'));
  const normalized = usesDecimalComma
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function termosRegex_(model) {
  return String(model.termos_busca || model.modelo || '')
    .split('|')
    .map(term => term.trim())
    .filter(Boolean)
    .join('|');
}

function skuPrefixos_(model) {
  return String(model.sku_prefixos || '')
    .split(/[|,]/)
    .map(prefix => prefix.trim())
    .filter(Boolean)
    .join('|');
}

function escreverJsonGitHub_(fileName, payload) {
  validarGithubConfig_();
  const token = getProp_('GITHUB_TOKEN', '');
  const path = githubDataPath_(fileName);
  const api = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${path}`;
  const current = UrlFetchApp.fetch(`${api}?ref=${CONFIG.githubBranch}`, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  });
  const currentJson = current.getResponseCode() === 200 ? JSON.parse(current.getContentText()) : null;
  if (current.getResponseCode() !== 200) {
    Logger.log(`Aviso GitHub: nao consegui obter SHA atual de ${path}. HTTP ${current.getResponseCode()}: ${current.getContentText().slice(0, 300)}. ${githubRequestContext_(path)}`);
  }

  const requestBody = {
    message: `chore(data): update ${fileName}`,
    branch: CONFIG.githubBranch,
    content: Utilities.base64Encode(JSON.stringify(payload, null, 2), Utilities.Charset.UTF_8),
    sha: currentJson && currentJson.sha ? currentJson.sha : undefined
  };
  const response = UrlFetchApp.fetch(api, {
    method: 'put',
    contentType: 'application/json',
    headers: githubHeaders_(token),
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Nao consegui escrever ${path} no GitHub. HTTP ${code}: ${response.getContentText().slice(0, 400)}. Contexto: ${githubRequestContext_(path)}. Verifique se o GITHUB_TOKEN tem acesso ao repo e permissao Contents: Read and write.`);
  }
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
