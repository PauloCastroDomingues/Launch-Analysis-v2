-- ============================================================================
-- Pedidos por aquisicao: Midia paga x Organico puro -- ultimos 3 meses
-- Regra: aquisicao pura confirmada pelo usuario.
-- Job location: US.
--
-- Definicao:
--   - Midia paga: sinais de anuncio (cpc, pmax, paid, demand-gen, performance,
--     ads, display, source_type pago etc.).
--   - Organico: sinais organicos de busca/social/SEO.
--   - Direto, E-mail/CRM, WhatsApp, Outro atribuido e Nao atribuido ficam
--     separados em colunas de controle; nao entram em organico.
-- ============================================================================

DECLARE fuso_horario STRING DEFAULT 'America/Sao_Paulo';
DECLARE data_fim DATE DEFAULT CURRENT_DATE(fuso_horario);
DECLARE data_inicio DATE DEFAULT DATE_SUB(DATE_TRUNC(data_fim, MONTH), INTERVAL 2 MONTH);

WITH pedidos_validos AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(source_order_id AS STRING)), ''), LOWER(TRIM(CAST(order_name AS STRING)))) AS pedido_chave,
    LOWER(TRIM(CAST(order_name AS STRING))) AS order_name,
    NULLIF(TRIM(CAST(source_order_id AS STRING)), '') AS source_order_id,
    paid_date_brt,
    ROUND(SAFE_CAST(total_amount AS NUMERIC), 2) AS total_amount,
    dw_updated_at,
    TO_JSON_STRING(b) AS pedido_json
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers` AS b
  WHERE paid_date_brt BETWEEN data_inicio AND data_fim
    AND order_name IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY COALESCE(NULLIF(TRIM(CAST(source_order_id AS STRING)), ''), LOWER(TRIM(CAST(order_name AS STRING))))
    ORDER BY dw_updated_at DESC
  ) = 1
),
jornada AS (
  SELECT
    order_id,
    order_name,
    journey_ready,
    last_source,
    last_source_description,
    last_source_type,
    last_utm_source,
    last_utm_medium,
    last_utm_campaign,
    ingest_ts
  FROM `reise-ssot.mart_growth_us.shopify__orders_journey_latest_v`
),
base AS (
  SELECT
    p.*,
    j.order_id AS journey_order_id,
    j.order_name AS journey_order_name,
    j.journey_ready,
    j.ingest_ts AS journey_ingest_ts,
    (j.order_id IS NOT NULL OR j.order_name IS NOT NULL) AS tem_jornada,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_source_description,
      j.last_source,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_source_description'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.referring_channel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.referringChannel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.marketing_channel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.marketingChannel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.order_channel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.orderChannel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.channel'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.canal'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.origem'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.source_name'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.sourceName'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.landing_site'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.landingSite'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.referring_site'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.referringSite'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.source_url'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.sourceUrl')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_utm_source,
      j.last_source,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utm_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utmSource'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.session_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.traffic_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.acquisition_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.source'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last[_ -]?)?utm[_ -]?source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last)?utmsource"\s*:\s*"([^"]+)"')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_utm_source,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utm_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utmSource'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.session_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.traffic_source'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.acquisition_source'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last[_ -]?)?utm[_ -]?source"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last)?utmsource"\s*:\s*"([^"]+)"')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_utm_source,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_utm_medium,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_utm_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utm_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utmMedium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.ga_session_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.gaSessionMedium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.session_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.traffic_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.acquisition_medium'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.medium'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last[_ -]?)?utm[_ -]?medium"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last)?utmmedium"\s*:\s*"([^"]+)"')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_utm_campaign,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_utm_campaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utm_campaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.utmCampaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.ga_session_campaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.gaSessionCampaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.session_campaign'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.campaign_name'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.campaignName'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.campaign'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last[_ -]?)?utm[_ -]?campaign"\s*:\s*"([^"]+)"'),
      REGEXP_EXTRACT(LOWER(p.pedido_json), r'"(?:last)?utmcampaign"\s*:\s*"([^"]+)"')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,

    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      j.last_source_type,
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.last_source_type'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.source_type'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.sourceType'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.channel_type'),
      JSON_EXTRACT_SCALAR(p.pedido_json, '$.channelType')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type
  FROM pedidos_validos AS p
  LEFT JOIN jornada AS j
    ON (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_id, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_id), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(p.source_order_id, '')), r'[^a-z0-9]+', '')
    )
    OR (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_name, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_name), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(p.order_name, '')), r'[^a-z0-9]+', '')
    )
),
normalizado AS (
  SELECT
    *,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(raw_channel, ''), ' ', COALESCE(raw_utm_source, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS source_resolved_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(raw_channel, ''), ' ', COALESCE(raw_source, ''), ' ', COALESCE(raw_medium, ''), ' ', COALESCE(raw_campaign, ''), ' ', COALESCE(raw_source_type, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS attribution_signal_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS medium_match,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS channel_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source_type, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS source_type_key
  FROM base
),
classificado AS (
  SELECT
    *,
    CASE
      WHEN COALESCE(attribution_signal_match, '') = ''
        THEN 'Nao atribuido'
      WHEN REGEXP_CONTAINS(medium_match, r'(^| )(cpc|ppc|pmax|paid|paid social|paid search|paidsearch|paidsocial|display|cpm|cpv|shopping|performance|max performance|performance max|demand gen|demandgen|remarketing|retargeting|affiliate|affiliates|programmatic|sponsored|ad|ads)( |$)')
        OR source_type_key IN ('paid', 'advertising', 'ad', 'ads', 'paidsearch', 'paidsocial', 'paidshopping', 'paidmedia', 'paidother', 'paidvideo', 'paidreferral')
        OR REGEXP_CONTAINS(attribution_signal_match, r'(^| )(cpc|ppc|pmax|paid|paid social|paid search|paidsearch|paidsocial|display|cpm|cpv|shopping|performance|max performance|performance max|demand gen|demandgen|remarketing|retargeting|affiliate|affiliates|programmatic|sponsored|google ads|facebook ads|meta ads|instagram ads|tiktok ads|bing ads|microsoft ads|adwords|gads|googleadservices|gclid|fbclid)( |$)')
        THEN 'Midia paga'
      WHEN source_type_key = 'direct' OR channel_key = 'direct' OR (channel_key IN ('nenhum', 'none') AND COALESCE(raw_utm_source, '') = '')
        THEN 'Direto'
      WHEN source_type_key = 'email'
        OR REGEXP_CONTAINS(medium_match, r'(^| )(email|e mail|newsletter|crm)( |$)')
        OR REGEXP_CONTAINS(attribution_signal_match, r'(^| )(klaviyo|rd station|rdstation|shopify email|mailchimp)( |$)')
        THEN 'E-mail/CRM'
      WHEN REGEXP_CONTAINS(attribution_signal_match, r'(^| )(whatsapp|whats app|whtasapp|whats|wpp|wa|wa me|api whatsapp|wl co)( |$)')
        THEN 'WhatsApp'
      WHEN REGEXP_CONTAINS(medium_match, r'(^| )(organic|organic search|organic social|seo|bio)( |$)')
        OR source_type_key IN ('seo', 'search', 'social', 'organic')
        OR REGEXP_CONTAINS(attribution_signal_match, r'(^| )(google|bing|yahoo|duckduckgo|ecosia|instagram|facebook|tiktok|youtube|pinterest|linkedin)( |$)')
        THEN 'Organico'
      ELSE 'Outro atribuido'
    END AS canal_ssot
  FROM normalizado
),
classificado_tipo AS (
  SELECT
    *,
    CASE
      WHEN canal_ssot = 'Midia paga' THEN 'paid'
      WHEN canal_ssot = 'Organico' THEN 'organic'
      ELSE 'controle'
    END AS tipo_ssot
  FROM classificado
),
resumo_total AS (
  SELECT
    0 AS ordem,
    'TOTAL_3_MESES' AS periodo,
    data_inicio AS data_inicio_periodo,
    data_fim AS data_fim_periodo,
    COUNTIF(tipo_ssot = 'paid') AS pedidos_midia_paga,
    COUNTIF(tipo_ssot = 'organic') AS pedidos_organicos,
    ROUND(SUM(IF(tipo_ssot = 'paid', total_amount, NUMERIC '0')), 2) AS receita_midia_paga,
    ROUND(SUM(IF(tipo_ssot = 'organic', total_amount, NUMERIC '0')), 2) AS receita_organica,
    COUNT(*) AS pedidos_validos_total,
    COUNTIF(canal_ssot = 'Midia paga') AS pedidos_midia_paga_canal,
    COUNTIF(canal_ssot = 'Organico') AS pedidos_organico_canal,
    COUNTIF(canal_ssot = 'Direto') AS pedidos_direto,
    COUNTIF(canal_ssot = 'E-mail/CRM') AS pedidos_email_crm,
    COUNTIF(canal_ssot = 'WhatsApp') AS pedidos_whatsapp,
    COUNTIF(canal_ssot = 'Outro atribuido') AS pedidos_outro_atribuido,
    COUNTIF(canal_ssot = 'Nao atribuido') AS pedidos_nao_atribuidos,
    COUNTIF(tem_jornada) AS pedidos_com_jornada,
    COUNTIF(NOT tem_jornada) AS pedidos_sem_jornada,
    COUNTIF(COALESCE(attribution_signal_match, '') = '') AS pedidos_sem_sinal,
    ROUND(SUM(total_amount), 2) AS receita_pedidos_validos_total
  FROM classificado_tipo
),
resumo_mensal AS (
  SELECT
    1 AS ordem,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(paid_date_brt, MONTH)) AS periodo,
    DATE_TRUNC(paid_date_brt, MONTH) AS data_inicio_periodo,
    LEAST(LAST_DAY(DATE_TRUNC(paid_date_brt, MONTH), MONTH), data_fim) AS data_fim_periodo,
    COUNTIF(tipo_ssot = 'paid') AS pedidos_midia_paga,
    COUNTIF(tipo_ssot = 'organic') AS pedidos_organicos,
    ROUND(SUM(IF(tipo_ssot = 'paid', total_amount, NUMERIC '0')), 2) AS receita_midia_paga,
    ROUND(SUM(IF(tipo_ssot = 'organic', total_amount, NUMERIC '0')), 2) AS receita_organica,
    COUNT(*) AS pedidos_validos_total,
    COUNTIF(canal_ssot = 'Midia paga') AS pedidos_midia_paga_canal,
    COUNTIF(canal_ssot = 'Organico') AS pedidos_organico_canal,
    COUNTIF(canal_ssot = 'Direto') AS pedidos_direto,
    COUNTIF(canal_ssot = 'E-mail/CRM') AS pedidos_email_crm,
    COUNTIF(canal_ssot = 'WhatsApp') AS pedidos_whatsapp,
    COUNTIF(canal_ssot = 'Outro atribuido') AS pedidos_outro_atribuido,
    COUNTIF(canal_ssot = 'Nao atribuido') AS pedidos_nao_atribuidos,
    COUNTIF(tem_jornada) AS pedidos_com_jornada,
    COUNTIF(NOT tem_jornada) AS pedidos_sem_jornada,
    COUNTIF(COALESCE(attribution_signal_match, '') = '') AS pedidos_sem_sinal,
    ROUND(SUM(total_amount), 2) AS receita_pedidos_validos_total
  FROM classificado_tipo
  GROUP BY 1, 2, 3, 4
),
resumo AS (
  SELECT * FROM resumo_total
  UNION ALL
  SELECT * FROM resumo_mensal
)
SELECT
  periodo,
  data_inicio_periodo,
  data_fim_periodo,
  pedidos_midia_paga,
  pedidos_organicos,
  pedidos_midia_paga + pedidos_organicos AS pedidos_pago_mais_organico,
  ROUND(100 * SAFE_DIVIDE(pedidos_midia_paga, NULLIF(pedidos_midia_paga + pedidos_organicos, 0)), 2) AS pct_midia_paga_entre_pago_organico,
  ROUND(100 * SAFE_DIVIDE(pedidos_organicos, NULLIF(pedidos_midia_paga + pedidos_organicos, 0)), 2) AS pct_organico_entre_pago_organico,
  receita_midia_paga,
  receita_organica,
  receita_midia_paga + receita_organica AS receita_pago_mais_organico,
  pedidos_validos_total,
  pedidos_midia_paga_canal,
  pedidos_organico_canal,
  pedidos_direto,
  pedidos_email_crm,
  pedidos_whatsapp,
  pedidos_outro_atribuido,
  pedidos_nao_atribuidos,
  pedidos_com_jornada,
  pedidos_sem_jornada,
  pedidos_sem_sinal,
  ROUND(100 * SAFE_DIVIDE(pedidos_midia_paga + pedidos_organicos, NULLIF(pedidos_validos_total, 0)), 2) AS cobertura_pago_organico_pct,
  ROUND(100 * SAFE_DIVIDE(pedidos_com_jornada, NULLIF(pedidos_validos_total, 0)), 2) AS cobertura_jornada_pct,
  receita_pedidos_validos_total
FROM resumo
ORDER BY ordem, data_inicio_periodo;
