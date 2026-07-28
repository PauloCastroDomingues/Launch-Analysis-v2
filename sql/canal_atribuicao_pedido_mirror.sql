-- Canal attribution mirror for Launch Analysis v2.
--
-- Goal:
-- Build the southamerica-east1 table consumed by the dashboard pipeline:
--
--   reise-ssot.mart_shared.canal_atribuicao_pedido_mirror
--
-- Final join key:
--   email_norm + paid_date_brt + total_amount
--
-- Do not use order_id, order_name or customer_sk in the dashboard join. The
-- source_order_id below is used only inside the US source region to read the
-- last-click journey table before exporting the normalized mirror payload.
--
-- STEP 1 - run in BigQuery JOB LOCATION = US.
-- Replace the EXPORT DATA URI with a GCS bucket/path available to your project.

CREATE OR REPLACE TABLE `reise-ssot.mart_growth_us.canal_atribuicao_pedido_mirror_export`
PARTITION BY paid_date_brt
CLUSTER BY email_norm, total_amount AS
WITH
orders AS (
  SELECT
    NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), '') AS email_norm,
    b.paid_date_brt,
    ROUND(SAFE_CAST(b.total_amount AS NUMERIC), 2) AS total_amount,
    NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') AS source_order_id_for_us_journey
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers` b
  WHERE b.paid_date_brt IS NOT NULL
    AND b.total_amount IS NOT NULL
    AND NULLIF(LOWER(TRIM(CAST(b.email_norm AS STRING))), '') IS NOT NULL
),
journey AS (
  SELECT
    order_id,
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
    j.last_source,
    j.last_source_description,
    j.last_source_type,
    j.last_utm_source,
    j.last_utm_medium,
    j.last_utm_campaign,
    LOWER(TRIM(COALESCE(j.last_source_description, j.last_utm_source, j.last_source))) AS raw_channel,
    LOWER(TRIM(COALESCE(j.last_utm_medium, ''))) AS raw_medium,
    LOWER(TRIM(COALESCE(j.last_utm_source, ''))) AS raw_source
  FROM orders o
  LEFT JOIN journey j
    ON j.order_id = o.source_order_id_for_us_journey
),
classified AS (
  SELECT
    email_norm,
    paid_date_brt,
    total_amount,
    CASE
      WHEN raw_channel IS NULL OR raw_channel = '' THEN 'Unattributed'
      WHEN raw_channel LIKE '%unknown%' THEN 'An Unknown Source'
      WHEN LOWER(TRIM(last_source_type)) = 'direct' OR raw_channel IN ('direct', '(direct)') THEN 'Direct'
      WHEN raw_channel LIKE '%instagram%' THEN 'Instagram'
      WHEN raw_channel LIKE '%facebook%' THEN 'Facebook'
      WHEN raw_channel LIKE '%whatsapp%' THEN 'Whatsapp'
      WHEN raw_channel LIKE '%tiktok%' THEN 'Tiktok'
      WHEN raw_channel LIKE '%youtube%' THEN 'Youtube'
      WHEN raw_channel LIKE '%bing%' THEN 'Bing'
      WHEN raw_channel LIKE '%rd station%' OR raw_channel LIKE '%rdstation%' THEN 'Rd Station'
      WHEN raw_channel LIKE '%linktr%' THEN 'Linktr.Ee'
      WHEN raw_channel LIKE '%google%' THEN 'Google'
      ELSE INITCAP(raw_channel)
    END AS canal,
    CASE
      WHEN REGEXP_CONTAINS(raw_medium, r'(cpcp|cpc|ppc|pmax|paid|paidsocial|paid[_ -]?social|paidsearch|paid[_ -]?search|display|affiliate|affiliates|demand[_ -]?gen)') THEN 'paid'
      WHEN raw_medium = '' AND REGEXP_CONTAINS(raw_channel, r'(google|bing|yahoo!?|duckduckgo|brave)') THEN 'organic'
      WHEN raw_medium = '' AND REGEXP_CONTAINS(raw_channel, r'(instagram|facebook|youtube|tiktok)') THEN 'organic'
      WHEN raw_medium IN ('organic', 'seo') THEN 'organic'
      WHEN LOWER(TRIM(last_source_type)) = 'direct' OR raw_channel IN ('direct', '(direct)') THEN 'direct'
      WHEN raw_channel IS NULL OR raw_channel = '' THEN 'unknown'
      WHEN REGEXP_CONTAINS(raw_medium, r'(email|newsletter|crm|sms|whatsapp|disparo|grupos|canal[-_ ]de[-_ ]transmissao)')
        OR REGEXP_CONTAINS(raw_channel, r'(email|whatsapp|sms|rd station|rdstation)') THEN 'owned'
      WHEN raw_medium = 'referral'
        OR REGEXP_CONTAINS(CONCAT(raw_channel, ' ', raw_source), r'(linktree|linktr\.ee|linktr|nextags|awin|cupomonline|br-desconto|chatgpt|chatgpt\.com|perplexity)') THEN 'referral'
      ELSE 'unknown'
    END AS tipo
  FROM joined
)
SELECT
  email_norm,
  paid_date_brt,
  total_amount,
  canal,
  tipo,
  'email_data_valor_last_click_mirror' AS regra_atribuicao_real
FROM classified
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY email_norm, paid_date_brt, total_amount
  ORDER BY
    CASE tipo
      WHEN 'paid' THEN 1
      WHEN 'organic' THEN 2
      WHEN 'owned' THEN 3
      WHEN 'referral' THEN 4
      WHEN 'direct' THEN 5
      WHEN 'unknown' THEN 6
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
  canal,
  tipo,
  regra_atribuicao_real
FROM `reise-ssot.mart_growth_us.canal_atribuicao_pedido_mirror_export`;

-- STEP 2 - run in BigQuery JOB LOCATION = southamerica-east1.
-- Use the same GCS URI exported above.

CREATE OR REPLACE TABLE `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror` (
  email_norm STRING,
  paid_date_brt DATE,
  total_amount NUMERIC,
  canal STRING,
  tipo STRING,
  regra_atribuicao_real STRING
)
PARTITION BY paid_date_brt
CLUSTER BY email_norm, total_amount;

LOAD DATA OVERWRITE `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror`
FROM FILES (
  format = 'PARQUET',
  uris = ['gs://REPLACE_ME/canal_atribuicao_pedido_mirror/*.parquet']
);
