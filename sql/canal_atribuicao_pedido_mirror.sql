-- Canal attribution mirror for Launch Analysis v2.
--
-- Goal:
-- Build the southamerica-east1 table consumed by the dashboard pipeline:
--
--   reise-ssot.mart_shared.canal_atribuicao_pedido_mirror
--
-- Final join key:
--   source_order_id/order_id when available; fallback only to order_name.
--   Do not join journey attribution by email/date/value.
-- Channel rule:
--   The SSOT classifies each order into 9 channels, then derives paid/organic.
--   Paid: Meta ADS, Google ADS, WhatsApp Oficial.
--   Organic: WhatsApp Nao Oficial, E-mail, Direto, Social, Organico, Outros.
--
-- Reversibility:
--   The Apps Script only consumes this table when
--   ATRIBUICAO_REAL_CANAL_ENABLED is not false. Set that Script Property to
--   false to return the export to the previous state without dropping this
--   table.
--
-- Do not expose order_id, order_name or customer_sk in the public dashboard
-- payload. source_order_id can be mirrored into mart_shared as an internal join
-- key. email/date/value is retained only as audit context, not as join key.
--
-- STEP 1 - run in BigQuery JOB LOCATION = US.
-- Replace the EXPORT DATA URI with a GCS bucket/path available to your project.

