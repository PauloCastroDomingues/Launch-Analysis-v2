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
  const exportaveis = modelos.filter(ehModeloExportavel_);
  const ativos = modelos.filter(ehModeloAtivo_);
  Logger.log(`exportarTudo: ${modelos.length} modelos carregados de data/lancamentos_modelos.json; ${exportaveis.length} exportaveis com status historico/ativo e day_zero_base valido.`);

  const produtosDia = exportaveis.length ? consultarProdutosDia_(exportaveis) : [];
  const auditoriaMonochrome = consultarAuditoriaMonochromeSeAtivo_(exportaveis);
  const dataQuality = {};
  const warnings = [
    'Filtros de data usam >= para incluir D0.',
    'Dados ausentes devem permanecer null/—; nunca transformar em zero.',
    'Modelos elegiveis para analise usam status historico/ativo e day_zero_base valido.',
    'day_zero_base define o D0 analitico de cada modelo.',
    'Vendas de modelos usam fct_order_item com is_valid_order TRUE, order_sk como identificador de pedido e receita_bruta como faturamento do dashboard.'
  ];

  if (auditoriaMonochrome) {
    dataQuality.rs8_monochrome = compararMonochromeExportAuditoria_(produtosDia, auditoriaMonochrome);
    if (dataQuality.rs8_monochrome.status === 'divergente') {
      const alerta = 'ALERTA: rs8_monochrome divergente entre lancamentos_produtos_dia.json e auditoria_monochrome.json.';
      Logger.log(alerta);
      warnings.push(alerta);
    }
  }

  logProdutosDiaExport_(exportaveis, produtosDia);
  escreverJsonGitHub_('lancamentos_produtos_dia.json', produtosDia);
  if (auditoriaMonochrome) escreverJsonGitHub_('auditoria_monochrome.json', auditoriaMonochrome);

  const estoqueStatus = exportarEstoqueSeDisponivel_(exportaveis);
  const midiaStatus = exportarMidiaPagaSeConfigurada_(modelos);
  const crmStatus = exportarCrmSeConfigurado_();

  const manifest = {
    generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    project: 'Reise Launch Analysis v2',
    model_source: 'github_json',
    sales_source: 'bigquery_ssot_fct_order_item_valid_orders',
    active_models: ativos.map(m => m.modelo_id),
    exported_models: exportaveis.map(m => m.modelo_id),
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
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita
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
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita
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
WITH modelos AS (
  ${modelosSql}
),
modelos_norm AS (
  SELECT
    *,
    CASE modelo_id
      WHEN 'rs8_monochrome' THEN 1
      WHEN 'phantom' THEN 2
      WHEN 'gt' THEN 3
      WHEN 'avant' THEN 4
      ELSE 99
    END AS prioridade_modelo,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\\p{M}', ''
    ), r'[^a-z0-9|]+', '') AS sku_prefixos_compact
  FROM modelos
),
itens_validos AS (
  SELECT
    i.order_partition_date_brt AS data,
    CAST(i.order_sk AS STRING) AS order_sk,
    COALESCE(
      NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), ''),
      TO_JSON_STRING(STRUCT(
        CAST(i.order_sk AS STRING) AS order_sk,
        CAST(i.sku AS STRING) AS sku,
        CAST(i.item_name AS STRING) AS item_name,
        SAFE_CAST(i.quantity AS INT64) AS quantity,
        SAFE_CAST(i.line_gross_amount AS NUMERIC) AS line_gross_amount,
        SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS line_discount_amount
      ))
    ) AS line_item_key,
    CASE
      WHEN NULLIF(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')), '') IS NOT NULL
        THEN CONCAT('customer_sk:', TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')))
      WHEN REGEXP_CONTAINS(NULLIF(LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))), ''), r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        THEN CONCAT('email:', LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))))
      WHEN LENGTH(NULLIF(REGEXP_REPLACE(COALESCE(
        JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
        JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
        ''
      ), r'\\D', ''), '')) BETWEEN 8 AND 15
        THEN CONCAT('phone:', NULLIF(REGEXP_REPLACE(COALESCE(
          JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
          JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
          ''
        ), r'\\D', ''), ''))
      ELSE NULL
    END AS customer_key,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos_norm)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
