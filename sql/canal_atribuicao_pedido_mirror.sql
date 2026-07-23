-- Consulta de referencia - atribuicao real por pedido.
--
-- Objetivo:
-- inspecionar a atribuicao last-click que vive no dataset mart_growth_us (US).
-- Esta consulta nao cria tabela, nao cria view e nao grava em mart_shared.
--
-- Rodar a leitura em JOB LOCATION = US.
--
-- O dashboard nao depende de uma tabela mirror. O Apps Script executa uma
-- consulta equivalente em US e cruza o resultado em memoria com as vendas por
-- produto exportadas de mart_shared.

WITH
orders AS (
  SELECT
    NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(b.order_name AS STRING))), '') AS order_name,
    NULLIF(TRIM(CAST(b.customer_sk AS STRING)), '') AS customer_sk,
    LOWER(TRIM(b.email_norm)) AS email_norm,
    b.paid_date_brt,
    ROUND(CAST(b.total_amount AS NUMERIC), 2) AS total_amount
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers` b
  WHERE NULLIF(TRIM(CAST(b.source_order_id AS STRING)), '') IS NOT NULL
    AND b.paid_date_brt IS NOT NULL
    AND b.total_amount IS NOT NULL
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
    o.source_order_id,
    o.order_name,
    o.customer_sk,
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
    LOWER(TRIM(COALESCE(j.last_utm_medium, ''))) AS raw_medium
  FROM orders o
  LEFT JOIN journey j
    ON j.order_id = o.source_order_id
),
classified AS (
  SELECT
    source_order_id,
    order_name,
    customer_sk,
    email_norm,
    paid_date_brt,
    total_amount,
    CASE
      WHEN raw_channel IS NULL OR raw_channel = '' THEN 'Unattributed'
      WHEN raw_channel LIKE '%unknown%' THEN 'An Unknown Source'
      WHEN LOWER(TRIM(last_source_type)) = 'direct' OR raw_channel IN ('direct','(direct)') THEN 'Direct'
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
      WHEN LOWER(TRIM(last_source_type)) = 'direct' OR raw_channel IN ('direct','(direct)') THEN 'direct'
      WHEN raw_channel IS NULL OR raw_channel = '' THEN 'unknown'
      WHEN REGEXP_CONTAINS(raw_medium, r'(cpcp|cpc|ppc|pmax|paid|paidsocial|paid[_ -]?social|paidsearch|paid[_ -]?search|display|affiliate|affiliates|demand[_ -]?gen)') THEN 'paid'
      WHEN raw_medium IN ('organic','seo') THEN 'organic'
      WHEN raw_medium = '' AND REGEXP_CONTAINS(raw_channel, r'(google|bing|yahoo|duckduckgo|brave)') THEN 'organic'
      WHEN raw_medium = '' AND REGEXP_CONTAINS(raw_channel, r'(instagram|facebook|youtube|tiktok)') THEN 'organic'
      WHEN REGEXP_CONTAINS(raw_medium, r'(email|newsletter|crm|sms|whatsapp|disparo|grupos|canal[-_ ]de[-_ ]transmissao)')
        OR REGEXP_CONTAINS(raw_channel, r'(email|whatsapp|sms|rd station|rdstation)') THEN 'owned'
      WHEN raw_medium = 'referral'
        OR REGEXP_CONTAINS(raw_channel, r'(linktree|linktr\.ee|linktr|nextags|awin|cupomonline|br-desconto|chatgpt|perplexity)') THEN 'referral'
      ELSE 'unknown'
    END AS tipo
  FROM joined
)
SELECT
  source_order_id,
  order_name,
  customer_sk,
  email_norm,
  paid_date_brt,
  total_amount,
  canal,
  tipo,
  CASE
    WHEN source_order_id IS NOT NULL THEN 'source_order_id_last_click'
    WHEN order_name IS NOT NULL THEN 'order_name_last_click'
    ELSE 'email_data_valor_last_click'
  END AS regra_atribuicao_real
FROM classified
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY source_order_id
  ORDER BY canal, tipo
) = 1;