CREATE OR REPLACE TABLE `reise-ssot.mart_growth_us.canal_atribuicao_pedido_mirror_export`
PARTITION BY paid_date_brt
CLUSTER BY email_norm, total_amount AS
WITH
janelas AS (
  SELECT DATE('2025-12-14') AS data_inicio, DATE('2026-03-14') AS data_fim
  UNION ALL SELECT DATE('2025-12-17'), DATE('2026-03-17')
  UNION ALL SELECT DATE('2026-04-16'), DATE('2026-07-15')
  UNION ALL SELECT DATE('2026-06-25'), DATE('2026-09-23')
  UNION ALL SELECT DATE('2026-07-16'), DATE('2026-10-14')
),
orders AS (
  SELECT
    NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), '') AS email_norm,
    b.paid_date_brt,
    ROUND(SAFE_CAST(b.total_amount AS NUMERIC), 2) AS total_amount,
    NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') AS source_order_id_for_us_journey,
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
        COALESCE(
          NULLIF(TRIM(CAST(b.source_order_id AS STRING)), ''),
          NULLIF(LOWER(TRIM(CAST(b.order_name AS STRING))), '')
        )
    ) AS pedidos_na_chave
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers` b
  WHERE b.paid_date_brt IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM janelas janela
      WHERE b.paid_date_brt BETWEEN janela.data_inicio AND janela.data_fim
    )
    AND (
      NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') IS NOT NULL
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
  FROM `reise-ssot.mart_growth_us.shopify__orders_journey_latest_v`
),
joined AS (
  SELECT
    o.email_norm,
    o.paid_date_brt,
    o.total_amount,
    o.source_order_id_for_us_journey AS source_order_id,
    o.order_name,
    j.last_source,
    j.last_source_description,
    j.last_source_type,
    j.last_utm_source,
    j.last_utm_medium,
    j.last_utm_campaign,
    o.pedidos_na_chave,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_source_description, j.last_source, o.direct_channel]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_medium]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_source, j.last_source, o.direct_source]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_source]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_utm_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_utm_campaign]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([j.last_source_type]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type,
    CASE
      WHEN j.order_id IS NOT NULL OR j.order_name IS NOT NULL THEN 'shopify_journey_latest_v'
      ELSE 'sem_journey_regra_usuario'
    END AS origem_atribuicao
  FROM orders o
  LEFT JOIN journey j
    ON (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_id, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_id), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(o.source_order_id_for_us_journey, '')), r'[^a-z0-9]+', '')
    )
    OR (
      REGEXP_REPLACE(LOWER(COALESCE(j.order_name, '')), r'[^a-z0-9]+', '') != ''
      AND REGEXP_REPLACE(LOWER(j.order_name), r'[^a-z0-9]+', '') = REGEXP_REPLACE(LOWER(COALESCE(o.order_name, '')), r'[^a-z0-9]+', '')
    )
),
normalized AS (
  SELECT
    *,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', '') AS raw_channel_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source, ''), NFD), r'\p{M}', '') AS raw_source_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', '') AS raw_medium_match,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_channel_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_utm_source, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_utm_source_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_medium_key,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(raw_channel, ''), ' ', COALESCE(raw_utm_source, '')), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS source_resolved_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(raw_channel, ''), ' ',
        COALESCE(raw_utm_source, ''), ' ',
        COALESCE(raw_medium, '')
      ), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS attribution_signal_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_campaign, ''), NFD), r'\p{M}', '') AS raw_campaign_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source_type, ''), NFD), r'\p{M}', '') AS raw_source_type_match,
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
  FROM joined
),
classified AS (
  SELECT
    email_norm,
    paid_date_brt,
    total_amount,
    source_order_id,
    order_name,
    raw_utm_source AS utm_source,
    COALESCE(NULLIF(TRIM(CAST(last_utm_medium AS STRING)), ''), raw_medium) AS utm_medium,
    COALESCE(NULLIF(TRIM(CAST(last_utm_campaign AS STRING)), ''), raw_campaign) AS utm_campaign,
    raw_channel,
    raw_medium,
    raw_source,
    raw_campaign,
    raw_source_type,
    pedidos_na_chave,
    origem_atribuicao,
    CASE
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(instagram|facebook|meta)') AND REGEXP_CONTAINS(attribution_signal_match, r'(^| )(cpc|pmax|paid|performance)( |$)') THEN 'Meta ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|doubleclick|adwords|youtube|(^| )yt( |$))') AND REGEXP_CONTAINS(attribution_signal_match, r'(^| )(cpc|pmax|paid|pago|shopping|display|performance|ads)( |$)') THEN 'Google ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') AND REGEXP_CONTAINS(raw_medium_match, r'grupo.*vip') THEN 'WhatsApp Nao Oficial'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') THEN 'WhatsApp Oficial'
      WHEN REGEXP_CONTAINS(attribution_signal_match, r'(email|e mail|mail)') THEN 'E-mail'
      WHEN raw_channel_key IN ('', 'nenhum', 'none', 'direct') THEN 'Direto'
      WHEN raw_medium_key = 'bio' THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(facebook|instagram|tiktok|youtube|linktr|shareable)') THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|bing|duckduckgo|yahoo|brave|ecosia)') THEN 'Organico'
      ELSE 'Outros'
    END AS canal,
    CASE
      WHEN (
        CASE
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(instagram|facebook|meta)') AND REGEXP_CONTAINS(attribution_signal_match, r'(^| )(cpc|pmax|paid|performance)( |$)') THEN 'Meta ADS'
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|doubleclick|adwords|youtube|(^| )yt( |$))') AND REGEXP_CONTAINS(attribution_signal_match, r'(^| )(cpc|pmax|paid|pago|shopping|display|performance|ads)( |$)') THEN 'Google ADS'
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') AND REGEXP_CONTAINS(raw_medium_match, r'grupo.*vip') THEN 'WhatsApp Nao Oficial'
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') THEN 'WhatsApp Oficial'
          WHEN REGEXP_CONTAINS(attribution_signal_match, r'(email|e mail|mail)') THEN 'E-mail'
          WHEN raw_channel_key IN ('', 'nenhum', 'none', 'direct') THEN 'Direto'
          WHEN raw_medium_key = 'bio' THEN 'Social'
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(facebook|instagram|tiktok|youtube|linktr|shareable)') THEN 'Social'
          WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|bing|duckduckgo|yahoo|brave|ecosia)') THEN 'Organico'
          ELSE 'Outros'
        END
      ) IN ('Meta ADS', 'Google ADS', 'WhatsApp Oficial') THEN 'paid'
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
  PARTITION BY COALESCE(source_order_id, order_name)
  ORDER BY
    CASE tipo
      WHEN 'paid' THEN 1
      WHEN 'organic' THEN 2
      ELSE 99
    END,
    canal
) = 1;

EXPORT DATA OPTIONS (
  uri = 'gs://REPLACE_ME/canal_atribuicao_pedido_mirror/*.parquet',
  format = 'PARQUET',
  overwrite = true
) AS
SELECT
  email_norm,
  paid_date_brt,
  total_amount,
  source_order_id,
  order_name,
  canal,
  tipo,
  grupo_canal,
  utm_source,
  utm_medium,
  utm_campaign,
  raw_channel,
  raw_medium,
  raw_source,
  pedidos_na_chave,
  regra_atribuicao_real
FROM `reise-ssot.mart_growth_us.canal_atribuicao_pedido_mirror_export`;

-- STEP 2 - run in BigQuery JOB LOCATION = southamerica-east1.
-- Use the same GCS URI exported above.

CREATE OR REPLACE TABLE `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror` (
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
CLUSTER BY email_norm, total_amount;

LOAD DATA OVERWRITE `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror`
FROM FILES (
  format = 'PARQUET',
  uris = ['gs://REPLACE_ME/canal_atribuicao_pedido_mirror/*.parquet']
);