cliente_pedidos_source AS (
  SELECT
    CAST(i.order_sk AS STRING) AS order_sk,
    i.order_partition_date_brt AS data_pedido,
    NULLIF(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')), '') AS customer_sk_norm,
    NULLIF(LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))), '') AS email_norm,
    NULLIF(REGEXP_REPLACE(COALESCE(
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
      ''
    ), r'\\D', ''), '') AS phone_norm
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
cliente_pedidos_com_key AS (
  SELECT
    order_sk,
    data_pedido,
    CASE
      WHEN customer_sk_norm IS NOT NULL THEN CONCAT('customer_sk:', customer_sk_norm)
      WHEN REGEXP_CONTAINS(email_norm, r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$') THEN CONCAT('email:', email_norm)
      WHEN LENGTH(phone_norm) BETWEEN 8 AND 15 THEN CONCAT('phone:', phone_norm)
      ELSE NULL
    END AS customer_key
  FROM cliente_pedidos_source
),
cliente_pedidos AS (
  SELECT
    order_sk,
    customer_key,
    MIN(data_pedido) AS data_pedido
  FROM cliente_pedidos_com_key
  WHERE customer_key IS NOT NULL
  GROUP BY order_sk, customer_key
),
cliente_primeira_compra AS (
  SELECT
    customer_key,
    MIN(data_pedido) AS primeira_compra
  FROM cliente_pedidos
  GROUP BY customer_key
),
itens_candidatos AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0,
    m.prioridade_modelo,
    i.*,
    CASE
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'regra_monochrome'
      WHEN m.modelo_id = 'phantom' THEN 'regra_phantom'
      WHEN m.modelo_id = 'gt' THEN 'regra_gt'
      WHEN m.modelo_id = 'avant' THEN 'regra_avant'
      ELSE 'regra_cadastro'
    END AS regra_classificacao
  FROM itens_validos i
  JOIN modelos_norm m
    ON i.data BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)
  WHERE (
    (
      m.modelo_id = 'rs8_monochrome'
      AND (
        STARTS_WITH(i.sku_compact, 'RS8AVANTMC')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTAB')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCF')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTMONO')
        OR STARTS_WITH(i.sku_compact, 'RS8MONO')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )rs8 avant monochrome( |$)')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id = 'phantom'
      AND (
        STARTS_WITH(i.sku_compact, 'PHTEASY')
        OR STARTS_WITH(i.sku_compact, 'PHTSLIP')
        OR STARTS_WITH(i.sku_compact, 'PHTKNIT')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMEASY')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMSLIP')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMKNIT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )phantom( |$)')
      )
    )
    OR (
      m.modelo_id = 'gt'
      AND (
        STARTS_WITH(i.sku_compact, 'RS6GT')
        OR STARTS_WITH(i.sku_compact, '911GT')
        OR STARTS_WITH(i.sku_compact, 'KNITGT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 gt|911 gt|knit gt|gt collection)( |$)')
      )
    )
    OR (
      m.modelo_id = 'avant'
      AND (
        STARTS_WITH(i.sku_compact, 'RS6AVANT')
        OR STARTS_WITH(i.sku_compact, 'RS7AVANT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 avant|rs7 avant|rs8 avant)( |$)')
      )
      AND NOT (
        STARTS_WITH(i.sku_compact, 'RS8AVANTMC')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTAB')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCF')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTMONO')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id NOT IN ('rs8_monochrome', 'phantom', 'gt', 'avant')
      AND (
        EXISTS (
          SELECT 1
          FROM UNNEST(SPLIT(IFNULL(m.sku_prefixos_compact, ''), '|')) AS prefixo
          WHERE TRIM(prefixo) != ''
            AND STARTS_WITH(i.sku_compact, TRIM(prefixo))
        )
        OR EXISTS (
          SELECT 1
          FROM UNNEST(SPLIT(IFNULL(m.termos_norm, ''), '|')) AS termo
          WHERE TRIM(termo) != ''
            AND REGEXP_CONTAINS(
              i.match_text_norm,
              CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(termo), r'\\s+', r'\\\\s+'), r'([^a-z0-9]|$)')
            )
        )
      )
    )
   )
),
itens_classificados AS (
  SELECT
    c.*,
    p.primeira_compra,
    CASE
      WHEN c.customer_key IS NULL THEN NULL
      WHEN p.primeira_compra < c.data THEN 'recorrente'
      ELSE 'novo'
    END AS cliente_tipo
  FROM itens_candidatos c
  LEFT JOIN cliente_primeira_compra p
    ON p.customer_key = c.customer_key
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY c.order_sk, c.line_item_key
    ORDER BY c.prioridade_modelo, c.d0 DESC, c.modelo_id
  ) = 1
),
itens_com_flags AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY modelo_id, order_sk
      ORDER BY data, line_item_key
    ) AS cliente_row_num,
    DATE_DIFF(data, d0, DAY) AS dia_desde_d0,
    COALESCE(
      NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor_detectada,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho_detectado
  FROM itens_classificados
)
SELECT
  modelo_id,
  data,
  order_sk AS source_order_id,
  order_sk,
  'ssot_fct_order_item' AS origem,
  sku,
  item_name AS nome_produto,
  CAST(NULL AS STRING) AS variant_title,
  item_name AS sub_modelo,
  cor_detectada AS cor,
  tamanho_detectado AS tamanho,
  COUNT(DISTINCT order_sk) AS pedidos,
  COUNT(DISTINCT order_sk) AS pedidos_validos,
  SUM(pares) AS pares,
  ROUND(SUM(receita_bruta), 2) AS receita,
  ROUND(SUM(receita_bruta), 2) AS receita_bruta,
  ROUND(SUM(desconto), 2) AS desconto,
  ROUND(SUM(receita_liquida), 2) AS receita_liquida,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'novo')
  END AS novos,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'recorrente')
  END AS recorrentes,
  ANY_VALUE(match_text_norm) AS match_text_norm,
  modelo_id AS modelo_id_detectado,
  ANY_VALUE(d0) AS d0,
  ANY_VALUE(dia_desde_d0) AS dia_desde_d0,
  COUNT(DISTINCT sku) AS skus_distintos,
  TO_JSON_STRING(STRUCT(
    'fct_order_item' AS fonte_base,
    'is_valid_order = TRUE' AS regra_pedido_valido,
    'receita = receita_bruta' AS regra_receita_dashboard,
    ANY_VALUE(regra_classificacao) AS regra_classificacao
  )) AS flags_qualidade,
  'reise-ssot.mart_shared.fct_order_item' AS fonte
