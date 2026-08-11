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
 * - INVESTMENT_SPREADSHEET_ID ou MIDIA_SPREADSHEET_ID (opcional, usado para midia_paga e crm_disparos)
 * - ATRIBUICAO_REAL_CANAL_ENABLED = true|false (opcional; false volta ao estado atual sem canal real)
 *
 * Serviços avançados necessários:
 * - BigQuery API
 */

const DEFAULT_INVESTMENT_SPREADSHEET_ID = '1dlCRxvViAL1gG4Y4pBfhnH_EK-HQdcyGBAwd0vTfV68';

const EXPORT_SCRIPT_VERSION = '20260811-shopify-nested-utm-v18';

const CONFIG = {
  bqProjectId: getProp_('BQ_PROJECT_ID', 'reise-ssot'),
  bqLocation: 'southamerica-east1',
  bqUsLocation: 'US',
  githubRepo: normalizeGitHubRepo_(getProp_('GITHUB_REPO', '')),
  githubBranch: getProp_('GITHUB_BRANCH', 'main'),
  dataPath: getProp_('DATA_PATH', 'data'),
  timeZone: 'America/Sao_Paulo',
  canalAttributionEnabled: getBoolProp_('ATRIBUICAO_REAL_CANAL_ENABLED', true)
};

function investmentSpreadsheetId_() {
  return getProp_('INVESTMENT_SPREADSHEET_ID', getProp_('MIDIA_SPREADSHEET_ID', DEFAULT_INVESTMENT_SPREADSHEET_ID));
}

const SHARE_TRAJETORIA_REQUIRED_TABLES = [
  'datas_sazonais',
  'eventos_comerciais_produto'
];

const METODOLOGIA_INVESTIMENTO = 'correlacao_por_janela_calendario';
const AVISO_INVESTIMENTO = 'Nao mede atribuicao real de clique/conversao. Mostra apenas receita do produto na mesma janela de calendario da acao registrada.';

