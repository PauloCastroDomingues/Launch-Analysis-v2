-- Diagnostico de origem real dos pedidos por lancamento.
--
-- Objetivo:
-- 1) encontrar campos de origem/canal disponiveis no SSOT;
-- 2) classificar pedidos de lancamento em paid quando a UTM/origem indica midia paga
--    e organic para todo o restante;
-- 3) validar se os pedidos pagos e organicos do dashboard podem ser
--    preenchidos por origem real do BigQuery.
--
-- Rode no BigQuery com JOB LOCATION = southamerica-east1.
-- Query somente leitura: nao cria tabela nem altera dados.

-- 1) Inventario rapido de colunas candidatas em mart_shared.
SELECT
  table_name,
  column_name,
  data_type
FROM `reise-ssot.mart_shared.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('fct_order', 'fct_order_item', 'canal_atribuicao_pedido_mirror')
  AND REGEXP_CONTAINS(
    LOWER(column_name),
    r'(utm|source|medium|campaign|canal|origem|channel|referr|ga4|gclid|fbclid|meta|crm|email|whatsapp|marketing)'
  )
ORDER BY table_name, column_name;

-- 2) Cobertura e classificacao por lancamento.
WITH modelos AS (
  SELECT
    'gt' AS modelo_id,
    'GT Collection' AS modelo,
    DATE('2025-12-17') AS d0,
    r'(^|[^a-z0-9])(gt collection|rs6 gt|knit gt|911 gt)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs6gt|knitgt|911gt)' AS sku_regex

  UNION ALL

  SELECT
    'avant' AS modelo_id,
    'Avant' AS modelo,
    DATE('2025-12-14') AS d0,
    r'(^|[^a-z0-9])(avant|rs8 avant|rs6 avant|rs7 avant)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs8avant|rs6avant|rs7avant)' AS sku_regex

  UNION ALL

  SELECT
    'phantom' AS modelo_id,
    'Phantom' AS modelo,
    DATE('2026-04-16') AS d0,
    r'(^|[^a-z0-9])(phantom|phantom slip|phantom easy|phantom knit)([^a-z0-9]|$)' AS termo_regex,
    r'^(phteasy|phtslip|phtknit|phantomslip|phantomeasy|phantomknit)' AS sku_regex

  UNION ALL

  SELECT
    'rs8_monochrome' AS modelo_id,
    'RS8 Avant Monochrome' AS modelo,
    DATE('2026-06-25') AS d0,
    r'(^|[^a-z0-9])(rs8 avant monochrome|monochrome|monocrome)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs8avantmc|rs8avantab|rs8avantct|rs8avantcf|rs8avantmono|rs8mono)' AS sku_regex

  UNION ALL

  SELECT
    'series_2' AS modelo_id,
    'Series 2' AS modelo,
    DATE('2026-07-16') AS d0,
    r'(^|[^a-z0-9])(series 2|series2|serie 2|rs8 avant whisky|rs8 avant off white|rs8 avant azul marinho|whisky|off white|azul marinho)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs8avant|series2|s2)' AS sku_regex
),
itens_lancamento AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0,
    CAST(i.order_sk AS STRING) AS order_sk,
    SUM(SAFE_CAST(i.line_gross_amount AS NUMERIC)) AS receita_bruta,
    COUNT(DISTINCT NULLIF(TRIM(CAST(i.sku AS STRING)), '')) AS skus_distintos
  FROM `reise-ssot.mart_shared.fct_order_item` i
  JOIN modelos m
    ON i.order_partition_date_brt BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)
   AND (
      REGEXP_CONTAINS(
        REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ''),
        m.sku_regex
      )
      OR REGEXP_CONTAINS(
        TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')),
        m.termo_regex
      )
    )
  WHERE i.is_valid_order = TRUE
    AND SAFE_CAST(i.quantity AS INT64) > 0
  GROUP BY m.modelo_id, m.modelo, m.d0, CAST(i.order_sk AS STRING)
),
pedidos AS (
  SELECT
    il.*,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_pedido,
    UPPER(TRIM(CAST(o.source_system AS STRING))) AS source_system,
    TO_JSON_STRING(o) AS order_json,
    canal_real.tipo AS tipo_mirror,
    canal_real.canal AS canal_mirror,
    canal_real.utm_source AS utm_source_mirror,
    canal_real.utm_medium AS utm_medium_mirror,
    canal_real.utm_campaign AS utm_campaign_mirror,
    canal_real.raw_channel AS raw_channel_mirror,
    canal_real.raw_source AS raw_source_mirror,
    canal_real.raw_medium AS raw_medium_mirror,
    canal_real.regra_atribuicao_real
  FROM itens_lancamento il
  LEFT JOIN `reise-ssot.core.order` o
    ON CAST(o.order_sk AS STRING) = il.order_sk
  LEFT JOIN `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror` canal_real
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
origem_raw AS (
  SELECT
    *,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      raw_channel_mirror,
      JSON_EXTRACT_SCALAR(order_json, '$.last_source_description'),
      JSON_EXTRACT_SCALAR(order_json, '$.last_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.referring_channel'),
      JSON_EXTRACT_SCALAR(order_json, '$.referringChannel'),
      JSON_EXTRACT_SCALAR(order_json, '$.marketing_channel'),
      JSON_EXTRACT_SCALAR(order_json, '$.marketingChannel'),
      JSON_EXTRACT_SCALAR(order_json, '$.order_channel'),
      JSON_EXTRACT_SCALAR(order_json, '$.orderChannel'),
      JSON_EXTRACT_SCALAR(order_json, '$.channel'),
      JSON_EXTRACT_SCALAR(order_json, '$.Channel'),
      JSON_EXTRACT_SCALAR(order_json, '$.chanel'),
      JSON_EXTRACT_SCALAR(order_json, '$.canal'),
      JSON_EXTRACT_SCALAR(order_json, '$.origem'),
      JSON_EXTRACT_SCALAR(order_json, '$.source_name'),
      JSON_EXTRACT_SCALAR(order_json, '$.sourceName'),
      JSON_EXTRACT_SCALAR(order_json, '$.source')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      utm_source_mirror,
      raw_source_mirror,
      JSON_EXTRACT_SCALAR(order_json, '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.utm_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.utmSource'),
      JSON_EXTRACT_SCALAR(order_json, '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(order_json, '$.session_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.traffic_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.acquisition_source'),
      JSON_EXTRACT_SCALAR(order_json, '$.source')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      utm_medium_mirror,
      raw_medium_mirror,
      JSON_EXTRACT_SCALAR(order_json, '$.last_utm_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.utm_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.utmMedium'),
      JSON_EXTRACT_SCALAR(order_json, '$.ga_session_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.gaSessionMedium'),
      JSON_EXTRACT_SCALAR(order_json, '$.session_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.traffic_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.acquisition_medium'),
      JSON_EXTRACT_SCALAR(order_json, '$.medium')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      utm_campaign_mirror,
      JSON_EXTRACT_SCALAR(order_json, '$.last_utm_campaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.utm_campaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.utmCampaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.ga_session_campaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.gaSessionCampaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.session_campaign'),
      JSON_EXTRACT_SCALAR(order_json, '$.campaign_name'),
      JSON_EXTRACT_SCALAR(order_json, '$.campaignName'),
      JSON_EXTRACT_SCALAR(order_json, '$.campaign')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(order_json, '$.last_source_type'),
      JSON_EXTRACT_SCALAR(order_json, '$.source_type'),
      JSON_EXTRACT_SCALAR(order_json, '$.sourceType'),
      JSON_EXTRACT_SCALAR(order_json, '$.channel_type'),
      JSON_EXTRACT_SCALAR(order_json, '$.channelType')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type
  FROM pedidos
),
origem_norm AS (
  SELECT
    *,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', '') AS raw_channel_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source, ''), NFD), r'\p{M}', '') AS raw_source_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', '') AS raw_medium_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(raw_channel, ''), ' ',
        COALESCE(raw_source, ''), ' ',
        COALESCE(raw_medium, ''), ' ',
        COALESCE(raw_campaign, ''), ' ',
        COALESCE(raw_source_type, '')
      ), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match
  FROM origem_raw
),
classificado AS (
  SELECT
    *,
    CASE
      WHEN tipo_mirror = 'paid' THEN 'paid'
      WHEN tipo_mirror IS NOT NULL THEN 'organic'
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'paid'
      ELSE 'organic'
    END AS tipo_estimado,
    ARRAY_TO_STRING(
      ARRAY(
        SELECT campo
        FROM UNNEST([
          STRUCT('raw_channel' AS campo, raw_channel AS valor),
          STRUCT('raw_source' AS campo, raw_source AS valor),
          STRUCT('raw_medium' AS campo, raw_medium AS valor),
          STRUCT('raw_campaign' AS campo, raw_campaign AS valor),
          STRUCT('raw_source_type' AS campo, raw_source_type AS valor)
        ])
        WHERE valor IS NOT NULL
      ),
      ', '
    ) AS campos_com_sinal
  FROM origem_norm
)
SELECT
  modelo_id,
  modelo,
  source_system,
  COALESCE(tipo_estimado, 'sem_sinal') AS tipo_estimado,
  COUNT(DISTINCT order_sk) AS pedidos,
  ROUND(SUM(receita_bruta), 2) AS receita_bruta,
  COUNTIF(campos_com_sinal IS NOT NULL AND campos_com_sinal != '') AS pedidos_com_algum_sinal,
  ARRAY_AGG(DISTINCT NULLIF(campos_com_sinal, '') IGNORE NULLS LIMIT 10) AS exemplos_campos_com_sinal,
  ARRAY_AGG(DISTINCT NULLIF(raw_channel, '') IGNORE NULLS LIMIT 10) AS exemplos_raw_channel,
  ARRAY_AGG(DISTINCT NULLIF(raw_source, '') IGNORE NULLS LIMIT 10) AS exemplos_raw_source,
  ARRAY_AGG(DISTINCT NULLIF(raw_medium, '') IGNORE NULLS LIMIT 10) AS exemplos_raw_medium,
  ARRAY_AGG(DISTINCT NULLIF(raw_campaign, '') IGNORE NULLS LIMIT 10) AS exemplos_raw_campaign,
  ARRAY_AGG(DISTINCT NULLIF(regra_atribuicao_real, '') IGNORE NULLS LIMIT 10) AS regras_atribuicao
FROM classificado
GROUP BY modelo_id, modelo, source_system, tipo_estimado
ORDER BY modelo_id, tipo_estimado, pedidos DESC;