FROM itens_com_flags
GROUP BY
  modelo_id,
  data,
  order_sk,
  sku,
  item_name,
  cor_detectada,
  tamanho_detectado
ORDER BY modelo_id, data, order_sk, sku;`;

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
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS valor_bruto_item,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto_item,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS valor_liquido_item,
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
      TO_JSON_STRING(STRUCT(order_sk, sku, titulo_produto, quantidade, valor_bruto_item, desconto_item, valor_liquido_item))
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
      valor_bruto_item,
      desconto_item,
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
    valor_bruto_item,
    desconto_item,
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
      ROUND(SUM(valor_bruto_item), 2) AS receita_bruta_itens,
      ROUND(SUM(desconto_item), 2) AS desconto_itens,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_bruto_item), SUM(quantidade)), 2) AS preco_medio_bruto,
      ROUND(SAFE_DIVIDE(SUM(valor_liquido_item), SUM(quantidade)), 2) AS preco_medio_liquido
    FROM dedup
  ) AS resumo,
  ARRAY(
    SELECT AS STRUCT
      CAST(data_venda AS STRING) AS data,
      COUNT(DISTINCT pedido) AS pedidos,
      SUM(quantidade) AS pares_vendidos,
      ROUND(SUM(valor_bruto_item), 2) AS receita_bruta_itens,
      ROUND(SUM(desconto_item), 2) AS desconto_itens,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_bruto_item), SUM(quantidade)), 2) AS preco_medio_bruto,
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
      ROUND(SUM(valor_bruto_item), 2) AS receita_bruta_itens,
      ROUND(SUM(desconto_item), 2) AS desconto_itens,
      ROUND(SUM(valor_liquido_item), 2) AS receita_liquida_itens,
      ROUND(SAFE_DIVIDE(SUM(valor_bruto_item), SUM(quantidade)), 2) AS preco_medio_bruto,
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
      ROUND(SUM(valor_bruto_item), 2) AS receita_bruta_itens,
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
      ROUND(SUM(valor_bruto_item), 2) AS receita_bruta_itens,
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
    const orderId = String(row.order_sk || row.source_order_id || '').trim();
    if (orderId) pedidosDistintos[orderId] = true;
    else pedidosSemId += Number(row.pedidos_validos ?? row.pedidos ?? 0);
    paresExportados += Number(row.pares || 0);
    receitaExportada += Number((row.receita_bruta ?? row.receita) || 0);
  });

  const resumo = auditoria.resumo || {};
  const pedidosAuditoria = Number(resumo.pedidos || 0);
  const paresAuditoria = Number(resumo.pares_vendidos || 0);
  const receitaAuditoria = Number((resumo.receita_bruta_itens ?? resumo.receita_liquida_itens) || 0);
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
    'reise-ssot.mart_shared.fct_order_item'
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
  Logger.log('exportarTudo: classificacao canonica em BigQuery por SKU/nome, prioridade Monochrome > Phantom > GT > Avant > cadastro generico.');
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

function ehModeloExportavel_(modelo) {
  const status = String(modelo.status || '').trim().toLowerCase();
  return ['historico', 'ativo'].includes(status)
    && Boolean(dateOnly_(modelo.day_zero_base));
}

function ehModeloAtivo_(modelo) {
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
      roas: roasOrNull_(row.roas),
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
    roas: roasOrNull_(row.roas),
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

function roasOrNull_(value) {
  const parsed = numberOrNull_(value);
  if (parsed === null) return null;
  const text = String(value || '').trim().toLowerCase();
  const explicitlyPercent = text.includes('%');
  if (explicitlyPercent || parsed > 100) {
    return round6_(parsed / 100);
  }
  return parsed;
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