function exportarTudo() {
  validarGithubConfig_();
  Logger.log(`exportarTudo versao=${EXPORT_SCRIPT_VERSION}`);
  const modelos = carregarModelos_();
  const exportaveis = modelos.filter(ehModeloExportavel_);
  const ativos = modelos.filter(ehModeloAtivo_);
  Logger.log(`exportarTudo: ${modelos.length} modelos carregados de data/lancamentos_modelos.json; ${exportaveis.length} exportaveis com status historico/ativo e day_zero_base valido.`);

  const cadastroStatus = sincronizarCadastroBigQuery_(modelos);
  const sazonalidadeStatus = sincronizarDatasSazonaisSeDisponivel_();
  const eventoComercialStatus = garantirEventosComerciaisProdutoSeDisponivel_();
  const canalMirrorStatus = sincronizarCanalAtribuicaoMirrorSePossivel_(exportaveis);
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

  dataQuality.atribuicao_canal = auditarAtribuicaoCanal_(produtosDia);
  dataQuality.atribuicao_canal.mirror_sync = canalMirrorStatus;
  if (!CONFIG.canalAttributionEnabled) {
    warnings.push('Atribuicao real de canal desligada por ATRIBUICAO_REAL_CANAL_ENABLED=false; receita_paga/receita_organica permanecem null.');
  } else if (dataQuality.atribuicao_canal.status !== 'ok') {
    warnings.push(`Atribuicao real de canal: ${dataQuality.atribuicao_canal.status}. ${dataQuality.atribuicao_canal.mensagem}`);
  }
  if (canalMirrorStatus.status === 'failed') {
    warnings.push(`Mirror de atribuicao por pedido nao sincronizada: ${canalMirrorStatus.error_summary || canalMirrorStatus.error || 'erro desconhecido'}.`);
  }

  logProdutosDiaExport_(exportaveis, produtosDia);
  escreverJsonGitHub_('lancamentos_produtos_dia.json', produtosDia);
  if (auditoriaMonochrome) escreverJsonGitHub_('auditoria_monochrome.json', auditoriaMonochrome);

  const investigacaoMonochromeStatus = exportarInvestigacaoMonochromeSeDisponivel_(exportaveis);
  if (investigacaoMonochromeStatus.status === 'failed') {
    const resumoErroInvestigacao = investigacaoMonochromeStatus.error_summary || investigacaoMonochromeStatus.error || 'erro desconhecido';
    dataQuality.investigacao_linhas_suspeitas = `failed: ${resumoErroInvestigacao}`;
    warnings.push(`investigacao_linhas_suspeitas falhou: ${resumoErroInvestigacao}`);
  } else if (investigacaoMonochromeStatus.error_summary || investigacaoMonochromeStatus.error) {
    const resumoAvisoInvestigacao = investigacaoMonochromeStatus.error_summary || investigacaoMonochromeStatus.error;
    warnings.push(`investigacao_linhas_suspeitas ${investigacaoMonochromeStatus.status}: ${resumoAvisoInvestigacao}`);
  }

  const subModelosStatus = exportarSubModelosDiaSeDisponivel_(exportaveis);
  if (subModelosStatus.status === 'failed') {
    const resumoErroSubModelos = subModelosStatus.error_summary || subModelosStatus.error || 'erro desconhecido';
    dataQuality.sub_modelos_dia = `failed: ${resumoErroSubModelos}`;
    warnings.push(`sub_modelos_dia falhou: ${resumoErroSubModelos}`);
  }

  const estoqueStatus = exportarEstoqueSeDisponivel_(exportaveis);
  const shareStatus = exportarShareTrajetoriaSeDisponivel_(exportaveis);
  if (shareStatus.status === 'failed') {
    const resumoErroShare = shareStatus.error_summary || shareStatus.error || 'erro desconhecido';
    dataQuality.share_trajetoria = `failed: ${resumoErroShare}`;
    warnings.push(`share_trajetoria falhou: ${resumoErroShare}`);
  }
  const midiaStatus = exportarMidiaPagaSeConfigurada_(modelos, shareStatus.payload);
  const crmStatus = exportarCrmSeConfigurado_(shareStatus.payload);
  const metasMensaisStatus = exportarMetasMensaisSeConfigurado_(exportaveis);
  const faturamentoCampanhaStatus = exportarFaturamentoCampanhaSeConfigurado_();
  const impactoStatus = {
    status: 'deprecated',
    rows: 'skipped',
    error_summary: 'substituido por leitura comercial agregada e futura atribuicao real por pedido'
  };
  warnings.push('impacto_investimento.json aposentado: correlacao por janela nao e atribuicao real.');

  const manifest = {
    generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    script_version: EXPORT_SCRIPT_VERSION,
    project: 'Reise Launch Analysis v2',
    model_source: 'github_json',
    sales_source: 'bigquery_ssot_fct_order_item_valid_orders',
    active_models: ativos.map(m => m.modelo_id),
    exported_models: exportaveis.map(m => m.modelo_id),
    row_counts: {
      linha_cadastro: cadastroStatus.rows,
      datas_sazonais: sazonalidadeStatus.rows,
      eventos_comerciais_produto: eventoComercialStatus.rows,
      canal_atribuicao_pedido_mirror: canalMirrorStatus.rows,
      lancamentos_produtos_dia: produtosDia.length,
      auditoria_monochrome: auditoriaMonochrome ? 1 : 'skipped',
      investigacao_linhas_suspeitas: investigacaoMonochromeStatus.rows,
      sub_modelos_dia: subModelosStatus.rows,
      estoque: estoqueStatus.rows,
      share_trajetoria: shareStatus.rows,
      midia_paga: midiaStatus.rows,
      crm_disparos: crmStatus.rows,
      metas_mensais: metasMensaisStatus.rows,
      faturamento_campanha: faturamentoCampanhaStatus.rows,
      impacto_investimento: impactoStatus.rows
    },
    data_quality: dataQuality,
    export_status: {
      cadastro_bigquery: cadastroStatus.status,
      datas_sazonais: sazonalidadeStatus.status,
      eventos_comerciais_produto: eventoComercialStatus.status,
      canal_atribuicao_pedido_mirror: canalMirrorStatus.status,
      investigacao_linhas_suspeitas: investigacaoMonochromeStatus.status,
      sub_modelos_dia: subModelosStatus.status,
      estoque: estoqueStatus.status,
      share_trajetoria: shareStatus.status,
      midia_paga: midiaStatus.status,
      crm_disparos: crmStatus.status,
      metas_mensais: metasMensaisStatus.status,
      faturamento_campanha: faturamentoCampanhaStatus.status,
      impacto_investimento: impactoStatus.status
    },
    files: [
      'lancamentos_modelos.json',
      'lancamentos_produtos_dia.json',
      'auditoria_monochrome.json',
      'investigacao_linhas_suspeitas.json',
      'sub_modelos_dia.json',
      'midia_paga.json',
      'crm_disparos.json',
      'metas_mensais.json',
      'faturamento_campanha.json',
      'estoque.json',
      'share_trajetoria.json',
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

function diagnosticarShareTrajetoria() {
  const tabelasAntes = diagnosticarDependenciasShareTrajetoria_();
  Logger.log(`diagnosticarShareTrajetoria: INFORMATION_SCHEMA antes=${JSON.stringify(tabelasAntes)}`);

  const dependencias = garantirDependenciasShareTrajetoria_(tabelasAntes);
  Logger.log(`diagnosticarShareTrajetoria: dependencias=${JSON.stringify(dependencias)}`);

  const tabelasDepois = diagnosticarDependenciasShareTrajetoria_();
  Logger.log(`diagnosticarShareTrajetoria: INFORMATION_SCHEMA depois=${JSON.stringify(tabelasDepois)}`);

  validarGithubConfig_();
  const modelos = carregarModelos_();
  const exportaveis = modelos.filter(ehModeloExportavel_);
  if (!exportaveis.length) {
    throw new Error('diagnosticarShareTrajetoria: nenhum modelo exportavel com status historico/ativo e day_zero_base valido.');
  }

  try {
    const share = consultarShareTrajetoria_(exportaveis);
    const mono = share.payload.modelos.rs8_monochrome || {};
    const primeiroPonto = (mono.pontos || [])[0] || {};
    const ultimoPonto = (mono.pontos || [])[Math.max(0, (mono.pontos || []).length - 1)] || {};
    const resumo = {
      status: 'ok',
      rows: share.rows,
      modelos: Object.keys(share.payload.modelos || {}),
      rs8_monochrome: {
        receita_empresa_pre_periodo: mono.receita_empresa_pre_periodo,
        receita_empresa_pos_periodo: mono.receita_empresa_pos_periodo,
        variacao_receita_empresa_pct: mono.variacao_receita_empresa_pct,
        dias_pos_disponiveis: mono.dias_pos_disponiveis,
        primeiro_ponto_evento_comercial_tipo: primeiroPonto.evento_comercial_tipo,
        primeiro_ponto_evento_comercial_descricao: primeiroPonto.evento_comercial_descricao,
        ultimo_ponto_tem_receita_empresa: Object.prototype.hasOwnProperty.call(ultimoPonto, 'receita_empresa')
      }
    };
    Logger.log(`diagnosticarShareTrajetoria: consultarShareTrajetoria_ OK=${JSON.stringify(resumo)}`);
    return resumo;
  } catch (error) {
    const resumoErro = resumirErro_(error);
    Logger.log(`diagnosticarShareTrajetoria: ERRO REAL consultarShareTrajetoria_=${resumoErro}`);
    throw new Error(`diagnosticarShareTrajetoria falhou: ${resumoErro}`);
  }
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

function diagnosticarAvantGtOrigemPedido() {
  const query = `
WITH modelos AS (
  SELECT
    'avant' AS modelo_id,
    DATE('2025-12-14') AS d0,
    r'(^|[^a-z0-9])(avant|rs8 avant|rs6 avant|rs7 avant)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs8avant|rs6avant|rs7avant)' AS sku_regex

  UNION ALL

  SELECT
    'gt' AS modelo_id,
    DATE('2025-12-17') AS d0,
    r'(^|[^a-z0-9])(gt collection|rs6 gt|knit gt|911 gt)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs6gt|knitgt|911gt)' AS sku_regex
),
janelas AS (
  SELECT 7 AS dias UNION ALL
  SELECT 15 UNION ALL
  SELECT 30 UNION ALL
  SELECT 60 UNION ALL
  SELECT 90
),
itens AS (
  SELECT
    m.modelo_id,
    CAST(i.order_sk AS STRING) AS order_sk,
    DATE_DIFF(i.order_partition_date_brt, m.d0, DAY) AS dia_desde_d0,
    ROUND(SUM(SAFE_CAST(i.line_gross_amount AS NUMERIC)), 2) AS receita
  FROM \`${CONFIG.bqProjectId}.mart_shared.fct_order_item\` i
  JOIN modelos m
    ON i.order_partition_date_brt BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 89 DAY)
   AND (
      REGEXP_CONTAINS(
        REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ''),
        m.sku_regex
      )
      OR REGEXP_CONTAINS(
        TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')),
        m.termo_regex
      )
    )
  WHERE i.is_valid_order = TRUE
    AND SAFE_CAST(i.quantity AS INT64) > 0
  GROUP BY m.modelo_id, CAST(i.order_sk AS STRING), DATE_DIFF(i.order_partition_date_brt, m.d0, DAY)
),
pedidos AS (
  SELECT
    i.*,
    j.dias AS janela_dias,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_pedido,
    COALESCE(
      NULLIF(UPPER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_system'))), ''),
      NULLIF(UPPER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceSystem'))), ''),
      'SEM_SOURCE_SYSTEM'
    ) AS source_system,
    NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '') AS order_name,
    TO_JSON_STRING(o) AS order_json,
    canal_real.tipo AS tipo_mirror,
    canal_real.canal AS canal_mirror,
    canal_real.regra_atribuicao_real AS regra_mirror
  FROM itens i
  JOIN janelas j
    ON i.dia_desde_d0 BETWEEN 0 AND j.dias - 1
  LEFT JOIN \`${CONFIG.bqProjectId}.core.order\` o
    ON CAST(o.order_sk AS STRING) = i.order_sk
  LEFT JOIN \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\` canal_real
    ON (
      canal_real.source_order_id IS NOT NULL
      AND canal_real.source_order_id = NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '')
    )
    OR (
      canal_real.order_name IS NOT NULL
      AND canal_real.order_name = NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '')
    )
    OR (
      canal_real.email_norm = NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '')
      AND canal_real.paid_date_brt = DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo')
      AND canal_real.total_amount = ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2)
    )
),
sinais AS (
  SELECT
    *,
    REGEXP_CONTAINS(LOWER(COALESCE(order_json, '')), r'(utm|gclid|fbclid|cpc|ppc|pmax|paid|adwords|gads|googleadservices)') AS json_tem_sinal_marketing,
    REGEXP_CONTAINS(LOWER(COALESCE(order_json, '')), r'(utm_medium|utm%5fmedium|cpc|ppc|cpm|pmax|paid|adwords|gads|gclid|fbclid)') AS json_tem_sinal_pago,
    COALESCE(
      REGEXP_EXTRACT(LOWER(COALESCE(order_json, '')), r'"(?:last[_ -]?)?utm[_ -]?medium"\\s*:\\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(COALESCE(order_json, '')), r'(?:utm_medium|utm%5fmedium)(?:=|%3d)([^&#"\\\\ ]+)')
    ) AS utm_medium_encontrado,
    COALESCE(
      REGEXP_EXTRACT(LOWER(COALESCE(order_json, '')), r'"(?:last[_ -]?)?utm[_ -]?source"\\s*:\\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(COALESCE(order_json, '')), r'(?:utm_source|utm%5fsource)(?:=|%3d)([^&#"\\\\ ]+)')
    ) AS utm_source_encontrado
  FROM pedidos
)
SELECT
  modelo_id,
  janela_dias,
  source_system,
  COALESCE(tipo_mirror, 'sem_mirror') AS tipo_mirror,
  COALESCE(canal_mirror, 'sem_canal') AS canal_mirror,
  COALESCE(regra_mirror, 'sem_regra') AS regra_mirror,
  json_tem_sinal_marketing,
  json_tem_sinal_pago,
  COALESCE(utm_medium_encontrado, 'sem_utm_medium') AS utm_medium_encontrado,
  COALESCE(utm_source_encontrado, 'sem_utm_source') AS utm_source_encontrado,
  COUNT(DISTINCT order_sk) AS pedidos,
  ROUND(SUM(receita), 2) AS receita,
  ARRAY_AGG(DISTINCT source_order_id IGNORE NULLS LIMIT 5) AS exemplos_source_order_id,
  ARRAY_AGG(DISTINCT order_name IGNORE NULLS LIMIT 5) AS exemplos_order_name,
  MIN(data_pedido) AS primeira_data,
  MAX(data_pedido) AS ultima_data
FROM sinais
GROUP BY
  modelo_id,
  janela_dias,
  source_system,
  tipo_mirror,
  canal_mirror,
  regra_mirror,
  json_tem_sinal_marketing,
  json_tem_sinal_pago,
  utm_medium_encontrado,
  utm_source_encontrado
ORDER BY
  modelo_id,
  janela_dias,
  pedidos DESC`;

  const rows = runBq_(query);
  Logger.log(`diagnosticarAvantGtOrigemPedido: ${rows.length} linhas`);
  rows.forEach(row => Logger.log(JSON.stringify(row)));
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

function modelosNormCteSql_() {
  return `modelos_norm AS (
  SELECT
    *,
    CASE modelo_id
      WHEN 'rs8_monochrome' THEN 1
      WHEN 'series_2' THEN 2
      WHEN 'phantom' THEN 3
      WHEN 'gt' THEN 4
      WHEN 'avant' THEN 5
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
)`;
}

function itensClassificadosV1CteSql_(options) {
  const opts = options || {};
  const sourceCte = opts.sourceCte || 'itens_validos';
  const joinCond = opts.usarJanelaD0 === false
    ? 'TRUE'
    : 'i.data BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)';
  const partitionBy = opts.partitionBy || 'order_sk, line_item_key';

  return `itens_candidatos_v1 AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0,
    m.prioridade_modelo,
    i.*,
    CASE
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantmc') THEN 'rs8avantmc'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantab') THEN 'rs8avantab'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantct') THEN 'rs8avantct'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantcf') THEN 'rs8avantcf'
      WHEN m.modelo_id = 'rs8_monochrome' AND (STARTS_WITH(i.sku_compact, 'rs8avantmono') OR STARTS_WITH(i.sku_compact, 'rs8mono')) THEN 'rs8mono'
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'rs8_monochrome_sem_prefixo'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(whisky|whiskey)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(whisky|whiskey|wh|wk|wky|ws)')
      ) THEN 'series2_whisky'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(off white|offwhite)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(ow|offwhite)')
      ) THEN 'series2_off_white'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(azul marinho|marinho)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(azulmarinho|marinho|mr|am)')
      ) THEN 'series2_azul_marinho'
      WHEN m.modelo_id = 'series_2' THEN 'series2_sem_cor'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phteasy') THEN 'phteasy'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phtslip') THEN 'phtslip'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phtknit') THEN 'phtknit'
      WHEN m.modelo_id = 'phantom' THEN 'phantom_sem_prefixo'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, 'rs6gt') THEN 'rs6gt'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, '911gt') THEN '911gt'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, 'knitgt') THEN 'knitgt'
      WHEN m.modelo_id = 'gt' THEN 'gt_sem_prefixo'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs6avant') THEN 'rs6avant'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs7avant') THEN 'rs7avant'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs8avant') THEN 'rs8avant'
      WHEN m.modelo_id = 'avant' THEN 'avant_sem_prefixo'
      WHEN m.modelo_id IS NOT NULL THEN m.modelo_id
      ELSE NULL
    END AS sub_modelo_id,
    CASE
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'regra_monochrome'
      WHEN m.modelo_id = 'series_2' THEN 'regra_series_2_cores'
      WHEN m.modelo_id = 'phantom' THEN 'regra_phantom'
      WHEN m.modelo_id = 'gt' THEN 'regra_gt'
      WHEN m.modelo_id = 'avant' THEN 'regra_avant'
      ELSE 'regra_cadastro'
    END AS regra_classificacao
  FROM ${sourceCte} i
  JOIN modelos_norm m
    ON ${joinCond}
  WHERE (
    (
      m.modelo_id = 'rs8_monochrome'
      AND (
        STARTS_WITH(i.sku_compact, 'rs8avantmc')
        OR STARTS_WITH(i.sku_compact, 'rs8avantab')
        OR STARTS_WITH(i.sku_compact, 'rs8avantct')
        OR STARTS_WITH(i.sku_compact, 'rs8avantcf')
        OR STARTS_WITH(i.sku_compact, 'rs8avantmono')
        OR STARTS_WITH(i.sku_compact, 'rs8mono')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )rs8 avant monochrome( |$)')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id = 'series_2'
      AND (
        STARTS_WITH(i.sku_compact, 'rs8avant')
        OR STARTS_WITH(i.sku_compact, 'series2')
        OR STARTS_WITH(i.sku_compact, 'series')
        OR STARTS_WITH(i.sku_compact, 's2')
        OR REGEXP_CONTAINS(i.match_text_norm, r'(^| )(rs8 avant|series 2|series2|serie 2)( |$)')
      )
      AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(whisky|whiskey|off white|offwhite|azul marinho|marinho)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(whisky|whiskey|wh|wk|wky|ws|ow|offwhite|azulmarinho|marinho|mr|am)')
      )
    )
    OR (
      m.modelo_id = 'phantom'
      AND (
        STARTS_WITH(i.sku_compact, 'phteasy')
        OR STARTS_WITH(i.sku_compact, 'phtslip')
        OR STARTS_WITH(i.sku_compact, 'phtknit')
        OR STARTS_WITH(i.sku_compact, 'phantomeasy')
        OR STARTS_WITH(i.sku_compact, 'phantomslip')
        OR STARTS_WITH(i.sku_compact, 'phantomknit')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )phantom( |$)')
      )
    )
    OR (
      m.modelo_id = 'gt'
      AND (
        STARTS_WITH(i.sku_compact, 'rs6gt')
        OR STARTS_WITH(i.sku_compact, '911gt')
        OR STARTS_WITH(i.sku_compact, 'knitgt')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 gt|911 gt|knit gt|gt collection)( |$)')
      )
    )
    OR (
      m.modelo_id = 'avant'
      AND (
        STARTS_WITH(i.sku_compact, 'rs6avant')
        OR STARTS_WITH(i.sku_compact, 'rs7avant')
        OR STARTS_WITH(i.sku_compact, 'rs8avant')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 avant|rs7 avant|rs8 avant)( |$)')
      )
      AND NOT (
        STARTS_WITH(i.sku_compact, 'rs8avantmc')
        OR STARTS_WITH(i.sku_compact, 'rs8avantab')
        OR STARTS_WITH(i.sku_compact, 'rs8avantct')
        OR STARTS_WITH(i.sku_compact, 'rs8avantcf')
        OR STARTS_WITH(i.sku_compact, 'rs8avantmono')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id NOT IN ('rs8_monochrome', 'series_2', 'phantom', 'gt', 'avant')
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
itens_classificados_v1 AS (
  SELECT *
  FROM itens_candidatos_v1
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY ${partitionBy}
    ORDER BY prioridade_modelo, d0 DESC, modelo_id
  ) = 1
)`;
}

function consultarProdutosDia_(modelos) {
  const modelosSql = modelos.map(m => {
    const termosRegex = termosRegex_(m);
    const skuPrefixos = skuPrefixos_(m);
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, DATE('${sql_(m.day_zero_base)}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos`;
  }).join('\nUNION ALL\n');
  const canalMirrorDisponivel = CONFIG.canalAttributionEnabled && tabelaMartSharedExiste_('canal_atribuicao_pedido_mirror');
  const canalMirrorSourceOrderDisponivel = canalMirrorDisponivel && colunaMartSharedExiste_('canal_atribuicao_pedido_mirror', 'source_order_id');
  const canalMirrorOrderNameDisponivel = canalMirrorDisponivel && colunaMartSharedExiste_('canal_atribuicao_pedido_mirror', 'order_name');
  const canalAtribuicaoDisponivel = CONFIG.canalAttributionEnabled;
  if (!CONFIG.canalAttributionEnabled) {
    Logger.log('atribuicao_real: desligada por ATRIBUICAO_REAL_CANAL_ENABLED=false; exportacao continua no estado atual sem canal real.');
  } else {
    Logger.log('atribuicao_real: usando last-click/UTM existente no BigQuery; classificacao binaria pago vs organico sem backfill manual.');
  }
  const canalAtribuicaoCteSql = canalAtribuicaoDisponivel ? canalAtribuicaoPedidoCteSql_(canalMirrorDisponivel, canalMirrorSourceOrderDisponivel, canalMirrorOrderNameDisponivel) : '';
  const canalAtribuicaoSelectSql = canalAtribuicaoDisponivel ? canalAtribuicaoPedidoSelectSql_() : canalAtribuicaoPedidoNullSelectSql_();
  const canalAtribuicaoJoinSql = canalAtribuicaoDisponivel ? canalAtribuicaoPedidoJoinSql_() : '';

  const query = `
WITH modelos AS (
  ${modelosSql}
),
${modelosNormCteSql_()},
${canalAtribuicaoCteSql}
itens_validos AS (
  SELECT
    i.order_partition_date_brt AS data,
    CAST(i.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '') AS source_order_id_real,
    NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '') AS order_name_norm,
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
      WHEN NULLIF(TRIM(CAST(o.customer_sk AS STRING)), '') IS NOT NULL
        THEN CONCAT('customer_sk:', TRIM(CAST(o.customer_sk AS STRING)))
      WHEN REGEXP_CONTAINS(NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), ''), r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        THEN CONCAT('email:', LOWER(TRIM(CAST(o.customer_email AS STRING))))
      WHEN LENGTH(NULLIF(REGEXP_REPLACE(COALESCE(
        CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone_digits') AS STRING),
        CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone') AS STRING),
        ''
      ), r'\\D', ''), '')) BETWEEN 8 AND 15
        THEN CONCAT('phone:', NULLIF(REGEXP_REPLACE(COALESCE(
          CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone_digits') AS STRING),
          CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone') AS STRING),
          ''
        ), r'\\D', ''), ''))
      ELSE NULL
    END AS customer_key,
    ${canalAtribuicaoSelectSql}
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, ''), ' ', COALESCE(pl_match.cor, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  LEFT JOIN \`reise-ssot.core.order\` o
    ON CAST(o.order_sk AS STRING) = CAST(i.order_sk AS STRING)
${canalAtribuicaoJoinSql}
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl_match
    ON pl_match.sku_key = UPPER(TRIM(i.sku))
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos_norm)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
cliente_pedidos_source AS (
  SELECT
    CAST(o.order_sk AS STRING) AS order_sk,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_pedido,
    NULLIF(TRIM(CAST(o.customer_sk AS STRING)), '') AS customer_sk_norm,
    NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '') AS email_norm,
    NULLIF(REGEXP_REPLACE(COALESCE(
      CAST(o.customer_phone_digits AS STRING),
      CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone') AS STRING),
      ''
    ), r'\\D', ''), '') AS phone_norm
  FROM \`reise-ssot.mart_shared.orders_all_valid_no_migracao\` o
  WHERE DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
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
${itensClassificadosV1CteSql_({ partitionBy: 'order_sk, line_item_key' })},
itens_classificados AS (
  SELECT
    c.*,
    p.primeira_compra,
    CASE
      WHEN c.customer_key IS NULL THEN NULL
      WHEN p.primeira_compra < c.data THEN 'recorrente'
      ELSE 'novo'
    END AS cliente_tipo
  FROM itens_classificados_v1 c
  LEFT JOIN cliente_primeira_compra p
    ON p.customer_key = c.customer_key
),
itens_com_flags AS (
  SELECT
    ic.*,
    CAST(NULL AS STRING) AS variant_title_catalogo,
    ROW_NUMBER() OVER (
      PARTITION BY ic.modelo_id, ic.order_sk
      ORDER BY ic.data, ic.line_item_key
    ) AS cliente_row_num,
    DATE_DIFF(ic.data, ic.d0, DAY) AS dia_desde_d0,
    COALESCE(
      NULLIF(REGEXP_REPLACE(TRIM(pl.cor), r'^\\d+$', ''), ''),
      NULLIF(REGEXP_EXTRACT(ic.match_text_norm, r'(?:^| )(all black|off white|azul marinho|whisky|whiskey|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor_detectada,
    COALESCE(
      NULLIF(TRIM(CAST(pl.tamanho AS STRING)), ''),
      NULLIF(REGEXP_EXTRACT(ic.sku, r'-(3[3-9]|4[0-8])$'), ''),
      NULLIF(REGEXP_EXTRACT(ic.item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '')
    ) AS tamanho_detectado
  FROM itens_classificados ic
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor,
      ARRAY_AGG(NULLIF(TRIM(CAST(tamanho AS STRING)), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS tamanho
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl
    ON pl.sku_key = UPPER(TRIM(ic.sku))
)
SELECT
  modelo_id,
  sub_modelo_id,
  data,
  ANY_VALUE(source_order_id_real) AS source_order_id,
  order_sk,
  ANY_VALUE(order_name_norm) AS order_name,
  'ssot_fct_order_item' AS origem,
  sku,
  item_name AS nome_produto,
  ANY_VALUE(variant_title_catalogo) AS variant_title,
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
  ANY_VALUE(canal_real) AS canal_real,
  ANY_VALUE(tipo_real) AS tipo_real,
  ANY_VALUE(atribuicao_match_key) AS atribuicao_match_key,
  ANY_VALUE(regra_atribuicao_real) AS regra_atribuicao_real,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE ROUND(SUM(IF(tipo_real = 'paid', receita_bruta, 0)), 2)
  END AS receita_paga,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE ROUND(SUM(IF(tipo_real IS NOT NULL AND tipo_real != 'paid', receita_bruta, 0)), 2)
  END AS receita_organica,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_crm,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_outros_canais,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_sem_match_atribuicao,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNT(DISTINCT IF(tipo_real = 'paid', order_sk, NULL))
  END AS pedidos_pagos,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNT(DISTINCT IF(tipo_real IS NOT NULL AND tipo_real != 'paid', order_sk, NULL))
  END AS pedidos_organicos,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_crm,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_outros_canais,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_sem_match_atribuicao,
  COUNT(DISTINCT sku) AS skus_distintos,
  TO_JSON_STRING(STRUCT(
    'fct_order_item' AS fonte_base,
    'is_valid_order = TRUE' AS regra_pedido_valido,
    'receita = receita_bruta' AS regra_receita_dashboard,
    COALESCE(ANY_VALUE(regra_atribuicao_real), IF(COUNTIF(tipo_real IS NOT NULL) > 0, 'email_data_valor_last_click', 'sem_atribuicao_real')) AS regra_atribuicao_real,
    COALESCE(ANY_VALUE(regra_atribuicao_real), IF(COUNTIF(tipo_real IS NOT NULL) > 0, 'atribuicao_real_pedido', 'origem_pedido_binaria')) AS regra_join_atribuicao,
    ANY_VALUE(regra_classificacao) AS regra_classificacao
  )) AS flags_qualidade,
  'reise-ssot.mart_shared.fct_order_item' AS fonte
FROM itens_com_flags
GROUP BY
  modelo_id,
  sub_modelo_id,
  data,
  order_sk,
  sku,
  item_name,
  cor_detectada,
  tamanho_detectado
ORDER BY modelo_id, data, order_sk, sku;`;

  const rows = runBq_(query);
  return sanitizarProdutosDiaPublicos_(rows);
}

function sanitizarProdutosDiaPublicos_(rows) {
  return (rows || []).map(row => {
    const clean = { ...row };
    delete clean.source_order_id;
    delete clean.order_name;
    delete clean.atribuicao_match_key;
    return clean;
  });
}

function normalizarCanalPedido_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tipoCanalPedidoRow_(row) {
  const explicitType = normalizarCanalPedido_([
    row.tipo_real,
    row.tipo,
    row.tipo_canal,
    row.channel_type
  ].filter(Boolean).join(' '));
  if (/(^| )(paid|pago|midia paga|paid media)( |$)/.test(explicitType)) return 'paid';
  if (/(^| )(unmatched|sem origem|sem utm|sem atribuicao|sem match|unattributed|unknown|an unknown source|not set)( |$)/.test(explicitType)) return 'organic';
  if (isSemOrigemCanalPedidoRow_(row)) return 'organic';
  if (/(^| )(owned|crm|email|newsletter|whatsapp|sms|organic|organico|seo|direct|referral|other|outros)( |$)/.test(explicitType)) return 'organic';

  const channelText = normalizarCanalPedido_([
    row.canal_real,
    row.canal,
    row.channel,
    row.chanel,
    row.grupo_canal,
    row.raw_channel,
    row.raw_medium,
    row.raw_source,
    row.utm_medium,
    row.utm_source
  ].filter(Boolean).join(' '));
  if (!channelText) return '';
  if (/(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen|cpc|ppc|cpm|paid|ads|anuncio|anuncios|patrocinad)( |$)/.test(channelText)) return 'paid';
  if (isSemOrigemCanalPedidoRow_(row)) return 'organic';
  return 'organic';
}

function isSemOrigemCanalPedidoRow_(row) {
  const text = normalizarCanalPedido_([
    row.tipo_real,
    row.tipo,
    row.tipo_canal,
    row.channel_type,
    row.regra_atribuicao_real,
    row.regra_join_atribuicao,
    row.canal_real,
    row.canal,
    row.channel,
    row.grupo_canal,
    row.raw_channel,
    row.raw_medium,
    row.raw_source
  ].filter(Boolean).join(' '));
  return /(^| )(unmatched|sem origem|sem utm|sem atribuicao|sem match|unattributed|unknown|an unknown source|not set)( |$)/.test(text);
}

function auditarAtribuicaoCanal_(rows) {
  const resumoVazio = {
    enabled: CONFIG.canalAttributionEnabled,
    status: CONFIG.canalAttributionEnabled ? 'sem_vendas' : 'desligada',
    mensagem: CONFIG.canalAttributionEnabled
      ? 'Nenhuma linha de venda exportada para auditar.'
      : 'Atribuicao real de canal desligada por Script Property.',
    pedidos_total: 0,
    pedidos_classificados: 0,
    cobertura_pedidos_pct: null,
    receita_total: 0,
    receita_classificada: 0,
    cobertura_receita_pct: null,
    pedidos_sem_match_atribuicao: 0,
    receita_paga: 0,
    receita_organica: 0,
    receita_crm: 0,
    receita_outros_canais: 0,
    receita_sem_match_atribuicao: 0,
    por_modelo: []
  };
  if (!rows || !rows.length) return resumoVazio;

  const buildBucket = (modeloId) => ({
    modelo_id: modeloId,
    pedidos: {},
    pedidos_classificados: {},
    pedidos_pagos: {},
    pedidos_organicos: {},
    pedidos_crm: {},
    pedidos_outros: {},
    pedidos_sem_match: {},
    receita_total: 0,
    receita_classificada: 0,
    receita_paga: 0,
    receita_organica: 0,
    receita_crm: 0,
    receita_outros_canais: 0,
    receita_sem_match_atribuicao: 0
  });
  const total = buildBucket('total');
  const byModel = {};

  const addToBucket = (bucket, row, orderKey, receita, tipo) => {
    bucket.pedidos[orderKey] = true;
    bucket.receita_total += receita;
    if (tipo) {
      bucket.pedidos_classificados[orderKey] = true;
      bucket.receita_classificada += receita;
    }
    if (tipo === 'paid') {
      bucket.pedidos_pagos[orderKey] = true;
      bucket.receita_paga += receita;
    } else if (tipo === 'organic' || tipo === 'owned' || tipo === 'crm') {
      bucket.pedidos_organicos[orderKey] = true;
      bucket.receita_organica += receita;
    } else if (tipo) {
      bucket.pedidos_organicos[orderKey] = true;
      bucket.receita_organica += receita;
    }
  };

  rows.forEach(row => {
    const modeloId = String(row.modelo_id || 'sem_modelo').trim() || 'sem_modelo';
    const orderKey = String(row.order_sk || `${row.data || ''}|${row.sku || ''}|${row.nome_produto || ''}`);
    const receita = numberOrNull_(row.receita_bruta) ?? numberOrNull_(row.receita) ?? 0;
    const tipo = tipoCanalPedidoRow_(row);
    if (!byModel[modeloId]) byModel[modeloId] = buildBucket(modeloId);
    addToBucket(total, row, orderKey, receita, tipo);
    addToBucket(byModel[modeloId], row, orderKey, receita, tipo);
  });

  const countKeys = obj => Object.keys(obj || {}).length;
  const summarize = bucket => {
    const pedidosTotal = countKeys(bucket.pedidos);
    const pedidosClassificados = countKeys(bucket.pedidos_classificados);
    const receitaTotal = round2_(bucket.receita_total);
    const receitaClassificada = round2_(bucket.receita_classificada);
    return {
      modelo_id: bucket.modelo_id,
      pedidos_total: pedidosTotal,
      pedidos_classificados: pedidosClassificados,
      cobertura_pedidos_pct: pedidosTotal ? round6_(pedidosClassificados / pedidosTotal) : null,
      pedidos_pagos: countKeys(bucket.pedidos_pagos),
      pedidos_organicos: countKeys(bucket.pedidos_organicos),
      pedidos_crm: countKeys(bucket.pedidos_crm),
      pedidos_outros_canais: countKeys(bucket.pedidos_outros),
      pedidos_sem_match_atribuicao: countKeys(bucket.pedidos_sem_match),
      receita_total: receitaTotal,
      receita_classificada: receitaClassificada,
      cobertura_receita_pct: bucket.receita_total ? round6_(bucket.receita_classificada / bucket.receita_total) : null,
      receita_paga: round2_(bucket.receita_paga),
      receita_organica: round2_(bucket.receita_organica),
      receita_crm: round2_(bucket.receita_crm),
      receita_outros_canais: round2_(bucket.receita_outros_canais),
      receita_sem_match_atribuicao: round2_(bucket.receita_sem_match_atribuicao)
    };
  };

  const totalSummary = summarize(total);
  const porModelo = Object.keys(byModel).sort().map(modeloId => summarize(byModel[modeloId]));
  const status = !CONFIG.canalAttributionEnabled
    ? 'desligada'
    : totalSummary.pedidos_classificados === 0
      ? 'sem_atribuicao_real'
      : totalSummary.cobertura_pedidos_pct < 0.8
        ? 'cobertura_baixa'
        : 'ok';
  const mensagem = {
    desligada: 'Atribuicao real de canal desligada por Script Property.',
    sem_atribuicao_real: 'Nenhum pedido exportado veio com canal_real/channel/tipo_real; origem real por pedido ausente no export.',
    cobertura_baixa: 'Menos de 80% dos pedidos exportados receberam canal_real/channel/tipo_real; trate canal atribuido como parcial.',
    ok: 'Pedidos classificados com cobertura suficiente para leitura paga/organica/CRM.'
  }[status] || 'Status de atribuicao indefinido.';

  return {
    enabled: CONFIG.canalAttributionEnabled,
    status,
    mensagem,
    pedidos_total: totalSummary.pedidos_total,
    pedidos_classificados: totalSummary.pedidos_classificados,
    pedidos_sem_match_atribuicao: totalSummary.pedidos_sem_match_atribuicao,
    cobertura_pedidos_pct: totalSummary.cobertura_pedidos_pct,
    receita_total: totalSummary.receita_total,
    receita_classificada: totalSummary.receita_classificada,
    cobertura_receita_pct: totalSummary.cobertura_receita_pct,
    receita_paga: totalSummary.receita_paga,
    receita_organica: totalSummary.receita_organica,
    receita_crm: totalSummary.receita_crm,
    receita_outros_canais: totalSummary.receita_outros_canais,
    receita_sem_match_atribuicao: totalSummary.receita_sem_match_atribuicao,
    por_modelo: porModelo
  };
}

function exportarSubModelosDiaSeDisponivel_(modelos) {
  if (!modelos.length) {
    Logger.log('Sem modelos exportaveis com day_zero_base valido; sub_modelos_dia nao consultado.');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const subModelosDia = consultarSubModelosDia_(modelos);
    escreverJsonGitHub_('sub_modelos_dia.json', subModelosDia);
    Logger.log(`sub_modelos_dia.json exportado com ${subModelosDia.length} linhas.`);
    return { status: 'exported', rows: subModelosDia.length };
  } catch (error) {
    const resumoErro = resumirErro_(error);
    Logger.log(`sub_modelos_dia.json nao exportado; mantendo arquivo atual. Erro: ${resumoErro}`);
    return { status: 'failed', rows: 'failed', error: error.message, error_summary: resumoErro };
  }
}

function consultarSubModelosDia_(modelos) {
  const modelosSql = modelos.map(m => {
    const termosRegex = termosRegex_(m);
    const skuPrefixos = skuPrefixos_(m);
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, DATE('${sql_(m.day_zero_base)}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos`;
  }).join('\nUNION ALL\n');

  const query = `
WITH modelos AS (
  ${modelosSql}
),
${modelosNormCteSql_()},
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
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS valor_bruto_item,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, ''), ' ', COALESCE(pl_match.cor, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl_match
    ON pl_match.sku_key = UPPER(TRIM(i.sku))
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos_norm)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
${itensClassificadosV1CteSql_({ partitionBy: 'order_sk, line_item_key' })}
SELECT
  modelo_id,
  sub_modelo_id,
  data AS data_venda,
  SUM(quantidade) AS pares,
  ROUND(SUM(valor_bruto_item), 2) AS receita
FROM itens_classificados_v1
WHERE modelo_id IS NOT NULL
GROUP BY modelo_id, sub_modelo_id, data
ORDER BY modelo_id, sub_modelo_id, data_venda;`;

  return runBq_(query);
}

function consultarAuditoriaMonochromeSeAtivo_(modelos) {
  const mono = modelos.find(isMonochromeModel_);
  if (!mono) return null;
  return consultarAuditoriaMonochrome_(mono);
}

function monochromeAuditoriaBaseCtesSql_(modelo) {
  const d0 = sql_(modelo.day_zero_base);
  const modeloNome = sql_(modelo.modelo || 'RS8 Avant Monochrome');
  const termosRegex = termosRegex_(modelo);
  const skuPrefixos = skuPrefixos_(modelo);

  return `modelos AS (
  SELECT 'rs8_monochrome' AS modelo_id, '${modeloNome}' AS modelo, DATE('${d0}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos
),
${modelosNormCteSql_()},
itens_validos AS (
  SELECT
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    CAST(o.order_name AS STRING) AS pedido,
    CAST(o.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), '') AS line_item_id,
    COALESCE(
      NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), ''),
      TO_JSON_STRING(STRUCT(
        CAST(o.order_sk AS STRING) AS order_sk,
        CAST(i.sku AS STRING) AS sku,
        CAST(i.item_name AS STRING) AS item_name,
        SAFE_CAST(i.quantity AS INT64) AS quantity,
        SAFE_CAST(i.line_gross_amount AS NUMERIC) AS line_gross_amount,
        SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS line_discount_amount
      ))
    ) AS line_item_key,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.core.order_item\` i
  JOIN \`reise-ssot.core.order\` o
    ON o.order_sk = i.order_sk
  CROSS JOIN modelos_norm m
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
${itensClassificadosV1CteSql_({ partitionBy: 'order_sk, line_item_key' })}`;
}

function consultarAuditoriaMonochrome_(modelo) {
  const query = `
WITH ${monochromeAuditoriaBaseCtesSql_(modelo)},
classificadas_raw AS (
  SELECT
    data AS data_venda,
    pedido,
    order_sk,
    line_item_id,
    line_item_key AS dedupe_key,
    item_name AS titulo_produto,
    sku,
    pares AS quantidade,
    receita_bruta AS valor_bruto_item,
    desconto AS desconto_item,
    receita_liquida AS valor_liquido_item,
    item_name_norm,
    sku_compact AS sku_norm,
    regra_classificacao,
    COALESCE(
      NULLIF(TRIM(pl.cor_catalogo), ''),
      NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor,
    COALESCE(
      NULLIF(TRIM(CAST(pl.tamanho_catalogo AS STRING)), ''),
      NULLIF(REGEXP_EXTRACT(sku, r'-(3[3-9]|4[0-8])$'), ''),
      NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '')
    ) AS tamanho
  FROM itens_candidatos_v1
  LEFT JOIN (
    SELECT sku AS pl_sku, cor AS cor_catalogo, CAST(tamanho AS STRING) AS tamanho_catalogo
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
  ) pl
    ON UPPER(TRIM(pl.pl_sku)) = UPPER(TRIM(sku))
  WHERE modelo_id = 'rs8_monochrome'
), classificadas AS (
  SELECT
    data AS data_venda,
    pedido,
    order_sk,
    line_item_id,
    line_item_key AS dedupe_key,
    item_name AS titulo_produto,
    sku,
    pares AS quantidade,
    receita_bruta AS valor_bruto_item,
    desconto AS desconto_item,
    receita_liquida AS valor_liquido_item,
    item_name_norm,
    sku_compact AS sku_norm,
    regra_classificacao,
    COALESCE(
      NULLIF(TRIM(pl.cor_catalogo), ''),
      NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor,
    COALESCE(
      NULLIF(TRIM(CAST(pl.tamanho_catalogo AS STRING)), ''),
      NULLIF(REGEXP_EXTRACT(sku, r'-(3[3-9]|4[0-8])$'), ''),
      NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '')
    ) AS tamanho
  FROM itens_classificados_v1
  LEFT JOIN (
    SELECT sku AS pl_sku, cor AS cor_catalogo, CAST(tamanho AS STRING) AS tamanho_catalogo
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
  ) pl
    ON UPPER(TRIM(pl.pl_sku)) = UPPER(TRIM(sku))
  WHERE modelo_id = 'rs8_monochrome'
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
  FROM classificadas_raw
  GROUP BY dedupe_key
  HAVING COUNT(*) > 1
  ORDER BY linhas DESC
  LIMIT 100
), linhas_suspeitas AS (
  SELECT
    v.pedido,
    v.sku,
    v.item_name AS titulo_produto,
    v.pares AS quantidade,
    v.receita_bruta AS valor_bruto_item,
    v.desconto AS desconto_item,
    v.receita_liquida AS valor_liquido_item,
    v.item_name_norm,
    v.sku_compact AS sku_norm
  FROM itens_validos v
  LEFT JOIN itens_classificados_v1 c
    ON c.order_sk = v.order_sk
   AND c.line_item_key = v.line_item_key
  WHERE c.line_item_key IS NULL
    -- RS8 isolado e compartilhado por outros produtos; alerta so usa termos de linha.
    AND REGEXP_CONTAINS(v.match_text_norm, r'(avant|mono|monochrome)')
  LIMIT 100
)
SELECT TO_JSON_STRING(STRUCT(
  'rs8_monochrome' AS modelo_id,
  'reise-ssot.core.order_item + core.order' AS fonte,
  'itens_classificados_v1: prioridade rs8_monochrome > series_2 > phantom > gt > avant > cadastro_generico; janela D0 a D+90' AS regra_match,
  STRUCT(
    CAST((SELECT d0 FROM modelos_norm) AS STRING) AS inicio,
    CAST(DATE_ADD((SELECT d0 FROM modelos_norm), INTERVAL 90 DAY) AS STRING) AS fim
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

function exportarInvestigacaoMonochrome() {
  validarGithubConfig_();
  const modelos = carregarModelos_().filter(ehModeloExportavel_);
  const status = exportarInvestigacaoMonochromeSeDisponivel_(modelos);
  Logger.log(`exportarInvestigacaoMonochrome: ${JSON.stringify(status)}`);
  return status;
}

function exportarInvestigacaoMonochromeSeDisponivel_(modelos) {
  const mono = (modelos || []).find(isMonochromeModel_);
  if (!mono) {
    Logger.log('investigacao_linhas_suspeitas nao exportada: rs8_monochrome ausente dos modelos exportaveis.');
    return { status: 'skipped', rows: 'skipped', error_summary: 'rs8_monochrome ausente dos modelos exportaveis' };
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '';
  if (!apiKey) {
    Logger.log('investigacao_linhas_suspeitas nao exportada: ANTHROPIC_API_KEY nao configurada.');
    return { status: 'skipped', rows: 'skipped', error_summary: 'ANTHROPIC_API_KEY nao configurada' };
  }

  try {
    const linhas = consultarLinhasSuspeitasMonochrome_(mono);
    const analises = investigarLinhasSuspeitasComIA_(linhas);
    const relatorio = montarRelatorioInvestigacaoMonochrome_(linhas, analises);
    escreverJsonGitHub_('investigacao_linhas_suspeitas.json', relatorio);
    Logger.log(`investigacao_linhas_suspeitas.json exportado com ${relatorio.total_analisado} linhas. Resumo=${JSON.stringify(relatorio.resumo)}`);
    return { status: 'exported', rows: relatorio.total_analisado, resumo: relatorio.resumo };
  } catch (error) {
    const resumoErro = resumirErro_(error);
    Logger.log(`investigacao_linhas_suspeitas.json nao exportado; mantendo arquivo atual. Erro: ${resumoErro}`);
    return { status: 'failed', rows: 'failed', error: error.message, error_summary: resumoErro };
  }
}

function consultarLinhasSuspeitasMonochrome_(modelo) {
  const query = `
WITH ${monochromeAuditoriaBaseCtesSql_(modelo)}
SELECT
  ROW_NUMBER() OVER (ORDER BY v.receita_bruta DESC, v.data, v.order_sk, v.sku) AS linha_idx,
  CAST(v.data AS STRING) AS data_venda,
  v.pedido,
  v.order_sk,
  v.line_item_id,
  v.line_item_key AS dedupe_key,
  v.sku,
  v.item_name,
  v.item_name_norm,
  v.sku_compact,
  v.match_text_norm,
  v.pares AS quantidade,
  ROUND(v.receita_bruta, 2) AS valor_bruto_item,
  ROUND(v.desconto, 2) AS desconto_item,
  ROUND(v.receita_liquida, 2) AS valor_liquido_item
FROM itens_validos v
LEFT JOIN itens_classificados_v1 c
  ON c.order_sk = v.order_sk
 AND c.line_item_key = v.line_item_key
WHERE c.line_item_key IS NULL
  AND REGEXP_CONTAINS(v.match_text_norm, r'(avant|mono|monochrome)')
ORDER BY v.receita_bruta DESC, v.data, v.order_sk, v.sku
LIMIT 200`;

  return runBq_(query);
}

function investigarLinhasSuspeitasComIA_(linhas) {
  if (!linhas || !linhas.length) return [];

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada.');

  const model = getProp_('ANTHROPIC_MODEL', 'claude-sonnet-4-6');
  const resultados = [];
  const lotes = dividirEmLotes_(linhas, 15);

  lotes.forEach((lote, loteIndex) => {
    const body = {
      model,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: montarPromptInvestigacaoMonochrome_(lote)
      }]
    };

    const response = urlFetchComRetry_('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    }, `Anthropic investigacao_linhas_suspeitas lote ${loteIndex + 1}/${lotes.length}`);

    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`Anthropic retornou HTTP ${code}: ${text.slice(0, 400)}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Anthropic retornou JSON invalido: ${error.message}`);
    }

    const output = extrairTextoAnthropic_(payload);
    const parsed = parseAnthropicJsonArray_(output);
    resultados.push(...normalizarResultadoInvestigacaoLote_(lote, parsed));

    if (loteIndex < lotes.length - 1) Utilities.sleep(500);
  });

  return resultados;
}

function montarPromptInvestigacaoMonochrome_(lote) {
  const linhas = lote.map(row => ({
    sku: row.sku || null,
    item_name: row.item_name || null,
    item_name_norm: row.item_name_norm || null,
    sku_compact: row.sku_compact || null,
    quantidade: numberOrNull_(row.quantidade),
    valor_bruto_item: numberOrNull_(row.valor_bruto_item),
    data_venda: row.data_venda || null
  }));

  return [
    'Voce e um auditor de classificacao de produtos da Reise.',
    'Contexto: as linhas abaixo apareceram em pedidos validos, contem termos como avant, mono ou monochrome, mas NAO foram classificadas por itens_classificados_v1 como nenhum lancamento.',
    'Objetivo: decidir se cada linha provavelmente e RS8 Avant Monochrome perdida pela regra atual, se e outro produto, ou se e indeterminada.',
    '',
    'Regras atuais copiadas literalmente da CTE central itensClassificadosV1CteSql_:',
    '```sql',
    regrasClassificacaoMonochromePrompt_(),
    '```',
    '',
    'Responda somente com um JSON array valido, sem markdown, sem texto antes ou depois.',
    'A resposta deve ter exatamente o mesmo numero de itens e a mesma ordem das linhas de entrada.',
    'Campos obrigatorios por item:',
    '- sku: string ou null',
    '- classificacao: "provavel_monochrome", "outro_produto" ou "indeterminado"',
    '- confianca: "alta", "media" ou "baixa"',
    '- justificativa: 1 ou 2 frases especificas em portugues, explicando sku/nome e por que a regra atual pegou ou nao pegou.',
    '',
    'Linhas para analisar:',
    JSON.stringify(linhas, null, 2)
  ].join('\n');
}

function regrasClassificacaoMonochromePrompt_() {
  return itensClassificadosV1CteSql_({ partitionBy: 'order_sk, line_item_key' });
}

function extrairTextoAnthropic_(payload) {
  const content = Array.isArray(payload && payload.content) ? payload.content : [];
  return content
    .map(part => part && part.type === 'text' ? String(part.text || '') : '')
    .join('\n')
    .trim();
}

function parseAnthropicJsonArray_(text) {
  const raw = String(text || '').trim();
  const semCerca = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(semCerca);
    if (!Array.isArray(parsed)) throw new Error('resposta nao e array');
    return parsed;
  } catch (error) {
    const start = semCerca.indexOf('[');
    const end = semCerca.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(semCerca.slice(start, end + 1));
      if (!Array.isArray(parsed)) throw new Error('resposta extraida nao e array');
      return parsed;
    }
    throw new Error(`Nao consegui interpretar JSON array da IA: ${error.message}`);
  }
}

function normalizarResultadoInvestigacaoLote_(lote, parsed) {
  if (!Array.isArray(parsed)) throw new Error('Resultado da IA precisa ser um array.');
  if (parsed.length !== lote.length) {
    Logger.log(`investigacao_linhas_suspeitas: lote retornou ${parsed.length} analises para ${lote.length} linhas; faltantes serao marcadas como indeterminado.`);
  }

  return lote.map((linha, index) => {
    const raw = parsed[index] || {};
    const sku = String(raw.sku || linha.sku || '').trim() || null;
    const classificacao = normalizarClassificacaoInvestigacao_(raw.classificacao);
    const confianca = normalizarConfiancaInvestigacao_(raw.confianca);
    const justificativa = String(raw.justificativa || '').trim()
      || `Resposta da IA ausente ou sem justificativa para sku ${linha.sku || 'sem_sku'}; revisar manualmente.`;

    return { sku, classificacao, confianca, justificativa };
  });
}

function montarRelatorioInvestigacaoMonochrome_(linhas, analises) {
  const resumo = {
    provavel_monochrome: 0,
    outro_produto: 0,
    indeterminado: 0,
    por_confianca: { alta: 0, media: 0, baixa: 0 },
    receita_provavel_monochrome_perdida: 0,
    receita_provavel_monochrome_perdida_por_confianca: {
      alta: 0,
      media: 0,
      baixa: 0,
      alta_media: 0
    }
  };
  const receitaPorConfianca = { alta: 0, media: 0, baixa: 0 };

  const linhasRelatorio = (linhas || []).map((linha, index) => {
    const analise = analises[index] || {};
    const classificacao = normalizarClassificacaoInvestigacao_(analise.classificacao);
    const confianca = normalizarConfiancaInvestigacao_(analise.confianca);
    const receita = numberOrNull_(linha.valor_bruto_item) || 0;
    const justificativa = String(analise.justificativa || '').trim()
      || `Linha sem analise da IA para sku ${linha.sku || 'sem_sku'}; revisar manualmente.`;

    resumo[classificacao] = (resumo[classificacao] || 0) + 1;
    resumo.por_confianca[confianca] = (resumo.por_confianca[confianca] || 0) + 1;
    if (classificacao === 'provavel_monochrome') {
      receitaPorConfianca[confianca] += receita;
    }

    return {
      linha_idx: Number(linha.linha_idx || index + 1),
      data_venda: linha.data_venda || null,
      pedido: linha.pedido || null,
      order_sk: linha.order_sk || null,
      line_item_id: linha.line_item_id || null,
      dedupe_key: linha.dedupe_key || null,
      sku: linha.sku || null,
      item_name: linha.item_name || null,
      item_name_norm: linha.item_name_norm || null,
      sku_compact: linha.sku_compact || null,
      match_text_norm: linha.match_text_norm || null,
      quantidade: numberOrNull_(linha.quantidade),
      valor_bruto_item: numberOrNull_(linha.valor_bruto_item),
      desconto_item: numberOrNull_(linha.desconto_item),
      valor_liquido_item: numberOrNull_(linha.valor_liquido_item),
      classificacao,
      confianca,
      justificativa
    };
  });

  resumo.receita_provavel_monochrome_perdida_por_confianca = {
    alta: round2_(receitaPorConfianca.alta),
    media: round2_(receitaPorConfianca.media),
    baixa: round2_(receitaPorConfianca.baixa),
    alta_media: round2_(receitaPorConfianca.alta + receitaPorConfianca.media)
  };
  resumo.receita_provavel_monochrome_perdida = resumo.receita_provavel_monochrome_perdida_por_confianca.alta_media;

  return {
    gerado_em: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    modelo_id: 'rs8_monochrome',
    fonte: 'reise-ssot.core.order_item + core.order',
    regra_base: 'itens_classificados_v1 sem alteracao; relatorio apenas investigativo',
    total_analisado: linhasRelatorio.length,
    resumo,
    linhas: linhasRelatorio
  };
}

function normalizarClassificacaoInvestigacao_(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'provavel_monochrome' || clean === 'outro_produto' || clean === 'indeterminado') return clean;
  return 'indeterminado';
}

function normalizarConfiancaInvestigacao_(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'alta' || clean === 'media' || clean === 'baixa') return clean;
  return 'baixa';
}

function dividirEmLotes_(rows, size) {
  const chunks = [];
  for (let i = 0; i < (rows || []).length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
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
    const termosRegex = termosRegex_(m);
    const skuPrefixos = skuPrefixos_(m);
    const d0 = sql_(m.day_zero_base);
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, DATE('${d0}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos`;
  }).join('\nUNION ALL\n');

  const query = `
WITH modelos AS (
  ${modelosSql}
),
${modelosNormCteSql_()},
estoque AS (
  SELECT
    sku,
    product_title,
    variant_title,
    SUM(available_total) AS estoque_atual,
    MAX(last_updated_at) AS updated_at
  FROM \`reise-ssot.mart_shared.inventory_sku_current\`
  WHERE sku IS NOT NULL AND TRIM(sku) != ''
  GROUP BY 1,2,3
),
itens_validos AS (
  SELECT
    CURRENT_DATE('America/Sao_Paulo') AS data,
    sku,
    COALESCE(NULLIF(TRIM(product_title), ''), NULLIF(TRIM(variant_title), ''), sku) AS item_name,
    product_title,
    variant_title,
    estoque_atual,
    updated_at,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(product_title, ''), ' ', COALESCE(variant_title, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(sku, ''), ' ', COALESCE(product_title, ''), ' ', COALESCE(variant_title, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM estoque
),
vendas_d30 AS (
  SELECT
    NULLIF(TRIM(CAST(sku AS STRING)), '') AS sku,
    SUM(SAFE_CAST(quantity AS INT64)) AS vendas_d30
  FROM \`reise-ssot.mart_shared.fct_order_item\`
  WHERE is_valid_order = TRUE
    AND order_partition_date_brt >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
    AND order_partition_date_brt <= CURRENT_DATE('America/Sao_Paulo')
    AND NULLIF(TRIM(CAST(sku AS STRING)), '') IS NOT NULL
    AND SAFE_CAST(quantity AS INT64) > 0
  GROUP BY 1
),
${itensClassificadosV1CteSql_({ usarJanelaD0: false, partitionBy: 'sku' })}
SELECT
  c.modelo_id,
  COALESCE(NULLIF(c.product_title, ''), c.sku) AS sub_modelo,
  c.variant_title AS cor,
  SUM(c.estoque_atual) AS estoque_atual,
  SUM(IFNULL(v.vendas_d30, 0)) AS vendas_d30,
  SAFE_DIVIDE(CAST(SUM(c.estoque_atual) AS FLOAT64), SAFE_DIVIDE(CAST(SUM(IFNULL(v.vendas_d30, 0)) AS FLOAT64), 30.0)) AS cobertura_dias,
  MAX(c.updated_at) AS updated_at
FROM itens_classificados_v1 c
LEFT JOIN vendas_d30 v
  ON UPPER(TRIM(v.sku)) = UPPER(TRIM(c.sku))
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
  Logger.log('exportarTudo: classificacao canonica em BigQuery por SKU/nome/cor, prioridade Monochrome > Series 2 > Phantom > GT > Avant > cadastro generico.');
  Logger.log(`exportarTudo: linhas por modelo = ${JSON.stringify(byModelo)}`);
  Logger.log(`exportarTudo: linhas por origem = ${JSON.stringify(byOrigem)}`);

  modelos.forEach(modelo => {
    Logger.log(`modelo ${modelo.modelo_id}: d0=${modelo.day_zero_base}; termos_busca=${modelo.termos_busca || ''}; sku_prefixos=${modelo.sku_prefixos || ''}`);
    const rows = produtosDia.filter(row => row.modelo_id === modelo.modelo_id);
    const receita = rows.reduce((acc, row) => acc + Number(row.receita || 0), 0);
    const pares = rows.reduce((acc, row) => acc + Number(row.pares || 0), 0);
    Logger.log(`modelo ${modelo.modelo_id}: ${rows.length} linhas, receita=${receita}, pares=${pares}.`);
    if (!rows.length) Logger.log(`modelo ${modelo.modelo_id}: sem linhas no match final. Verifique BigQuery, termos_busca, sku_prefixos e exportacao.`);
  });
}

function runBq_(query, location) {
  const jobLocation = location || CONFIG.bqLocation;
  const request = { query, useLegacySql: false, location: jobLocation };
  let job = BigQuery.Jobs.query(request, CONFIG.bqProjectId);
  const jobId = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(500);
    job = BigQuery.Jobs.getQueryResults(CONFIG.bqProjectId, jobId, { location: jobLocation });
  }
  if (job.errors && job.errors.length) {
    throw new Error(`BigQuery retornou erro: ${JSON.stringify(job.errors.slice(0, 3))}`);
  }
  if (!job.schema || !job.schema.fields || !job.schema.fields.length) return [];
  const schema = job.schema.fields.map(f => f.name);
  const rows = [];
  let pageToken;
  do {
    const page = BigQuery.Jobs.getQueryResults(CONFIG.bqProjectId, jobId, { location: jobLocation, pageToken });
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
    if (!modelo.data_lancamento) missing.push('data_lancamento');
    if (!modelo.day_zero_base) missing.push('day_zero_base');
    if (!modelo.termos_busca && !modelo.sku_prefixos) missing.push('termos_busca/sku_prefixos');
    if (!modelo.status) missing.push('status');

    if (missing.length) {
      Logger.log(`lancamentos_modelos.json item ${index + 1}: campos ausentes = ${missing.join(', ')}`);
    }

    const bloqueantes = ['modelo_id', 'modelo', 'data_lancamento', 'day_zero_base', 'status'];
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

function sincronizarCadastroBigQuery_(modelos) {
  const rows = (modelos || []).map((modelo, index) => {
    const modeloId = String(modelo.modelo_id || '').trim();
    const linha = String(modelo.linha || modelo.modelo || '').trim();
    const dataLancamento = dateIso_(modelo.data_lancamento);
    const dayZeroBase = dateIso_(modelo.day_zero_base);

    if (!modeloId || !linha || !dataLancamento || !dayZeroBase) {
      throw new Error(`lancamentos_modelos.json item ${index + 1}: modelo_id, linha, data_lancamento e day_zero_base sao obrigatorios para sincronizar mart_shared.linha_cadastro.`);
    }

    return { modeloId, linha, dataLancamento, dayZeroBase };
  });

  if (!rows.length) {
    throw new Error('Nenhum modelo valido para sincronizar em mart_shared.linha_cadastro.');
  }

  const sourceSql = rows.map(row =>
    `SELECT '${sql_(row.modeloId)}' AS modelo_id, '${sql_(row.linha)}' AS linha, DATE('${sql_(row.dataLancamento)}') AS data_lancamento, DATE('${sql_(row.dayZeroBase)}') AS day_zero_base`
  ).join('\nUNION ALL\n');

  const query = `
CREATE TABLE IF NOT EXISTS \`reise-ssot.mart_shared.linha_cadastro\` (
  modelo_id STRING,
  linha STRING,
  data_lancamento DATE,
  day_zero_base DATE
);

ALTER TABLE \`reise-ssot.mart_shared.linha_cadastro\`
ADD COLUMN IF NOT EXISTS day_zero_base DATE;

MERGE \`reise-ssot.mart_shared.linha_cadastro\` T
USING (
  ${sourceSql}
) S
ON T.modelo_id = S.modelo_id
WHEN MATCHED THEN
  UPDATE SET linha = S.linha, data_lancamento = S.data_lancamento, day_zero_base = S.day_zero_base
WHEN NOT MATCHED THEN
  INSERT (modelo_id, linha, data_lancamento, day_zero_base)
  VALUES (S.modelo_id, S.linha, S.data_lancamento, S.day_zero_base);`;

  runBq_(query);
  Logger.log(`mart_shared.linha_cadastro sincronizada com ${rows.length} modelos.`);
  return { status: 'synced', rows: rows.length };
}

function consultarTabelasMartShared_(tableNames) {
  const names = (tableNames || [])
    .map(name => String(name || '').trim())
    .filter(Boolean);
  if (!names.length) return [];

  const namesSql = names.map(name => `'${sql_(name)}'`).join(', ');
  const query = `
SELECT table_name
FROM \`${CONFIG.bqProjectId}.mart_shared.INFORMATION_SCHEMA.TABLES\`
WHERE table_name IN (${namesSql})
ORDER BY table_name`;

  return runBq_(query).map(row => String(row.table_name || '').trim()).filter(Boolean);
}

function tabelaMartSharedExiste_(tableName) {
  const alvo = String(tableName || '').trim();
  if (!alvo) return false;
  return consultarTabelasMartShared_([alvo]).includes(alvo);
}

function colunaMartSharedExiste_(tableName, columnName) {
  const tabela = String(tableName || '').trim();
  const coluna = String(columnName || '').trim();
  if (!tabela || !coluna) return false;
  const query = `
SELECT column_name
FROM \`${CONFIG.bqProjectId}.mart_shared.INFORMATION_SCHEMA.COLUMNS\`
WHERE table_name = ${sqlString_(tabela)}
  AND column_name = ${sqlString_(coluna)}
LIMIT 1`;
  return runBq_(query).length > 0;
}

function canalAtribuicaoMirrorBounds_(modelos) {
  const windows = (modelos || [])
    .map(modelo => ({
      modeloId: modelo.modelo_id || null,
      minDate: dateIsoKey_(modelo.day_zero_base),
      maxDate: addDaysIso_(dateIsoKey_(modelo.day_zero_base), 90)
    }))
    .filter(window => window.minDate && window.maxDate)
    .sort((a, b) => a.minDate.localeCompare(b.minDate));
  const d0s = windows.map(window => window.minDate);
  if (!d0s.length) return null;
  return {
    minDate: d0s[0],
    maxDate: windows.reduce((maxDate, window) => window.maxDate > maxDate ? window.maxDate : maxDate, windows[0].maxDate),
    windows
  };
}

function sincronizarCanalAtribuicaoMirrorSePossivel_(modelos) {
  if (!CONFIG.canalAttributionEnabled) {
    return { status: 'disabled', rows: 'skipped' };
  }
  const usarMirrorLastClick = true;
  if (!usarMirrorLastClick) {
    return {
      status: 'not_used',
      rows: 'skipped',
      attribution_source: 'core_order_origin_fields',
      rule: 'paid_se_sinal_de_midia_paga_senao_organic'
    };
  }
  const bounds = canalAtribuicaoMirrorBounds_(modelos);
  if (!bounds) {
    Logger.log('canal_atribuicao_pedido_mirror: sem modelos exportaveis para sincronizar.');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    garantirTabelaCanalAtribuicaoMirror_();
    const rows = consultarCanalAtribuicaoMirrorUs_(bounds);
    limparCanalAtribuicaoMirror_(bounds);
    if (rows.length) inserirCanalAtribuicaoMirror_(rows);
    const sourceCounts = rows.reduce((acc, row) => {
      const key = row.regra_atribuicao_real || 'sem_regra';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const paidRows = rows.filter(row => row.tipo === 'paid').length;
    const organicRows = rows.filter(row => row.tipo === 'organic').length;
    Logger.log(`canal_atribuicao_pedido_mirror sincronizada: ${rows.length} pedidos; paid=${paidRows}; organic=${organicRows}; fontes=${JSON.stringify(sourceCounts)}.`);
    return {
      status: 'synced',
      rows: rows.length,
      paid_rows: paidRows,
      organic_rows: organicRows,
      source_counts: sourceCounts,
      range: `${bounds.minDate}..${bounds.maxDate}`
    };
  } catch (error) {
    Logger.log(`canal_atribuicao_pedido_mirror nao sincronizada; export segue com tabela existente/fallback. Erro: ${error.message}`);
    return { status: 'failed', rows: 'skipped', error: error.message, error_summary: error.message };
  }
}

function consultarCanalAtribuicaoMirrorUs_(bounds) {
  const minDateSql = sqlString_(bounds.minDate);
  const maxDateSql = sqlString_(bounds.maxDate);
  const windows = (bounds.windows || [{ minDate: bounds.minDate, maxDate: bounds.maxDate }])
    .filter(window => window.minDate && window.maxDate);
  const windowsSql = windows.map(window => (
    `SELECT DATE(${sqlString_(window.minDate)}) AS data_inicio, DATE(${sqlString_(window.maxDate)}) AS data_fim`
  )).join('\nUNION ALL\n');
  const query = `
WITH
janelas AS (
  ${windowsSql}
),
orders AS (
  SELECT
    NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), '') AS email_norm,
    b.paid_date_brt,
    ROUND(SAFE_CAST(b.total_amount AS NUMERIC), 2) AS total_amount,
    NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(b.order_name AS STRING))), '') AS order_name,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_source_description'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referring_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referringChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.marketing_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.marketingChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.order_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.orderChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.Channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.chanel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.canal'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.origem'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landingSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site_ref'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referring_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referringSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_url'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceUrl')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS direct_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utmSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.traffic_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.acquisition_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last[_ -]?)?utm[_ -]?source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last)?utmsource"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_source(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'(?:utm_source|utm%5fsource)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS direct_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utmMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.ga_session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.gaSessionMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.traffic_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.acquisition_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.medium'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last[_ -]?)?utm[_ -]?medium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last)?utmmedium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"medium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_medium(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'(?:utm_medium|utm%5fmedium)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS direct_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.utmCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.ga_session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.gaSessionCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.campaign_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.campaignName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.campaign'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last[_ -]?)?utm[_ -]?campaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"(?:last)?utmcampaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'"campaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_campaign(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(b)), r'(?:utm_campaign|utm%5fcampaign)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS direct_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.last_source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.sourceType'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.channel_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(b), '$.channelType')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS direct_source_type,
    COUNT(*) OVER (
      PARTITION BY
        NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), ''),
        b.paid_date_brt,
        ROUND(SAFE_CAST(b.total_amount AS NUMERIC), 2)
    ) AS pedidos_na_chave
  FROM \`${CONFIG.bqProjectId}.mart_growth_us.bridge_orders_customers\` b
  WHERE b.paid_date_brt BETWEEN DATE(${minDateSql}) AND DATE(${maxDateSql})
    AND EXISTS (
      SELECT 1
      FROM janelas janela
      WHERE b.paid_date_brt BETWEEN janela.data_inicio AND janela.data_fim
    )
    AND b.total_amount IS NOT NULL
    AND (
      NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), '') IS NOT NULL
      OR NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') IS NOT NULL
      OR NULLIF(LOWER(TRIM(CAST(b.order_name AS STRING))), '') IS NOT NULL
    )
),
journey AS (
  SELECT
    order_id,
    order_name,
    last_source,
    last_source_description,
    last_source_type,
    last_utm_source,
    last_utm_medium,
    last_utm_campaign
  FROM \`${CONFIG.bqProjectId}.mart_growth_us.shopify__orders_journey_latest_v\`
),
joined AS (
  SELECT
    o.email_norm,
    o.paid_date_brt,
    o.total_amount,
    o.order_name,
    j.last_source,
    j.last_source_description,
    j.last_source_type,
    j.last_utm_source,
    j.last_utm_medium,
    j.last_utm_campaign,
    o.source_order_id,
    o.pedidos_na_chave,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_source_description, j.last_source, o.direct_channel]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_medium, o.direct_medium]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_source, j.last_source, o.direct_source]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_campaign, o.direct_campaign]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_source_type, o.direct_source_type]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type,
    CASE
      WHEN j.order_id IS NOT NULL THEN 'shopify_customer_journey_last_click'
      WHEN o.direct_channel IS NOT NULL OR o.direct_source IS NOT NULL OR o.direct_medium IS NOT NULL THEN 'bridge_order_origin_fields'
      ELSE 'sem_utm_organico'
    END AS origem_atribuicao
  FROM orders o
  LEFT JOIN journey j
    ON (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_id, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_id), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(o.source_order_id, '')), r'[^a-z0-9]+', '')
    )
    OR (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_name, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_name), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(o.order_name, '')), r'[^a-z0-9]+', '')
    )
),
normalized AS (
  SELECT
    *,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\\p{M}', '') AS raw_channel_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source, ''), NFD), r'\\p{M}', '') AS raw_source_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\\p{M}', '') AS raw_medium_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_campaign, ''), NFD), r'\\p{M}', '') AS raw_campaign_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source_type, ''), NFD), r'\\p{M}', '') AS raw_source_type_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(raw_channel, ''), ' ',
        COALESCE(raw_source, ''), ' ',
        COALESCE(raw_medium, ''), ' ',
        COALESCE(raw_campaign, ''), ' ',
        COALESCE(raw_source_type, '')
      ), NFD),
      r'\\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match
  FROM joined
),
classified AS (
  SELECT
    email_norm,
    paid_date_brt,
    total_amount,
    source_order_id,
    order_name,
    COALESCE(NULLIF(TRIM(CAST(last_utm_source AS STRING)), ''), raw_source) AS utm_source,
    COALESCE(NULLIF(TRIM(CAST(last_utm_medium AS STRING)), ''), raw_medium) AS utm_medium,
    COALESCE(NULLIF(TRIM(CAST(last_utm_campaign AS STRING)), ''), raw_campaign) AS utm_campaign,
    raw_channel,
    raw_medium,
    raw_source,
    pedidos_na_chave,
    origem_atribuicao,
    CASE
      WHEN origem_match = ''
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|unattributed|unknown|referral|linktr|ga4)')
        THEN 'Unattributed'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads)( |$)') THEN 'Meta'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)') THEN 'Google Ads'
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)') THEN 'Midia paga'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(crm|email|newsletter|klaviyo|rdstation|rd station|sms|whatsapp|disparo)( |$)') THEN 'CRM / Organico'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(instagram|facebook)') THEN 'Organic Social'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(google|bing|yahoo|duckduckgo|brave)') THEN 'Organic Search'
      WHEN raw_source_type_match = 'direct' OR raw_channel_match IN ('direct', '(direct)') THEN 'Direct'
      WHEN raw_channel LIKE '%whatsapp%' THEN 'Whatsapp'
      WHEN raw_channel LIKE '%tiktok%' THEN 'Tiktok'
      WHEN raw_channel LIKE '%youtube%' THEN 'Youtube'
      WHEN raw_channel LIKE '%linktr%' THEN 'Linktr.Ee'
      WHEN raw_channel LIKE '%unknown%' THEN 'An Unknown Source'
      WHEN raw_channel IS NULL OR raw_channel = '' THEN 'Unattributed'
      ELSE INITCAP(raw_channel)
    END AS canal,
    CASE
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'paid'
      WHEN origem_match = ''
        OR REGEXP_CONTAINS(origem_match, r'(^| )(unattributed|unknown|an unknown source|not set)( |$)')
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|referral|linktr|ga4)')
        THEN 'organic'
      ELSE 'organic'
    END AS tipo
  FROM normalized
)
SELECT
  email_norm,
  paid_date_brt,
  total_amount,
  source_order_id,
  order_name,
  canal,
  tipo,
  CASE
    WHEN tipo = 'paid' THEN 'Midia paga'
    ELSE 'Organico'
  END AS grupo_canal,
  utm_source,
  utm_medium,
  utm_campaign,
  raw_channel,
  raw_medium,
  raw_source,
  pedidos_na_chave,
  origem_atribuicao AS regra_atribuicao_real
FROM classified
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY COALESCE(source_order_id, order_name, CONCAT(email_norm, '|', CAST(paid_date_brt AS STRING), '|', CAST(total_amount AS STRING)))
  ORDER BY
    CASE tipo
      WHEN 'paid' THEN 1
      WHEN 'organic' THEN 2
      ELSE 99
    END,
    canal
) = 1`;

  return runBq_(query, CONFIG.bqUsLocation).map(row => ({
    email_norm: row.email_norm || null,
    paid_date_brt: dateIsoKey_(row.paid_date_brt),
    total_amount: numberOrNull_(row.total_amount),
    source_order_id: row.source_order_id || null,
    order_name: row.order_name || null,
    canal: row.canal || null,
    tipo: row.tipo || null,
    grupo_canal: row.grupo_canal || null,
    utm_source: row.utm_source || null,
    utm_medium: row.utm_medium || null,
    utm_campaign: row.utm_campaign || null,
    raw_channel: row.raw_channel || null,
    raw_medium: row.raw_medium || null,
    raw_source: row.raw_source || null,
    pedidos_na_chave: numberOrNull_(row.pedidos_na_chave),
    regra_atribuicao_real: row.regra_atribuicao_real || 'sem_utm_organico'
  })).filter(row => row.paid_date_brt && row.total_amount !== null && (row.source_order_id || row.order_name || row.email_norm));
}

function garantirTabelaCanalAtribuicaoMirror_() {
  const query = `
CREATE TABLE IF NOT EXISTS \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\` (
  email_norm STRING,
  paid_date_brt DATE,
  total_amount NUMERIC,
  source_order_id STRING,
  order_name STRING,
  canal STRING,
  tipo STRING,
  grupo_canal STRING,
  utm_source STRING,
  utm_medium STRING,
  utm_campaign STRING,
  raw_channel STRING,
  raw_medium STRING,
  raw_source STRING,
  pedidos_na_chave INT64,
  regra_atribuicao_real STRING
)
PARTITION BY paid_date_brt
CLUSTER BY email_norm, total_amount`;
  runBq_(query);
  runBq_(`ALTER TABLE \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\` ADD COLUMN IF NOT EXISTS source_order_id STRING`);
  runBq_(`ALTER TABLE \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\` ADD COLUMN IF NOT EXISTS order_name STRING`);
}

function limparCanalAtribuicaoMirror_(bounds) {
  const windows = (bounds.windows || [{ minDate: bounds.minDate, maxDate: bounds.maxDate }])
    .filter(window => window.minDate && window.maxDate);
  const predicate = windows.map(window => (
    `(paid_date_brt BETWEEN DATE(${sqlString_(window.minDate)}) AND DATE(${sqlString_(window.maxDate)}))`
  )).join('\n  OR ');
  const query = `
DELETE FROM \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\`
WHERE ${predicate}`;
  runBq_(query);
}

function inserirCanalAtribuicaoMirror_(rows) {
  const datasetId = 'mart_shared';
  const tableId = 'canal_atribuicao_pedido_mirror';
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const request = {
      kind: 'bigquery#tableDataInsertAllRequest',
      skipInvalidRows: false,
      ignoreUnknownValues: false,
      rows: chunk.map(row => ({
        insertId: [
          row.source_order_id || '',
          row.order_name || '',
          row.email_norm,
          row.paid_date_brt,
          row.total_amount,
          row.tipo || '',
          row.canal || ''
        ].join('|'),
        json: row
      }))
    };
    const response = BigQuery.Tabledata.insertAll(request, CONFIG.bqProjectId, datasetId, tableId);
    if (response.insertErrors && response.insertErrors.length) {
      throw new Error(`BigQuery insertAll canal_atribuicao_pedido_mirror falhou: ${JSON.stringify(response.insertErrors.slice(0, 3))}`);
    }
  }
}

function canalAtribuicaoPedidoCteSql_(usarMirror, usarSourceOrderMirror, usarOrderNameMirror) {
  const sourceOrderMatchSql = usarSourceOrderMirror
    ? `      WHEN canal_real.source_order_id IS NOT NULL THEN CONCAT('source_order_id:', canal_real.source_order_id)\n`
    : '';
  const orderNameMatchSql = usarOrderNameMirror
    ? `      WHEN canal_real.order_name IS NOT NULL THEN CONCAT('order_name:', canal_real.order_name)\n`
    : '';
  const sourceOrderJoinSql = usarSourceOrderMirror
    ? `    (
      canal_real.source_order_id IS NOT NULL
      AND canal_real.source_order_id = NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '')
    )
    OR `
    : '';
  const orderNameJoinSql = usarOrderNameMirror
    ? `    (
      canal_real.order_name IS NOT NULL
      AND canal_real.order_name = NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '')
    )
    OR `
    : '';
  const mirrorMatchKeySql = usarMirror ? `CASE
${sourceOrderMatchSql}${orderNameMatchSql}      WHEN canal_real.email_norm IS NULL THEN CAST(NULL AS STRING)
      ELSE CONCAT(canal_real.email_norm, '|', CAST(canal_real.paid_date_brt AS STRING), '|', CAST(canal_real.total_amount AS STRING))
    END AS match_key_mirror,` : `CAST(NULL AS STRING) AS match_key_mirror,`;
  const mirrorSelectSql = usarMirror ? `canal_real.canal AS canal_mirror,
    CASE
      WHEN canal_real.tipo IS NULL THEN CAST(NULL AS STRING)
      WHEN canal_real.tipo = 'paid' THEN 'paid'
      ELSE 'organic'
    END AS tipo_mirror,
    canal_real.regra_atribuicao_real AS regra_mirror,
    ${mirrorMatchKeySql}` : `CAST(NULL AS STRING) AS canal_mirror,
    CAST(NULL AS STRING) AS tipo_mirror,
    CAST(NULL AS STRING) AS regra_mirror,
    CAST(NULL AS STRING) AS match_key_mirror,`;
  const mirrorJoinSql = usarMirror ? `  LEFT JOIN \`${CONFIG.bqProjectId}.mart_shared.canal_atribuicao_pedido_mirror\` canal_real
    ON ${sourceOrderJoinSql}${orderNameJoinSql}(
      canal_real.email_norm = NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '')
      AND canal_real.paid_date_brt = DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo')
      AND canal_real.total_amount = ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2)
    )` : '';

  return `pedido_atribuicao_raw AS (
  SELECT
    CAST(o.order_sk AS STRING) AS order_sk,
    ${mirrorSelectSql}
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source_description'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.marketing_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.marketingChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.order_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.orderChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.Channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.chanel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.canal'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.origem'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.traffic_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.acquisition_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last[_ -]?)?utm[_ -]?source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last)?utmsource"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_source(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'(?:utm_source|utm%5fsource)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.traffic_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.acquisition_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.medium'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last[_ -]?)?utm[_ -]?medium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last)?utmmedium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"medium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_medium(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'(?:utm_medium|utm%5fmedium)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaign_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaignName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaign'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last[_ -]?)?utm[_ -]?campaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"(?:last)?utmcampaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'"campaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_campaign(?:=|%3d)([^&#% ]+)'),
      REGEXP_EXTRACT(LOWER(TO_JSON_STRING(o)), r'(?:utm_campaign|utm%5fcampaign)(?:=|%3d)([^&#"\\ ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceType'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channel_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channelType')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type
  FROM \`${CONFIG.bqProjectId}.core.order\` o
${mirrorJoinSql}
  WHERE DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos_norm)
    AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND o.is_valid_order = TRUE
),
pedido_atribuicao_norm AS (
  SELECT
    *,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\\p{M}', '') AS raw_channel_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source, ''), NFD), r'\\p{M}', '') AS raw_source_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\\p{M}', '') AS raw_medium_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_campaign, ''), NFD), r'\\p{M}', '') AS raw_campaign_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source_type, ''), NFD), r'\\p{M}', '') AS raw_source_type_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(raw_channel, ''), ' ',
        COALESCE(raw_source, ''), ' ',
        COALESCE(raw_medium, ''), ' ',
        COALESCE(raw_campaign, ''), ' ',
        COALESCE(raw_source_type, '')
      ), NFD),
      r'\\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match
  FROM pedido_atribuicao_raw
),
pedido_atribuicao_classificada AS (
  SELECT
    *,
    CASE
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads)( |$)') THEN 'Meta'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)') THEN 'Google Ads'
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)') THEN 'Midia paga'
      WHEN origem_match = ''
        OR REGEXP_CONTAINS(origem_match, r'(^| )(unattributed|unknown|an unknown source|not set)( |$)')
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|referral|linktr|ga4)')
        THEN 'Organico'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(crm|email|newsletter|klaviyo|rdstation|rd station|sms|whatsapp|disparo)( |$)') THEN 'CRM / Organico'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(instagram|facebook)') THEN 'Organic Social'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(google|bing|yahoo|duckduckgo|brave)') THEN 'Organic Search'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )ga4( |$)') THEN 'GA4'
      WHEN raw_channel IS NOT NULL THEN INITCAP(raw_channel)
      WHEN raw_source IS NOT NULL THEN INITCAP(raw_source)
      ELSE 'Organico'
    END AS canal_origem_pedido,
    CASE
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'paid'
      WHEN origem_match = ''
        OR REGEXP_CONTAINS(origem_match, r'(^| )(unattributed|unknown|an unknown source|not set)( |$)')
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|referral|linktr|ga4)')
        THEN 'organic'
      ELSE 'organic'
    END AS tipo_origem_pedido
  FROM pedido_atribuicao_norm
),
pedido_atribuicao AS (
  SELECT
    order_sk,
    CASE
      WHEN tipo_mirror = 'paid' THEN canal_mirror
      WHEN tipo_origem_pedido = 'paid' THEN canal_origem_pedido
      ELSE COALESCE(canal_mirror, canal_origem_pedido)
    END AS canal_real,
    CASE
      WHEN tipo_mirror = 'paid' OR tipo_origem_pedido = 'paid' THEN 'paid'
      ELSE 'organic'
    END AS tipo_real,
    CASE
      WHEN tipo_mirror = 'paid' THEN COALESCE(regra_mirror, 'email_data_valor_last_click_mirror')
      WHEN tipo_origem_pedido = 'paid' THEN 'core_order_origin_fields'
      WHEN tipo_mirror IS NOT NULL THEN COALESCE(regra_mirror, 'email_data_valor_last_click_mirror')
      WHEN tipo_origem_pedido IS NOT NULL THEN 'core_order_origin_fields'
      ELSE CAST(NULL AS STRING)
    END AS regra_atribuicao_real,
    CASE
      WHEN tipo_mirror = 'paid' AND match_key_mirror IS NOT NULL THEN match_key_mirror
      WHEN tipo_origem_pedido = 'paid' THEN CONCAT('order_origin:', order_sk)
      WHEN match_key_mirror IS NOT NULL THEN match_key_mirror
      WHEN tipo_origem_pedido IS NOT NULL THEN CONCAT('order_origin:', order_sk)
      ELSE CAST(NULL AS STRING)
    END AS atribuicao_match_key
  FROM pedido_atribuicao_classificada
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_sk
    ORDER BY
      CASE WHEN tipo_mirror IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN tipo_mirror = 'paid' OR tipo_origem_pedido = 'paid' THEN 1 ELSE 2 END,
      COALESCE(canal_mirror, canal_origem_pedido)
  ) = 1
),`;
}

function canalAtribuicaoPedidoNullSelectSql_() {
  return `CAST(NULL AS STRING) AS canal_real,
    CAST(NULL AS STRING) AS tipo_real,
    CAST(NULL AS STRING) AS regra_atribuicao_real,
    CAST(NULL AS STRING) AS atribuicao_match_key,`;
}

function canalAtribuicaoPedidoSelectSql_() {
  return `pa.canal_real AS canal_real,
    pa.tipo_real AS tipo_real,
    pa.regra_atribuicao_real AS regra_atribuicao_real,
    pa.atribuicao_match_key AS atribuicao_match_key,`;
}

function canalAtribuicaoPedidoJoinSql_() {
  return `  LEFT JOIN pedido_atribuicao pa
    ON pa.order_sk = CAST(i.order_sk AS STRING)`;
}

function diagnosticarDependenciasShareTrajetoria_() {
  const existentes = consultarTabelasMartShared_(SHARE_TRAJETORIA_REQUIRED_TABLES);
  const existentesSet = {};
  existentes.forEach(name => existentesSet[name] = true);
  const ausentes = SHARE_TRAJETORIA_REQUIRED_TABLES.filter(name => !existentesSet[name]);
  const diagnostico = { existentes, ausentes };
  Logger.log(`share_trajetoria dependencias INFORMATION_SCHEMA=${JSON.stringify(diagnostico)}`);
  return diagnostico;
}

function garantirDependenciasShareTrajetoria_(diagnosticoInicial) {
  const antes = diagnosticoInicial || diagnosticarDependenciasShareTrajetoria_();
  const acoes = [];

  if ((antes.ausentes || []).includes('datas_sazonais')) {
    sincronizarDatasSazonaisBigQuery_();
    acoes.push('created_or_synced:datas_sazonais');
  }

  if ((antes.ausentes || []).includes('eventos_comerciais_produto')) {
    garantirEventosComerciaisProdutoBigQuery_();
    acoes.push('created:eventos_comerciais_produto');
  }

  const depois = diagnosticarDependenciasShareTrajetoria_();
  if ((depois.ausentes || []).length) {
    throw new Error(`Dependencias share_trajetoria ainda ausentes apos tentativa de criacao: ${depois.ausentes.join(', ')}`);
  }

  return { status: 'ready', antes, depois, acoes };
}

function sincronizarDatasSazonaisSeDisponivel_() {
  try {
    return sincronizarDatasSazonaisBigQuery_();
  } catch (error) {
    Logger.log(`mart_shared.datas_sazonais nao sincronizada. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
}

function sincronizarDatasSazonaisBigQuery_() {
  const eventos = [
    { data: '2025-06-12', evento: 'Dia dos Namorados' },
    { data: '2025-08-10', evento: 'Dia dos Pais' },
    { data: '2025-11-28', evento: 'Black Friday' },
    { data: '2025-12-25', evento: 'Natal' },
    { data: '2026-06-12', evento: 'Dia dos Namorados' },
    { data: '2026-08-09', evento: 'Dia dos Pais' },
    { data: '2026-11-27', evento: 'Black Friday' },
    { data: '2026-12-25', evento: 'Natal' }
  ];

  const sourceSql = eventos.map(row =>
    `SELECT DATE('${sql_(row.data)}') AS data, '${sql_(row.evento)}' AS evento`
  ).join('\nUNION ALL\n');

  const query = `
CREATE TABLE IF NOT EXISTS \`reise-ssot.mart_shared.datas_sazonais\` (
  data DATE,
  evento STRING
);

MERGE \`reise-ssot.mart_shared.datas_sazonais\` T
USING (
  ${sourceSql}
) S
ON T.data = S.data AND T.evento = S.evento
WHEN NOT MATCHED THEN
  INSERT (data, evento)
  VALUES (S.data, S.evento);`;

  runBq_(query);
  Logger.log(`mart_shared.datas_sazonais sincronizada com ${eventos.length} eventos.`);
  return { status: 'synced', rows: eventos.length };
}

function garantirEventosComerciaisProdutoSeDisponivel_() {
  try {
    return garantirEventosComerciaisProdutoBigQuery_();
  } catch (error) {
    Logger.log(`mart_shared.eventos_comerciais_produto nao garantida. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
}

function garantirEventosComerciaisProdutoBigQuery_() {
  const query = `
CREATE TABLE IF NOT EXISTS \`reise-ssot.mart_shared.eventos_comerciais_produto\` (
  modelo_id STRING,
  data_inicio DATE,
  data_fim DATE,
  tipo STRING,
  descricao STRING,
  registrado_por STRING,
  registrado_em TIMESTAMP
);`;

  runBq_(query);
  Logger.log('mart_shared.eventos_comerciais_produto garantida para cadastro manual.');
  return { status: 'ready', rows: 'manual' };
}

function lerJsonGitHub_(path) {
  validarGithubConfig_();
  const token = getProp_('GITHUB_TOKEN', '');

  const repoPath = githubDataPath_(path);
  const api = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${repoPath}`;
  const url = `${api}?ref=${encodeURIComponent(CONFIG.githubBranch)}`;
  let response = urlFetchComRetry_(url, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  }, `GitHub GET ${repoPath}`);

  let code = response.getResponseCode();
  let body = response.getContentText();
  if ([401, 403, 404].includes(code)) {
    const publicResponse = urlFetchComRetry_(url, {
      method: 'get',
      headers: githubHeaders_(''),
      muteHttpExceptions: true
    }, `GitHub GET publico ${repoPath}`);
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

function exportarEstoqueSeDisponivel_(modelos) {
  if (!modelos.length) {
    Logger.log('Sem modelos exportaveis com day_zero_base valido; estoque nao consultado.');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const estoque = consultarEstoque_(modelos);
    escreverJsonGitHub_('estoque.json', estoque);
    Logger.log(`estoque.json exportado com ${estoque.length} linhas.`);
    return { status: 'exported', rows: estoque.length };
  } catch (error) {
    Logger.log(`Estoque nao exportado; mantendo estoque.json atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message };
  }
}

function exportarShareTrajetoriaSeDisponivel_(modelos) {
  if (!modelos.length) {
    Logger.log('Sem modelos exportaveis com day_zero_base valido; share_trajetoria nao consultado.');
    return { status: 'skipped', rows: 'skipped' };
  }

  try {
    const dependencias = garantirDependenciasShareTrajetoria_();
    Logger.log(`share_trajetoria dependencias prontas: ${JSON.stringify(dependencias)}`);
    const share = consultarShareTrajetoria_(modelos);
    escreverJsonGitHub_('share_trajetoria.json', share.payload);
    Logger.log(`share_trajetoria.json exportado com ${share.rows} pontos para ${Object.keys(share.payload.modelos).length} modelos.`);
    return { status: 'exported', rows: share.rows, dependencies: dependencias, payload: share.payload };
  } catch (error) {
    const resumoErro = resumirErro_(error);
    Logger.log(`share_trajetoria.json nao exportado; mantendo arquivo atual. Erro: ${resumoErro}`);
    return { status: 'failed', rows: 'failed', error: error.message, error_summary: resumoErro };
  }
}

function consultarShareTrajetoria_(modelos) {
  const modelosSql = modelos.map(m => {
    const termosRegex = termosRegex_(m);
    const skuPrefixos = skuPrefixos_(m);
    const d0 = sql_(m.day_zero_base);
    return `SELECT '${sql_(m.modelo_id)}' AS modelo_id, '${sql_(m.modelo)}' AS modelo, '${sql_(m.linha || m.modelo)}' AS linha, DATE('${d0}') AS d0, '${sql_(termosRegex)}' AS termos_busca, '${sql_(skuPrefixos)}' AS sku_prefixos`;
  }).join('\nUNION ALL\n');

  const query = `
WITH modelos AS (
  ${modelosSql}
),
${modelosNormCteSql_()},
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
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, ''), ' ', COALESCE(pl_match.cor, '')), NFD), r'\\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor
    FROM \`reise-ssot.mart_shared.produto_lancamento_v\`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl_match
    ON pl_match.sku_key = UPPER(TRIM(i.sku))
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos_norm)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
    AND SAFE_CAST(i.line_gross_amount AS NUMERIC) > 0
),
${itensClassificadosV1CteSql_({ partitionBy: 'order_sk, line_item_key' })},
receita_produto_dia AS (
  SELECT
    modelo_id,
    data,
    SUM(receita_bruta) AS receita_produto
  FROM itens_classificados_v1
  WHERE modelo_id IS NOT NULL
  GROUP BY 1, 2
),
receita_empresa_dia AS (
  SELECT
    i.order_partition_date_brt AS data,
    SUM(SAFE_CAST(i.line_gross_amount AS NUMERIC)) AS receita_empresa,
    COUNT(DISTINCT CAST(i.order_sk AS STRING)) AS pedidos_empresa,
    'fct_order_item_valid_orders' AS regra_receita_empresa
  FROM \`reise-ssot.mart_shared.fct_order_item\` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= DATE_SUB((SELECT MIN(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
    AND SAFE_CAST(i.line_gross_amount AS NUMERIC) > 0
  GROUP BY 1
),
datas_modelo AS (
  SELECT
    m.modelo_id,
    COALESCE(NULLIF(m.linha, ''), m.modelo, m.modelo_id) AS linha,
    m.d0 AS day_zero_base,
    m.d0 AS data_lancamento,
    day AS dias_desde_lancamento,
    DATE_ADD(m.d0, INTERVAL day DAY) AS data_calendario
  FROM modelos_norm m,
  UNNEST(GENERATE_ARRAY(0, 90)) AS day
  WHERE DATE_ADD(m.d0, INTERVAL day DAY) < CURRENT_DATE('America/Sao_Paulo')
),
eventos_comerciais_cadastro AS (
  SELECT
    modelo_id,
    COUNT(*) AS eventos_comerciais_cadastrados
  FROM \`reise-ssot.mart_shared.eventos_comerciais_produto\`
  WHERE modelo_id IN (SELECT modelo_id FROM modelos_norm)
  GROUP BY modelo_id
),
eventos_comerciais_ponto AS (
  SELECT
    d.modelo_id,
    d.data_calendario,
    ARRAY_AGG(STRUCT(
      e.tipo AS tipo,
      e.descricao AS descricao
    ) ORDER BY e.data_inicio, e.tipo LIMIT 1)[SAFE_OFFSET(0)] AS evento
  FROM datas_modelo d
  JOIN \`reise-ssot.mart_shared.eventos_comerciais_produto\` e
    ON e.modelo_id = d.modelo_id
   AND d.data_calendario BETWEEN e.data_inicio AND COALESCE(e.data_fim, e.data_inicio)
  GROUP BY d.modelo_id, d.data_calendario
),
base AS (
  SELECT
    d.modelo_id,
    d.linha,
    d.day_zero_base,
    d.data_lancamento,
    d.dias_desde_lancamento,
    d.data_calendario,
    COALESCE(rp.receita_produto, 0) AS receita_produto,
    re.receita_empresa,
    re.pedidos_empresa,
    re.regra_receita_empresa,
    SAFE_DIVIDE(COALESCE(rp.receita_produto, 0), re.receita_empresa) AS share_do_dia,
    SAFE_DIVIDE(
      SUM(COALESCE(rp.receita_produto, 0)) OVER (
        PARTITION BY d.modelo_id
        ORDER BY d.dias_desde_lancamento
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ),
      SUM(re.receita_empresa) OVER (
        PARTITION BY d.modelo_id
        ORDER BY d.dias_desde_lancamento
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    ) AS share_acumulado_ate_o_dia,
    s.evento AS evento_sazonal,
    ec.evento.tipo AS evento_comercial_tipo,
    ec.evento.descricao AS evento_comercial_descricao
  FROM datas_modelo d
  JOIN receita_empresa_dia re
    ON re.data = d.data_calendario
  LEFT JOIN receita_produto_dia rp
    ON rp.modelo_id = d.modelo_id
   AND rp.data = d.data_calendario
  LEFT JOIN \`reise-ssot.mart_shared.datas_sazonais\` s
    ON s.data = d.data_calendario
  LEFT JOIN eventos_comerciais_ponto ec
    ON ec.modelo_id = d.modelo_id
   AND ec.data_calendario = d.data_calendario
),
janela_pos AS (
  SELECT
    modelo_id,
    ANY_VALUE(day_zero_base) AS day_zero_base_janela,
    COUNT(DISTINCT data_calendario) AS dias_pos_disponiveis,
    SUM(receita_empresa) AS receita_empresa_pos_periodo
  FROM base
  GROUP BY modelo_id
),
janela_pre AS (
  SELECT
    p.modelo_id,
    SUM(re.receita_empresa) AS receita_empresa_pre_periodo
  FROM janela_pos p
  JOIN receita_empresa_dia re
    ON re.data BETWEEN DATE_SUB(p.day_zero_base_janela, INTERVAL p.dias_pos_disponiveis DAY)
                   AND DATE_SUB(p.day_zero_base_janela, INTERVAL 1 DAY)
  GROUP BY p.modelo_id
), sazonalidade_d0 AS (
  SELECT
    b.modelo_id,
    COUNTIF(s.data = b.day_zero_base) > 0 AS d0_coincide_com_sazonalidade
  FROM (SELECT DISTINCT modelo_id, day_zero_base FROM base) b
  LEFT JOIN \`reise-ssot.mart_shared.datas_sazonais\` s
    ON s.data = b.day_zero_base
  GROUP BY b.modelo_id
)
SELECT
  modelo_id,
  ANY_VALUE(linha) AS linha,
  CAST(ANY_VALUE(b.day_zero_base) AS STRING) AS day_zero_base,
  CAST(ANY_VALUE(b.data_lancamento) AS STRING) AS data_lancamento,
  MAX(dias_desde_lancamento) AS dias_disponiveis,
  90 AS janela_alvo_dias,
  ARRAY_AGG(share_acumulado_ate_o_dia IGNORE NULLS ORDER BY dias_desde_lancamento DESC LIMIT 1)[SAFE_OFFSET(0)] AS share_acumulado_atual,
  SUM(receita_produto) AS receita_lancamento_periodo,
  SAFE_DIVIDE(SUM(receita_empresa), SUM(pedidos_empresa)) AS ticket_medio_empresa_periodo,
  CAST(MAX(data_calendario) AS STRING) AS dado_ate,
  ANY_VALUE(jp.dias_pos_disponiveis) AS dias_pos_disponiveis,
  ANY_VALUE(jpre.receita_empresa_pre_periodo) AS receita_empresa_pre_periodo,
  ANY_VALUE(jp.receita_empresa_pos_periodo) AS receita_empresa_pos_periodo,
  SAFE_DIVIDE(
    ANY_VALUE(jp.receita_empresa_pos_periodo) - ANY_VALUE(jpre.receita_empresa_pre_periodo),
    ANY_VALUE(jpre.receita_empresa_pre_periodo)
  ) AS variacao_receita_empresa_pct,
  IFNULL(ANY_VALUE(ecm.eventos_comerciais_cadastrados), 0) AS eventos_comerciais_cadastrados,
  IFNULL(ANY_VALUE(s.d0_coincide_com_sazonalidade), FALSE) AS d0_coincide_com_sazonalidade,
  TO_JSON_STRING(ARRAY_AGG(STRUCT(
    dias_desde_lancamento,
    CAST(data_calendario AS STRING) AS data_calendario,
    receita_produto,
    receita_empresa,
    pedidos_empresa,
    share_do_dia,
    share_acumulado_ate_o_dia,
    regra_receita_empresa,
    evento_sazonal,
    evento_comercial_tipo,
    evento_comercial_descricao
  ) ORDER BY dias_desde_lancamento)) AS pontos_json
FROM base b
LEFT JOIN sazonalidade_d0 s USING (modelo_id)
LEFT JOIN janela_pos jp USING (modelo_id)
LEFT JOIN janela_pre jpre USING (modelo_id)
LEFT JOIN eventos_comerciais_cadastro ecm USING (modelo_id)
GROUP BY modelo_id
ORDER BY modelo_id`;

  const rows = runBq_(query);
  const generatedAt = Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  const payload = {
    generated_at: generatedAt,
    modelos: {}
  };
  let pointCount = 0;

  rows.forEach(row => {
    const pontos = JSON.parse(row.pontos_json || '[]').map(point => ({
      dias_desde_lancamento: Number(point.dias_desde_lancamento),
      data_calendario: point.data_calendario || null,
      receita_produto: numberOrNull_(point.receita_produto),
      receita_empresa: numberOrNull_(point.receita_empresa),
      pedidos_empresa: numberOrNull_(point.pedidos_empresa),
      share_do_dia: numberOrNull_(point.share_do_dia),
      share_acumulado_ate_o_dia: numberOrNull_(point.share_acumulado_ate_o_dia),
      regra_receita_empresa: point.regra_receita_empresa || null,
      evento_sazonal: point.evento_sazonal || null,
      evento_comercial_tipo: point.evento_comercial_tipo || null,
      evento_comercial_descricao: point.evento_comercial_descricao || null
    }));
    const diasDisponiveis = Number(row.dias_disponiveis || 0);
    const janelaAlvoDias = Number(row.janela_alvo_dias || 90);
    payload.modelos[row.modelo_id] = {
      linha: row.linha || row.modelo_id,
      day_zero_base: row.day_zero_base || null,
      data_lancamento: row.data_lancamento || null,
      janela_completa: diasDisponiveis >= janelaAlvoDias,
      dias_disponiveis: diasDisponiveis,
      janela_alvo_dias: janelaAlvoDias,
      share_acumulado_atual: numberOrNull_(row.share_acumulado_atual),
      receita_lancamento_periodo: numberOrNull_(row.receita_lancamento_periodo),
      ticket_medio_empresa_periodo: numberOrNull_(row.ticket_medio_empresa_periodo),
      dado_ate: row.dado_ate || null,
      dias_pos_disponiveis: numberOrNull_(row.dias_pos_disponiveis),
      receita_empresa_pre_periodo: numberOrNull_(row.receita_empresa_pre_periodo),
      receita_empresa_pos_periodo: numberOrNull_(row.receita_empresa_pos_periodo),
      variacao_receita_empresa_pct: numberOrNull_(row.variacao_receita_empresa_pct),
      eventos_comerciais_cadastrados: Number(row.eventos_comerciais_cadastrados || 0),
      d0_coincide_com_sazonalidade: booleanOrFalse_(row.d0_coincide_com_sazonalidade),
      pontos
    };
    pointCount += pontos.length;
  });

  return { payload, rows: pointCount };
}

function exportarMidiaPagaSeConfigurada_(modelos, shareTrajetoria) {
  const spreadsheetId = investmentSpreadsheetId_();
  if (!spreadsheetId) {
    Logger.log('Planilha de investimento nao configurada; mantendo midia_paga.json atual');
    return { status: 'skipped', rows: 'skipped', payload: [] };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('midia_paga');
    if (!sheet) {
      Logger.log('Aba midia_paga nao encontrada; mantendo midia_paga.json atual');
      return { status: 'skipped', rows: 'skipped', payload: [] };
    }

    const midia = calcularImpactoMidiaPaga_(normalizeMidiaPaga_(sheetToObjects_(sheet), modelos), shareTrajetoria);
    escreverJsonGitHub_('midia_paga.json', midia);
    Logger.log(`midia_paga.json exportado com ${midia.length} linhas.`);
    return { status: 'exported', rows: midia.length, payload: midia };
  } catch (error) {
    Logger.log(`midia_paga.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message, payload: [] };
  }
}

function exportarCrmSeConfigurado_(shareTrajetoria) {
  const spreadsheetId = investmentSpreadsheetId_();
  if (!spreadsheetId) {
    Logger.log('Planilha de investimento nao configurada; mantendo crm_disparos.json atual');
    return { status: 'skipped', rows: 'skipped', payload: [] };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('crm_disparos');
    if (!sheet) {
      Logger.log('Aba crm_disparos nao encontrada; mantendo crm_disparos.json atual');
      return { status: 'skipped', rows: 'skipped', payload: [] };
    }

    const crm = calcularImpactoCrmDisparos_(normalizeCrmDisparos_(sheetToObjects_(sheet)), shareTrajetoria);
    escreverJsonGitHub_('crm_disparos.json', crm);
    Logger.log(`crm_disparos.json exportado com ${crm.length} linhas.`);
    return { status: 'exported', rows: crm.length, payload: crm };
  } catch (error) {
    Logger.log(`crm_disparos.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message, payload: [] };
  }
}

function exportarMetasMensaisSeConfigurado_(modelos) {
  let baseRows = [];
  try {
    baseRows = carregarMetasMensaisBase_();
  } catch (error) {
    Logger.log(`metas_mensais base nao carregada; seguindo apenas com BigQuery se disponivel. Erro: ${error.message}`);
  }

  try {
    const rowsBq = consultarMetasMensaisBigQuery_(modelos);
    if (rowsBq.length) {
      const rows = mesclarMetasMensais_(baseRows, rowsBq);
      const payload = {
        generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        script_version: EXPORT_SCRIPT_VERSION,
        source: 'bigquery:mart_growth_us.dashboard_targets_header_raw,dashboard_targets_daily_raw,dashboard_targets_actual_daily_v,aquisicao_por_canal,sales_attributed_to_marketing_v',
        rows
      };
      escreverJsonGitHub_('metas_mensais.json', payload);
      Logger.log(`metas_mensais.json exportado com ${rows.length} linhas; ${rowsBq.length} vindas do BigQuery/targets.`);
      const diasComCanais = rows.reduce((acc, row) => acc + (row.daily || []).filter(day => (day.canais_venda || []).length || (day.canais_aquisicao || []).length).length, 0);
      const diasComVendasPorCanal = rows.reduce((acc, row) => acc + (row.daily || []).filter(day => (day.canais_venda || []).length).length, 0);
      Logger.log(`metas_mensais: canais diarios em ${diasComCanais} dias; vendas por canal em ${diasComVendasPorCanal} dias.`);
      return { status: 'exported', rows: rows.length, payload };
    }
    Logger.log('dashboard_targets publicados nao retornaram linhas; tentando fallback por planilha/GitHub.');
  } catch (error) {
    Logger.log(`metas_mensais BigQuery nao exportado; tentando fallback por planilha/GitHub. Erro: ${error.message}`);
  }

  const spreadsheetId = investmentSpreadsheetId_();
  if (!spreadsheetId) {
    if (baseRows.length) {
      const payload = {
        generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        source: 'github_existing',
        rows: baseRows
      };
      Logger.log(`Planilha de investimento nao configurada; mantendo metas_mensais.json atual com ${baseRows.length} linhas.`);
      return { status: 'skipped', rows: baseRows.length, payload };
    }
    Logger.log('Planilha de investimento nao configurada; mantendo metas_mensais.json atual');
    return { status: 'skipped', rows: 'skipped', payload: { generated_at: null, rows: [] } };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('metas_mensais');
    if (!sheet) {
      Logger.log('Aba metas_mensais nao encontrada; mantendo metas_mensais.json atual');
      return { status: 'skipped', rows: 'skipped', payload: { generated_at: null, rows: [] } };
    }

    const rows = normalizeMetasMensais_(sheetToObjects_(sheet));
    const payload = {
      generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      rows
    };
    escreverJsonGitHub_('metas_mensais.json', payload);
    Logger.log(`metas_mensais.json exportado com ${rows.length} linhas.`);
    return { status: 'exported', rows: rows.length, payload };
  } catch (error) {
    Logger.log(`metas_mensais.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message, payload: { generated_at: null, rows: [] } };
  }
}

function carregarMetasMensaisBase_() {
  let rows = [];
  const spreadsheetId = investmentSpreadsheetId_();
  if (spreadsheetId) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheetByName('metas_mensais');
      if (sheet) rows = normalizeMetasMensais_(sheetToObjects_(sheet));
    } catch (error) {
      Logger.log(`Nao consegui carregar metas_mensais da planilha opcional: ${error.message}`);
    }
  }

  try {
    const atual = lerJsonGitHub_('metas_mensais.json');
    return normalizeMetasMensaisPayload_(atual.rows || atual || []);
  } catch (error) {
    Logger.log(`Nao consegui carregar metas_mensais.json atual do GitHub: ${error.message}`);
    return [];
  }
}

function metasMensaisCalendarBoundsSql_(modelos) {
  const d0s = (modelos || [])
    .map(modelo => dateIsoKey_(modelo.day_zero_base))
    .filter(Boolean)
    .sort();
  const fallbackMin = `COALESCE((SELECT MIN(data) FROM daily_latest), DATE_TRUNC(CURRENT_DATE('${CONFIG.timeZone}'), MONTH))`;
  const fallbackMax = `COALESCE((SELECT MAX(data) FROM daily_latest), CURRENT_DATE('${CONFIG.timeZone}'))`;
  if (!d0s.length) {
    return { minSql: fallbackMin, maxSql: fallbackMax };
  }
  const minLaunchDate = d0s[0];
  const maxLaunchDate = d0s[d0s.length - 1];
  return {
    minSql: `DATE(${sqlString_(minLaunchDate)})`,
    maxSql: `LEAST(CURRENT_DATE('${CONFIG.timeZone}'), DATE_ADD(DATE(${sqlString_(maxLaunchDate)}), INTERVAL 90 DAY))`
  };
}

function consultarMetasMensaisBigQuery_(modelos) {
  const goalScope = getProp_('TARGET_GOAL_SCOPE', 'shopify_geral');
  const goalScopeSql = sqlString_(goalScope);
  const calendarBounds = metasMensaisCalendarBoundsSql_(modelos);
  const query = `
WITH actual_cutoff AS (
  SELECT MAX(data) AS max_data
  FROM \`${CONFIG.bqProjectId}.mart_growth_us.dashboard_targets_actual_daily_v\`
  WHERE data <= CURRENT_DATE('${CONFIG.timeZone}')
),
headers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      DATE(target_month) AS target_month,
      goal_scope,
      version_id,
      status,
      saved_at,
      saved_by,
      source,
      save_reason,
      month_label,
      planning_method,
      currency_code,
      monthly_revenue_target,
      monthly_orders_target,
      monthly_aov_target,
      monthly_marketing_cost_pct_target,
      monthly_marketing_investment_target,
      monthly_roas_target,
      commercial_conditions_json,
      notes,
      ROW_NUMBER() OVER (
        PARTITION BY DATE(target_month), goal_scope
        ORDER BY
          IF(LOWER(COALESCE(status, '')) = 'published', 1, 0) DESC,
          saved_at DESC,
          version_id DESC
      ) AS rn
    FROM \`${CONFIG.bqProjectId}.mart_growth_us.dashboard_targets_header_raw\`
    WHERE goal_scope = ${goalScopeSql}
  )
  WHERE rn = 1
),
daily_latest AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      DATE(target_month) AS target_month,
      goal_scope,
      DATE(target_date) AS data,
      version_id,
      status,
      saved_at,
      day_of_month,
      weekday_label,
      week_of_month,
      commercial_action,
      crm_action,
      general_note,
      revenue_target,
      orders_target,
      marketing_investment_target,
      roas_target,
      aov_target,
      ROW_NUMBER() OVER (
        PARTITION BY DATE(target_month), goal_scope, version_id, DATE(target_date)
        ORDER BY saved_at DESC
      ) AS rn
    FROM \`${CONFIG.bqProjectId}.mart_growth_us.dashboard_targets_daily_raw\`
    WHERE goal_scope = ${goalScopeSql}
  )
  WHERE rn = 1
),
calendar_bounds AS (
  SELECT
    LEAST(
      ${calendarBounds.minSql},
      COALESCE((SELECT MIN(data) FROM daily_latest), ${calendarBounds.minSql})
    ) AS min_data,
    GREATEST(
      ${calendarBounds.maxSql},
      COALESCE((SELECT MAX(data) FROM daily_latest), ${calendarBounds.maxSql})
    ) AS max_data
),
calendar AS (
  SELECT
    data,
    DATE_TRUNC(data, MONTH) AS target_month
  FROM calendar_bounds,
  UNNEST(GENERATE_DATE_ARRAY(min_data, max_data)) AS data
),
month_index AS (
  SELECT target_month FROM headers
  UNION DISTINCT
  SELECT target_month FROM calendar
),
targets_daily AS (
  SELECT
    c.data,
    c.target_month,
    COALESCE(h.goal_scope, ${goalScopeSql}) AS goal_scope,
    h.version_id,
    h.status,
    h.saved_at,
    d.revenue_target,
    d.orders_target,
    d.marketing_investment_target,
    d.roas_target,
    IF(c.data <= (SELECT max_data FROM actual_cutoff), a.revenue_actual, NULL) AS revenue_actual,
    IF(c.data <= (SELECT max_data FROM actual_cutoff), a.orders_actual, NULL) AS orders_actual,
    IF(c.data <= (SELECT max_data FROM actual_cutoff), a.marketing_investment_actual, NULL) AS marketing_investment_actual,
    IF(c.data <= (SELECT max_data FROM actual_cutoff), a.roas_actual, NULL) AS roas_actual
  FROM calendar c
  LEFT JOIN headers h
    ON c.target_month = h.target_month
  LEFT JOIN daily_latest d
    ON c.data = d.data
   AND c.target_month = d.target_month
   AND COALESCE(h.goal_scope, ${goalScopeSql}) = d.goal_scope
   AND (h.version_id = d.version_id OR h.version_id IS NULL)
  LEFT JOIN \`${CONFIG.bqProjectId}.mart_growth_us.dashboard_targets_actual_daily_v\` a
    ON c.data = a.data
),
aquisicao_canal_dia AS (
  SELECT
    DATE(data) AS data,
    canal,
    SUM(investimento) AS investimento_aquisicao,
    SUM(sessoes) AS sessoes_aquisicao,
    SUM(pedidos_total) AS pedidos_aquisicao,
    SUM(receita_total) AS receita_aquisicao,
    SUM(novos_clientes) AS novos_clientes_aquisicao,
    SAFE_DIVIDE(SUM(investimento), NULLIF(SUM(sessoes), 0)) AS cps_aquisicao,
    SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(investimento), 0)) AS roas_aquisicao
  FROM \`${CONFIG.bqProjectId}.mart_growth_us.aquisicao_por_canal\`
  WHERE DATE(data) BETWEEN (SELECT min_data FROM calendar_bounds) AND (SELECT max_data FROM calendar_bounds)
  GROUP BY DATE(data), canal
),
aquisicao_dia AS (
  SELECT
    data,
    SUM(investimento_aquisicao) AS investimento_aquisicao,
    SUM(sessoes_aquisicao) AS sessoes_aquisicao,
    SUM(pedidos_aquisicao) AS pedidos_aquisicao,
    SUM(receita_aquisicao) AS receita_aquisicao,
    SUM(novos_clientes_aquisicao) AS novos_clientes_aquisicao,
    SAFE_DIVIDE(SUM(investimento_aquisicao), NULLIF(SUM(sessoes_aquisicao), 0)) AS cps_aquisicao,
    SAFE_DIVIDE(SUM(receita_aquisicao), NULLIF(SUM(investimento_aquisicao), 0)) AS roas_aquisicao,
    TO_JSON_STRING(ARRAY_AGG(STRUCT(
      canal,
      investimento_aquisicao AS investimento,
      sessoes_aquisicao AS sessoes,
      pedidos_aquisicao AS pedidos,
      receita_aquisicao AS receita,
      novos_clientes_aquisicao AS novos_clientes,
      cps_aquisicao AS cps,
      roas_aquisicao AS roas
    ) ORDER BY investimento_aquisicao DESC)) AS canais_json
  FROM aquisicao_canal_dia
  GROUP BY data
),
vendas_canal_base AS (
  SELECT
    DATE(report_date) AS data,
    LOWER(TRIM(COALESCE(CAST(referring_channel AS STRING), ''))) AS referring_channel_norm,
    LOWER(TRIM(COALESCE(CAST(utm_source AS STRING), ''))) AS utm_source_norm,
    LOWER(TRIM(COALESCE(CAST(utm_medium AS STRING), ''))) AS utm_medium_norm,
    LOWER(TRIM(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(CAST(utm_medium AS STRING), ''), NFD),
      r'\\p{M}',
      ''
    ))) AS utm_medium_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(CAST(referring_channel AS STRING), ''), ' ',
        COALESCE(CAST(utm_source AS STRING), ''), ' ',
        COALESCE(CAST(utm_medium AS STRING), '')
      ), NFD),
      r'\\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match,
    SAFE_CAST(orders__last_click AS NUMERIC) AS pedidos,
    SAFE_CAST(net_sales__last_click AS NUMERIC) AS receita
  FROM \`${CONFIG.bqProjectId}.mart_growth_us.sales_attributed_to_marketing_v\`
  WHERE DATE(report_date) BETWEEN (SELECT min_data FROM calendar_bounds) AND (SELECT max_data FROM calendar_bounds)
),
vendas_canal_classificado AS (
  SELECT
    data,
    CASE
      WHEN REGEXP_CONTAINS(utm_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paidsocial|paid|display|demand[-_ ]gen|ads?|adwords|gads)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'Midia paga'
      ELSE 'Organico'
    END AS canal,
    CASE
      WHEN REGEXP_CONTAINS(utm_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paidsocial|paid|display|demand[-_ ]gen|ads?|adwords|gads)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'paid'
      ELSE 'organic'
    END AS tipo,
    pedidos,
    receita
  FROM vendas_canal_base
),
vendas_canal_dia_grupo AS (
  SELECT
    data,
    canal,
    tipo,
    SUM(COALESCE(pedidos, 0)) AS pedidos,
    SUM(COALESCE(receita, 0)) AS receita
  FROM vendas_canal_classificado
  GROUP BY data, canal, tipo
),
vendas_canal_dia AS (
  SELECT
    data,
    SUM(pedidos) AS pedidos_venda_canal,
    SUM(receita) AS receita_venda_canal,
    TO_JSON_STRING(ARRAY_AGG(STRUCT(
      canal,
      tipo,
      pedidos,
      receita
    ) ORDER BY receita DESC)) AS canais_json
  FROM vendas_canal_dia_grupo
  GROUP BY data
),
daily_agg AS (
  SELECT
    d.target_month,
    d.goal_scope,
    d.version_id,
    COUNTIF(d.revenue_target IS NOT NULL) AS dias_meta_receita,
    COUNTIF(d.revenue_actual IS NOT NULL) AS dias_realizado_receita,
    SUM(d.revenue_target) AS meta_receita_dia_sum,
    SUM(d.orders_target) AS meta_pedidos_dia_sum,
    SUM(d.marketing_investment_target) AS meta_investimento_dia_sum,
    SUM(d.revenue_actual) AS realizado_receita_dia_sum,
    SUM(d.orders_actual) AS realizado_pedidos_dia_sum,
    SUM(d.marketing_investment_actual) AS realizado_investimento_dia_sum,
    MAX(IF(d.revenue_actual IS NOT NULL, d.data, NULL)) AS realizado_ate,
    TO_JSON_STRING(ARRAY_AGG(STRUCT(
      d.data AS data,
      d.revenue_target AS meta_receita,
      d.orders_target AS meta_pedidos,
      d.marketing_investment_target AS meta_investimento,
      d.roas_target AS roas_meta,
      d.revenue_actual AS realizado_receita,
      d.orders_actual AS realizado_pedidos,
      d.marketing_investment_actual AS investimento_realizado,
      d.roas_actual AS roas_realizado,
      a.investimento_aquisicao AS investimento_aquisicao,
      a.sessoes_aquisicao AS sessoes_aquisicao,
      a.pedidos_aquisicao AS pedidos_aquisicao,
      a.receita_aquisicao AS receita_aquisicao,
      a.novos_clientes_aquisicao AS novos_clientes_aquisicao,
      a.cps_aquisicao AS cps_aquisicao,
      a.roas_aquisicao AS roas_aquisicao,
      a.canais_json AS canais_aquisicao_json,
      v.receita_venda_canal AS receita_venda_canal,
      v.pedidos_venda_canal AS pedidos_venda_canal,
      v.canais_json AS canais_venda_json
    ) ORDER BY d.data)) AS daily_json
  FROM targets_daily d
  LEFT JOIN aquisicao_dia a
    ON d.data = a.data
  LEFT JOIN vendas_canal_dia v
    ON d.data = v.data
  GROUP BY 1,2,3
),
aquisicao_canal AS (
  SELECT
    DATE_TRUNC(data, MONTH) AS target_month,
    canal,
    SUM(investimento_aquisicao) AS investimento_aquisicao,
    SUM(sessoes_aquisicao) AS sessoes_aquisicao,
    SUM(pedidos_aquisicao) AS pedidos_aquisicao,
    SUM(receita_aquisicao) AS receita_aquisicao,
    SUM(novos_clientes_aquisicao) AS novos_clientes_aquisicao,
    SAFE_DIVIDE(SUM(investimento_aquisicao), NULLIF(SUM(sessoes_aquisicao), 0)) AS cps_aquisicao,
    SAFE_DIVIDE(SUM(receita_aquisicao), NULLIF(SUM(investimento_aquisicao), 0)) AS roas_aquisicao
  FROM aquisicao_canal_dia
  GROUP BY DATE_TRUNC(data, MONTH), canal
),
aquisicao_mes AS (
  SELECT
    target_month,
    SUM(investimento_aquisicao) AS investimento_aquisicao,
    SUM(sessoes_aquisicao) AS sessoes_aquisicao,
    SUM(pedidos_aquisicao) AS pedidos_aquisicao,
    SUM(receita_aquisicao) AS receita_aquisicao,
    SUM(novos_clientes_aquisicao) AS novos_clientes_aquisicao,
    SAFE_DIVIDE(SUM(investimento_aquisicao), NULLIF(SUM(sessoes_aquisicao), 0)) AS cps_aquisicao,
    SAFE_DIVIDE(SUM(receita_aquisicao), NULLIF(SUM(investimento_aquisicao), 0)) AS roas_aquisicao,
    TO_JSON_STRING(ARRAY_AGG(STRUCT(
      canal,
      investimento_aquisicao AS investimento,
      sessoes_aquisicao AS sessoes,
      pedidos_aquisicao AS pedidos,
      receita_aquisicao AS receita,
      novos_clientes_aquisicao AS novos_clientes,
      cps_aquisicao AS cps,
      roas_aquisicao AS roas
    ) ORDER BY investimento_aquisicao DESC)) AS canais_json
  FROM aquisicao_canal
  GROUP BY target_month
)
SELECT
  FORMAT_DATE('%Y-%m', mi.target_month) AS mes,
  COALESCE(h.goal_scope, ${goalScopeSql}) AS goal_scope,
  h.version_id,
  COALESCE(h.status, 'historical_context') AS status,
  COALESCE(h.month_label, FORMAT_DATE('%Y-%m', mi.target_month)) AS month_label,
  h.monthly_revenue_target AS meta_receita_header,
  h.monthly_orders_target AS meta_pedidos_header,
  h.monthly_marketing_investment_target AS meta_investimento_header,
  h.monthly_roas_target AS roas_meta_header,
  d.meta_receita_dia_sum,
  d.meta_pedidos_dia_sum,
  d.meta_investimento_dia_sum,
  d.realizado_receita_dia_sum,
  d.realizado_pedidos_dia_sum,
  d.realizado_investimento_dia_sum,
  d.dias_meta_receita,
  d.dias_realizado_receita,
  d.realizado_ate,
  d.daily_json,
  a.investimento_aquisicao,
  a.sessoes_aquisicao,
  a.pedidos_aquisicao,
  a.receita_aquisicao,
  a.novos_clientes_aquisicao,
  a.cps_aquisicao,
  a.roas_aquisicao,
  a.canais_json
FROM month_index mi
LEFT JOIN headers h
  ON mi.target_month = h.target_month
LEFT JOIN daily_agg d
  ON mi.target_month = d.target_month
LEFT JOIN aquisicao_mes a
  ON mi.target_month = a.target_month
ORDER BY mi.target_month`;

  return runBq_(query, CONFIG.bqUsLocation).map(row => normalizarMetaMensalBigQuery_(row));
}

function normalizarMetaMensalBigQuery_(row) {
  const normalizarCanalAquisicao = canal => ({
    canal: canal.canal || null,
    investimento: numberOrNull_(canal.investimento),
    sessoes: numberOrNull_(canal.sessoes),
    pedidos: numberOrNull_(canal.pedidos),
    receita: numberOrNull_(canal.receita),
    novos_clientes: numberOrNull_(canal.novos_clientes),
    cps: numberOrNull_(canal.cps),
    roas: roasOrNull_(canal.roas)
  });
  const normalizarCanalVenda = canal => ({
    canal: canal.canal || null,
    tipo: canal.tipo || null,
    pedidos: numberOrNull_(canal.pedidos),
    receita: numberOrNull_(canal.receita)
  });
  const daily = parseJsonArraySeguro_(row.daily_json).map(day => ({
    data: dateIsoKey_(day.data),
    meta_receita: numberOrNull_(day.meta_receita),
    realizado_receita: numberOrNull_(day.realizado_receita),
    meta_pedidos: numberOrNull_(day.meta_pedidos),
    realizado_pedidos: numberOrNull_(day.realizado_pedidos),
    meta_investimento: numberOrNull_(day.meta_investimento),
    investimento_realizado: numberOrNull_(day.investimento_realizado),
    investimento_aquisicao: numberOrNull_(day.investimento_aquisicao),
    sessoes_aquisicao: numberOrNull_(day.sessoes_aquisicao),
    pedidos_aquisicao: numberOrNull_(day.pedidos_aquisicao),
    receita_aquisicao: numberOrNull_(day.receita_aquisicao),
    novos_clientes_aquisicao: numberOrNull_(day.novos_clientes_aquisicao),
    roas_meta: roasOrNull_(day.roas_meta),
    roas_realizado: roasOrNull_(day.roas_realizado),
    cps_aquisicao: numberOrNull_(day.cps_aquisicao),
    roas_aquisicao: roasOrNull_(day.roas_aquisicao),
    receita_venda_canal: numberOrNull_(day.receita_venda_canal),
    pedidos_venda_canal: numberOrNull_(day.pedidos_venda_canal),
    canais_aquisicao: parseJsonArraySeguro_(day.canais_aquisicao_json || day.canais_aquisicao).map(normalizarCanalAquisicao),
    canais_venda: parseJsonArraySeguro_(day.canais_venda_json || day.canais_venda).map(normalizarCanalVenda)
  })).filter(day => day.data);
  const canais = parseJsonArraySeguro_(row.canais_json).map(normalizarCanalAquisicao);
  const metaReceita = numberOrNull_(row.meta_receita_header) ?? numberOrNull_(row.meta_receita_dia_sum);
  const realizadoReceita = numberOrNull_(row.realizado_receita_dia_sum);
  return {
    mes: row.mes || monthKey_(row.target_month),
    modelo_id: null,
    linha: null,
    meta_receita: metaReceita,
    realizado_receita: realizadoReceita,
    meta_pedidos: numberOrNull_(row.meta_pedidos_header) ?? numberOrNull_(row.meta_pedidos_dia_sum),
    realizado_pedidos: numberOrNull_(row.realizado_pedidos_dia_sum),
    meta_pares: null,
    realizado_pares: null,
    atingimento: roasOrNull_(ratioSeguro_(realizadoReceita, metaReceita)),
    goal_scope: row.goal_scope || null,
    version_id: row.version_id || null,
    month_label: row.month_label || null,
    dias_meta_receita: numberOrNull_(row.dias_meta_receita),
    dias_realizado_receita: numberOrNull_(row.dias_realizado_receita),
    realizado_ate: dateIsoKey_(row.realizado_ate),
    meta_investimento: numberOrNull_(row.meta_investimento_header) ?? numberOrNull_(row.meta_investimento_dia_sum),
    investimento_realizado: numberOrNull_(row.realizado_investimento_dia_sum),
    investimento_aquisicao: numberOrNull_(row.investimento_aquisicao),
    sessoes_aquisicao: numberOrNull_(row.sessoes_aquisicao),
    pedidos_aquisicao: numberOrNull_(row.pedidos_aquisicao),
    receita_aquisicao: numberOrNull_(row.receita_aquisicao),
    novos_clientes_aquisicao: numberOrNull_(row.novos_clientes_aquisicao),
    cps_aquisicao: numberOrNull_(row.cps_aquisicao),
    roas_aquisicao: roasOrNull_(row.roas_aquisicao),
    canais_aquisicao: canais,
    daily,
    observacao: 'fonte: BigQuery mart_growth_us.dashboard_targets_header_raw + dashboard_targets_daily_raw + dashboard_targets_actual_daily_v + aquisicao_por_canal',
    status: row.status || 'published'
  };
}

function normalizeMetasMensaisPayload_(rows) {
  return (rows || []).map(row => ({
    ...row,
    mes: monthKey_(row.mes || row.competencia || row.month || row.data || row.data_inicio),
    modelo_id: row.modelo_id || null,
    linha: row.linha || null,
    meta_receita: numberOrNull_(row.meta_receita),
    realizado_receita: numberOrNull_(row.realizado_receita),
    meta_pedidos: numberOrNull_(row.meta_pedidos),
    realizado_pedidos: numberOrNull_(row.realizado_pedidos),
    meta_pares: numberOrNull_(row.meta_pares),
    realizado_pares: numberOrNull_(row.realizado_pares),
    atingimento: roasOrNull_(row.atingimento),
    daily: Array.isArray(row.daily) ? row.daily : []
  })).filter(row => row.mes || row.meta_receita !== null || row.realizado_receita !== null);
}

function mesclarMetasMensais_(baseRows, bqRows) {
  const map = {};
  normalizeMetasMensaisPayload_(baseRows).forEach(row => {
    map[chaveMetaMensal_(row)] = row;
  });
  normalizeMetasMensaisPayload_(bqRows).forEach(row => {
    map[chaveMetaMensal_(row)] = row;
  });
  return Object.keys(map)
    .map(key => map[key])
    .sort((a, b) => String(a.mes || '').localeCompare(String(b.mes || '')) || String(a.modelo_id || '').localeCompare(String(b.modelo_id || '')));
}

function chaveMetaMensal_(row) {
  return [row.mes || '', row.modelo_id || '', row.linha || ''].join('|');
}

function exportarFaturamentoCampanhaSeConfigurado_() {
  const spreadsheetId = investmentSpreadsheetId_();
  if (!spreadsheetId) {
    Logger.log('Planilha de investimento nao configurada; mantendo faturamento_campanha.json atual');
    return { status: 'skipped', rows: 'skipped', payload: { generated_at: null, rows: [] } };
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('faturamento_campanha');
    if (!sheet) {
      Logger.log('Aba faturamento_campanha nao encontrada; mantendo faturamento_campanha.json atual');
      return { status: 'skipped', rows: 'skipped', payload: { generated_at: null, rows: [] } };
    }

    const rows = normalizeFaturamentoCampanha_(sheetToObjects_(sheet));
    const payload = {
      generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      rows
    };
    escreverJsonGitHub_('faturamento_campanha.json', payload);
    Logger.log(`faturamento_campanha.json exportado com ${rows.length} linhas.`);
    return { status: 'exported', rows: rows.length, payload };
  } catch (error) {
    Logger.log(`faturamento_campanha.json nao exportado; mantendo arquivo atual. Erro: ${error.message}`);
    return { status: 'skipped', rows: 'skipped', error: error.message, payload: { generated_at: null, rows: [] } };
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
    const linha = String(row.linha || '').trim();
    const modelo = modelosById[modeloId] || {};
    const investimento = numberOrNull_(row.investimento);
    const receita = numberOrNull_(row.receita_atribuida);
    const pedidos = numberOrNull_(row.pedidos);

    return {
      modelo_id: modeloId || null,
      linha: linha || null,
      campanha,
      canal: row.canal || null,
      data_inicio: row.data_inicio || null,
      data_fim: row.data_fim || null,
      janela: row.janela || (modeloId ? inferJanelaMidia_(row, modelo) : null),
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

function normalizeMetasMensais_(rows) {
  return (rows || []).map(row => {
    const mes = monthKey_(row.mes || row.competencia || row.month || row.data || row.data_inicio);
    return {
      mes,
      modelo_id: row.modelo_id || null,
      linha: row.linha || null,
      meta_receita: primeiroNumeroDisponivel_(row, ['meta_receita', 'meta_faturamento', 'meta']),
      realizado_receita: primeiroNumeroDisponivel_(row, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']),
      meta_pedidos: primeiroNumeroDisponivel_(row, ['meta_pedidos', 'pedidos_meta']),
      realizado_pedidos: primeiroNumeroDisponivel_(row, ['realizado_pedidos', 'pedidos_realizados']),
      meta_pares: primeiroNumeroDisponivel_(row, ['meta_pares', 'pares_meta']),
      realizado_pares: primeiroNumeroDisponivel_(row, ['realizado_pares', 'pares_realizados']),
      atingimento: roasOrNull_(row.atingimento),
      observacao: row.observacao || null,
      status: row.status || null
    };
  }).filter(row => row.mes || row.meta_receita !== null || row.realizado_receita !== null);
}

function normalizeFaturamentoCampanha_(rows) {
  return (rows || []).map(row => {
    const investimento = primeiroNumeroDisponivel_(row, ['investimento', 'spend', 'custo']);
    const receita = primeiroNumeroDisponivel_(row, ['receita_atribuida', 'receita', 'faturamento', 'faturamento_campanha', 'receita_campanha']);
    const pedidos = primeiroNumeroDisponivel_(row, ['pedidos', 'orders']);
    return {
      modelo_id: row.modelo_id || null,
      campanha: row.campanha || row.campaign || row.utm_campaign || null,
      canal: row.canal || row.channel || row.source_medium || null,
      data_inicio: dateIsoKey_(row.data_inicio || row.data || row.inicio),
      data_fim: dateIsoKey_(row.data_fim || row.data || row.fim),
      janela: row.janela || null,
      investimento,
      receita_atribuida: receita,
      pedidos,
      pares: primeiroNumeroDisponivel_(row, ['pares', 'quantidade']),
      cliques: primeiroNumeroDisponivel_(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']),
      roas: roasOrNull_(row.roas) ?? (investimento && investimento > 0 && receita !== null ? round6_(receita / investimento) : null),
      cpa: primeiroNumeroDisponivel_(row, ['cpa']) ?? (investimento && investimento > 0 && pedidos ? round2_(investimento / pedidos) : null),
      observacao: row.observacao || null,
      status: row.status || null
    };
  }).filter(row => row.modelo_id || row.campanha || row.receita_atribuida !== null);
}

function janelaEmDias_(janelaStr) {
  const match = String(janelaStr || '').match(/(\d+)d/);
  return match ? parseInt(match[1], 10) : null;
}

function validarJanelaMidia_(registro) {
  if (!registro.data_inicio || !registro.data_fim) {
    return { valida: false, motivo: 'data_inicio_ou_fim_ausente' };
  }

  const inicio = dateOnly_(registro.data_inicio);
  const fim = dateOnly_(registro.data_fim);
  if (!inicio || !fim) {
    return { valida: false, motivo: 'data_inicio_ou_fim_invalida' };
  }

  const diasReais = Math.round((fim - inicio) / 86400000);
  const diasDeclarados = janelaEmDias_(registro.janela);
  if (diasReais < 0) {
    return { valida: false, motivo: 'data_fim_anterior_a_data_inicio' };
  }
  if (diasDeclarados !== null && Math.abs(diasReais - diasDeclarados) > 5) {
    return { valida: false, motivo: `janela_declarada_${diasDeclarados}d_mas_intervalo_real_${diasReais}d` };
  }

  return { valida: true };
}

function marcarQualidadeMidiaPaga_(registrosMidia) {
  const rows = (registrosMidia || []).map(row => {
    const janela = validarJanelaMidia_(row);
    return {
      ...row,
      data_suspeita: !janela.valida,
      data_suspeita_motivo: janela.valida ? null : janela.motivo,
      valor_suspeito: Boolean(row.valor_suspeito),
      valor_suspeito_motivo: row.valor_suspeito_motivo || null
    };
  });

  const byModelo = {};
  rows.forEach((row, index) => {
    const modeloId = String(row.modelo_id || '').trim();
    const dias = janelaEmDias_(row.janela);
    const investimento = numberOrNull_(row.investimento);
    if (!modeloId || dias === null || investimento === null) return;
    if (!byModelo[modeloId]) byModelo[modeloId] = [];
    byModelo[modeloId].push({ index, dias, investimento });
  });

  Object.keys(byModelo).forEach(modeloId => {
    const items = byModelo[modeloId].sort((a, b) => a.dias - b.dias || a.index - b.index);
    items.forEach(item => {
      const lowerDays = items
        .filter(other => other.dias < item.dias)
        .map(other => other.dias)
        .sort((a, b) => b - a)[0];
      const higherDays = items
        .filter(other => other.dias > item.dias)
        .map(other => other.dias)
        .sort((a, b) => a - b)[0];
      const lowerMax = lowerDays === undefined ? null : Math.max(...items
        .filter(other => other.dias === lowerDays)
        .map(other => other.investimento));
      const higherMax = higherDays === undefined ? null : Math.max(...items
        .filter(other => other.dias === higherDays)
        .map(other => other.investimento));

      if (higherMax !== null && item.investimento > higherMax) {
        marcarValorSuspeitoMidia_(rows[item.index], 'investimento_maior_que_janela_mais_longa');
      } else if (lowerMax !== null && lowerMax > 0 && item.investimento > lowerMax * 5) {
        marcarValorSuspeitoMidia_(rows[item.index], 'investimento_desproporcional_a_janela_adjacente');
      }
    });
  });

  return rows;
}

function marcarValorSuspeitoMidia_(row, motivo) {
  row.valor_suspeito = true;
  row.valor_suspeito_motivo = row.valor_suspeito_motivo || motivo;
}

function midiaValidaParaImpacto_(row) {
  return !row.data_suspeita && !row.valor_suspeito;
}

function marcarReceitaDuplicadaMidiaPaga_(registrosMidia) {
  const rows = (registrosMidia || []).map(row => ({ ...row }));
  const grupos = {};
  rows.forEach((row, index) => {
    const key = `${row.modelo_id || 'sem_modelo'}::${row.janela || 'sem_janela'}`;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push({ row, index });
  });

  Object.keys(grupos).forEach(key => {
    const itens = grupos[key].filter(item => (
      midiaValidaParaImpacto_(item.row)
      && item.row.receita_atribuida !== null
      && item.row.receita_atribuida !== undefined
    ));
    const canais = {};
    const receitas = {};
    itens.forEach(item => {
      canais[String(item.row.canal || item.row.campanha || '').trim().toLowerCase()] = true;
      receitas[String(Math.round(Number(item.row.receita_atribuida || 0) * 100) / 100)] = true;
    });
    const canaisCount = Object.keys(canais).filter(Boolean).length;
    const receitaKeys = Object.keys(receitas);
    if (itens.length < 2 || canaisCount < 2 || receitaKeys.length !== 1) return;

    const receitaJanela = Number(receitaKeys[0]);
    itens.forEach(item => {
      const row = rows[item.index];
      row.receita_janela_agregada = receitaJanela;
      row.pedidos_janela_agregados = row.pedidos;
      row.receita_atribuida = null;
      row.pedidos = null;
      row.roas = null;
      row.cpa = null;
      row.atribuicao_bloqueada = true;
      row.metodologia = 'receita_janela_agregada';
      row.aviso = 'Receita repetida em canais diferentes da mesma janela. ROAS de investimento foi bloqueado; use leitura agregada ate existir atribuicao real por pedido.';
    });
  });

  return rows;
}

function isolarInvestimentoUnicoNaJanela_(rows, index) {
  const row = rows[index];
  const modeloId = String(row.modelo_id || '').trim();
  if (!modeloId) return false;
  const inicio = dateOnly_(row.data_inicio);
  const fim = dateOnly_(row.data_fim || row.data_inicio);
  if (!inicio || !fim) return false;
  return !rows.some((other, otherIndex) => {
    if (otherIndex === index) return false;
    if (String(other.modelo_id || '').trim() !== modeloId) return false;
    if (!midiaValidaParaImpacto_(other)) return false;
    const outroInicio = dateOnly_(other.data_inicio);
    const outroFim = dateOnly_(other.data_fim || other.data_inicio);
    if (!outroInicio || !outroFim) return false;
    return outroInicio <= fim && outroFim >= inicio;
  });
}

function estimarReceitaJanelaIsolada_(rows, shareTrajetoria) {
  return rows.map((row, index) => {
    if (!midiaValidaParaImpacto_(row)) return row;
    if (row.receita_atribuida !== null && row.receita_atribuida !== undefined) return row;
    const investimento = numberOrNull_(row.investimento);
    if (!investimento || investimento <= 0) return row;
    const modeloId = String(row.modelo_id || '').trim();
    if (!modeloId) return row;

    if (!isolarInvestimentoUnicoNaJanela_(rows, index)) {
      return {
        ...row,
        janela_isolada_confiavel: false,
        janela_isolada_motivo: 'Mais de uma campanha do mesmo modelo com datas sobrepostas nesta janela; nao da para isolar o efeito de cada uma.'
      };
    }

    const janela = pontosShareJanela_(shareTrajetoria, modeloId, row.data_inicio, row.data_fim);
    const receitaJanela = somarReceitaProdutoPontos_(janela);
    const pedidosJanela = somarPedidosProdutoPontos_(janela);
    if (receitaJanela === null) {
      return {
        ...row,
        janela_isolada_confiavel: false,
        janela_isolada_motivo: 'share_trajetoria ainda nao tem dado de receita para essa janela.'
      };
    }

    return {
      ...row,
      receita_janela_isolada: receitaJanela,
      pedidos_janela_isolados: pedidosJanela,
      roas_janela_isolada: round6_(receitaJanela / investimento),
      cpa_janela_isolada: pedidosJanela ? round2_(investimento / pedidosJanela) : null,
      janela_isolada_confiavel: true,
      janela_isolada_motivo: 'Unica campanha do modelo ativa nesta janela - leitura mais confiavel que o agregado, mas ainda mistura organico e pago dentro do periodo.'
    };
  });
}

function calcularImpactoMidiaPaga_(registrosMidia, shareTrajetoria) {
  const base = marcarReceitaDuplicadaMidiaPaga_(marcarQualidadeMidiaPaga_(registrosMidia));
  const comIsolamento = shareTrajetoria ? estimarReceitaJanelaIsolada_(base, shareTrajetoria) : base;
  return comIsolamento.map(row => {
    const investimento = numberOrNull_(row.investimento);
    const receita = numberOrNull_(row.receita_atribuida);
    const pedidos = numberOrNull_(row.pedidos);
    const roas = roasOrNull_(row.roas);
    const cpa = numberOrNull_(row.cpa);
    const isLinhaInteira = !String(row.modelo_id || '').trim() && Boolean(String(row.linha || '').trim());

    return {
      ...row,
      roas: row.atribuicao_bloqueada ? null : (roas ?? (!isLinhaInteira && investimento && investimento > 0 && receita !== null ? round6_(receita / investimento) : null)),
      cpa: row.atribuicao_bloqueada ? null : (cpa ?? (!isLinhaInteira && investimento && investimento > 0 && pedidos ? round2_(investimento / pedidos) : null)),
      metodologia: row.metodologia || null,
      aviso: row.aviso || null
    };
  });
}

function calcularImpactoCrmDisparos_(registrosCrm, shareTrajetoria) {
  return (registrosCrm || []).map(row => {
    const dataInicio = dateIsoKey_(row.data_disparo);
    const dataFim = dataInicio ? addDaysIso_(dataInicio, 2) : null;
    const janela = pontosShareJanela_(shareTrajetoria, row.modelo_id, dataInicio, dataFim);
    const receitaDia = somarReceitaProdutoPontos_(janela);
    const pedidos = somarPedidosProdutoPontos_(janela);
    const investimento = numberOrNull_(row.investimento);

    return {
      ...row,
      receita_dia: receitaDia,
      pedidos,
      roas: investimento && investimento > 0 && receitaDia !== null ? round6_(receitaDia / investimento) : null,
      cpa: investimento && investimento > 0 && pedidos ? round2_(investimento / pedidos) : null,
      metodologia: METODOLOGIA_INVESTIMENTO,
      aviso: AVISO_INVESTIMENTO
    };
  });
}

function calcularImpactoAgregadoSeDisponivel_(registrosMidia, registrosCrm, shareTrajetoria) {
  const midia = marcarQualidadeMidiaPaga_(registrosMidia || []);
  const crm = registrosCrm || [];
  if (!midia.length && !crm.length) {
    Logger.log('impacto_investimento nao exportado: sem registros da planilha de investimento.');
    return { status: 'skipped', rows: 'skipped', error_summary: 'sem registros da planilha de investimento' };
  }

  if (!shareTrajetoria || !shareTrajetoria.modelos) {
    Logger.log('impacto_investimento nao exportado: share_trajetoria indisponivel.');
    return { status: 'skipped', rows: 'skipped', error_summary: 'share_trajetoria indisponivel' };
  }

  try {
    const payload = calcularImpactoAgregadoInvestimento_(midia, crm, shareTrajetoria);
    const modelos = Object.keys(payload.modelos || {});
    if (!modelos.length) {
      Logger.log('impacto_investimento nao exportado: nenhum modelo com campanhas e pontos de share validos.');
      return { status: 'skipped', rows: 'skipped', error_summary: 'nenhum modelo com campanhas e pontos de share validos', payload };
    }

    escreverJsonGitHub_('impacto_investimento.json', payload);
    Logger.log(`impacto_investimento.json exportado com ${modelos.length} modelos.`);
    return { status: 'exported', rows: modelos.length, payload };
  } catch (error) {
    const resumoErro = resumirErro_(error);
    Logger.log(`impacto_investimento.json nao exportado; mantendo arquivo atual. Erro: ${resumoErro}`);
    return { status: 'failed', rows: 'failed', error: error.message, error_summary: resumoErro };
  }
}

function calcularImpactoAgregadoInvestimento_(registrosMidia, registrosCrm, shareTrajetoria) {
  const janelasPorModelo = {};
  (registrosMidia || []).forEach(row => {
    if (!midiaValidaParaImpacto_(row)) return;
    adicionarJanelaInvestimento_(janelasPorModelo, row.modelo_id, row.data_inicio, row.data_fim || row.data_inicio);
  });
  (registrosCrm || []).forEach(row => {
    const dataInicio = dateIsoKey_(row.data_disparo);
    adicionarJanelaInvestimento_(janelasPorModelo, row.modelo_id, dataInicio, dataInicio ? addDaysIso_(dataInicio, 2) : null);
  });

  const payload = {
    generated_at: Utilities.formatDate(new Date(), CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    metodologia: METODOLOGIA_INVESTIMENTO,
    aviso: 'Nao mede atribuicao real de clique/conversao. Mostra apenas se dias com investimento ativo tiveram share medio maior que dias sem, no mesmo lancamento.',
    modelos: {}
  };

  Object.keys(janelasPorModelo).forEach(modeloId => {
    const pontos = pontosShareModelo_(shareTrajetoria, modeloId);
    if (!pontos || !pontos.length) return;

    const comInvestimento = [];
    const semInvestimento = [];
    pontos.forEach(point => {
      const data = dateIsoKey_(point.data_calendario);
      const share = numberOrNull_(point.share_do_dia);
      if (!data || share === null) return;
      if (janelasPorModelo[modeloId].some(janela => data >= janela.inicio && data <= janela.fim)) {
        comInvestimento.push(share);
      } else {
        semInvestimento.push(share);
      }
    });

    if (!comInvestimento.length && !semInvestimento.length) return;

    payload.modelos[modeloId] = {
      share_medio_dias_com_investimento: mediaOuNull_(comInvestimento),
      share_medio_dias_sem_investimento: mediaOuNull_(semInvestimento),
      dias_com_investimento: comInvestimento.length,
      dias_sem_investimento: semInvestimento.length,
      metodologia: METODOLOGIA_INVESTIMENTO,
      aviso: payload.aviso
    };
  });

  return payload;
}

function adicionarJanelaInvestimento_(janelasPorModelo, modeloId, inicio, fim) {
  const id = String(modeloId || '').trim();
  const start = dateIsoKey_(inicio);
  const end = dateIsoKey_(fim || inicio);
  if (!id || !start || !end) return;
  if (!janelasPorModelo[id]) janelasPorModelo[id] = [];
  janelasPorModelo[id].push({
    inicio: start <= end ? start : end,
    fim: start <= end ? end : start
  });
}

function pontosShareJanela_(shareTrajetoria, modeloId, inicio, fim) {
  const pontos = pontosShareModelo_(shareTrajetoria, modeloId);
  const start = dateIsoKey_(inicio);
  const end = dateIsoKey_(fim || inicio);
  if (!pontos || !start || !end) return { calculavel: false, pontos: [] };

  const dataInicio = start <= end ? start : end;
  const dataFim = start <= end ? end : start;
  return {
    calculavel: true,
    pontos: pontos.filter(point => {
      const data = dateIsoKey_(point.data_calendario);
      return data && data >= dataInicio && data <= dataFim;
    })
  };
}

function pontosShareModelo_(shareTrajetoria, modeloId) {
  const id = String(modeloId || '').trim();
  const modelo = id && shareTrajetoria && shareTrajetoria.modelos ? shareTrajetoria.modelos[id] : null;
  return modelo && Array.isArray(modelo.pontos) ? modelo.pontos : null;
}

function somarReceitaProdutoPontos_(janela) {
  if (!janela || !janela.calculavel) return null;
  if (!janela.pontos.length) return 0;

  let total = 0;
  let temCampoReceita = false;
  janela.pontos.forEach(point => {
    if (Object.prototype.hasOwnProperty.call(point, 'receita_produto')) {
      temCampoReceita = true;
      total += Number(point.receita_produto || 0);
      return;
    }

    const share = numberOrNull_(point.share_do_dia);
    const receitaEmpresa = numberOrNull_(point.receita_empresa);
    if (share !== null && receitaEmpresa !== null) {
      temCampoReceita = true;
      total += share * receitaEmpresa;
    }
  });

  return temCampoReceita ? round2_(total) : null;
}

function somarPedidosProdutoPontos_(janela) {
  if (!janela || !janela.calculavel || !janela.pontos.length) return null;

  let total = 0;
  let temPedidos = false;
  janela.pontos.forEach(point => {
    const value = primeiroNumeroDisponivel_(point, ['pedidos_produto', 'pedidos_lancamento', 'pedidos']);
    if (value !== null) {
      temPedidos = true;
      total += value;
    }
  });

  return temPedidos ? total : null;
}

function primeiroNumeroDisponivel_(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (Object.prototype.hasOwnProperty.call(obj || {}, key)) {
      const value = numberOrNull_(obj[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function mediaOuNull_(values) {
  const valid = (values || []).map(Number).filter(value => Number.isFinite(value));
  if (!valid.length) return null;
  return round6_(valid.reduce((acc, value) => acc + value, 0) / valid.length);
}

function dateIsoKey_(value) {
  const date = dateOnly_(value);
  return date ? Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM-dd') : null;
}

function parseJsonArraySeguro_(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function ratioSeguro_(numerador, denominador) {
  const num = numberOrNull_(numerador);
  const den = numberOrNull_(denominador);
  if (num === null || den === null || den === 0) return null;
  return round6_(num / den);
}

function sqlString_(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function addDaysIso_(value, days) {
  const date = dateOnly_(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM-dd');
}

function monthKey_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM');
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}`;
  const monthYear = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (monthYear) return `${monthYear[2]}-${String(monthYear[1]).padStart(2, '0')}`;
  return '';
}

function inferJanelaMidia_(row, modelo) {
  const d0 = dateOnly_(modelo.day_zero_base);
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
  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parts = text.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function dateIso_(value) {
  const date = dateOnly_(value);
  return date ? Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM-dd') : '';
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

function booleanOrFalse_(value) {
  if (value === true || value === false) return value;
  return String(value || '').trim().toLowerCase() === 'true';
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

function resumirErro_(error) {
  const message = String(error && error.message ? error.message : error || 'erro desconhecido')
    .replace(/\s+/g, ' ')
    .trim();
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
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
  const current = urlFetchComRetry_(`${api}?ref=${CONFIG.githubBranch}`, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  }, `GitHub GET ${path}`);
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
  const response = urlFetchComRetry_(api, {
    method: 'put',
    contentType: 'application/json',
    headers: githubHeaders_(token),
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  }, `GitHub PUT ${path}`);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Nao consegui escrever ${path} no GitHub. HTTP ${code}: ${response.getContentText().slice(0, 400)}. Contexto: ${githubRequestContext_(path)}. Verifique se o GITHUB_TOKEN tem acesso ao repo e permissao Contents: Read and write.`);
  }
}

function urlFetchComRetry_(url, options, context) {
  const maxAttempts = 4;
  const retryStatus = { 408: true, 429: true, 500: true, 502: true, 503: true, 504: true };
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      if (!retryStatus[code] || attempt === maxAttempts) return response;

      lastError = new Error(`HTTP ${code}: ${response.getContentText().slice(0, 250)}`);
      Logger.log(`${context}: tentativa ${attempt}/${maxAttempts} retornou ${resumirErro_(lastError)}; nova tentativa em instantes.`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw new Error(`${context} falhou apos ${maxAttempts} tentativas: ${resumirErro_(error)}`);
      }
      Logger.log(`${context}: tentativa ${attempt}/${maxAttempts} falhou com ${resumirErro_(error)}; nova tentativa em instantes.`);
    }

    Utilities.sleep(Math.min(30000, Math.pow(2, attempt - 1) * 1000));
  }

  throw lastError || new Error(`${context} falhou sem erro detalhado.`);
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

function getBoolProp_(key, fallback) {
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (raw === null || raw === undefined || raw === '') return Boolean(fallback);
  const value = String(raw).trim().toLowerCase();
  if (['false', '0', 'no', 'nao', 'não', 'off', 'desligado'].includes(value)) return false;
  if (['true', '1', 'yes', 'sim', 'on', 'ligado'].includes(value)) return true;
  return Boolean(fallback);
}
