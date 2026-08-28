-- LEGADO - Growth / Marketing (US) - atribuicao Shopify last-click por pedido.
-- Rode em JOB LOCATION = US.
--
-- Este arquivo fica apenas como referencia historica da classificacao de canal
-- dentro de mart_growth_us.
--
-- Contrato atual do dashboard:
--   1) gerar a mirror em sql/canal_atribuicao_pedido_mirror.sql;
--   2) carregar mart_shared.canal_atribuicao_pedido_mirror em southamerica-east1;
--   3) cruzar por source_order_id/order_id ou order_name;
--   4) classificar como organico apenas nas combinacoes definidas pelo usuario;
--      todo restante fica paid.

WITH
buyers AS (
  SELECT
    customer_sk,
    MIN(paid_date_brt) AS first_paid_date_brt
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers`
  GROUP BY 1
),
orders AS (
  SELECT
    b.paid_date_brt AS data,
    b.order_name,
    b.source_order_id,
    b.customer_sk,
    b.total_amount,
    IF(b.paid_date_brt = buyers.first_paid_date_brt, 1, 0) AS is_new
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers` b
  LEFT JOIN buyers USING (customer_sk)
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
    o.data,
    o.order_name,
    o.source_order_id,
    o.total_amount,
    o.is_new,

    j.last_source,
    j.last_source_description,
    j.last_source_type,
    j.last_utm_source,
    j.last_utm_medium,
    j.last_utm_campaign,

    LOWER(TRIM(COALESCE(j.last_source_description, j.last_source))) AS raw_channel,
    LOWER(TRIM(COALESCE(j.last_utm_source, ''))) AS raw_utm_source,
    LOWER(TRIM(COALESCE(j.last_utm_medium, ''))) AS raw_medium
  FROM orders o
  LEFT JOIN journey j
    ON j.order_id = o.source_order_id
),
normalized AS (
  SELECT
    data,
    order_name,
    source_order_id,
    total_amount,
    is_new,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_channel_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_utm_source, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_utm_source_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS raw_medium_key,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(raw_channel, ''), ' ', COALESCE(raw_utm_source, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS source_resolved_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(raw_channel, ''), ' ', COALESCE(raw_utm_source, ''), ' ', COALESCE(raw_medium, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS origem_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS raw_medium_match
  FROM joined
),
classified_base AS (
  SELECT
    *,
    CASE
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(instagram|facebook|meta)') AND REGEXP_CONTAINS(origem_match, r'(^| )(cpc|pmax|paid|performance)( |$)') THEN 'Meta ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|doubleclick|adwords|youtube|(^| )yt( |$))') AND REGEXP_CONTAINS(origem_match, r'(^| )(cpc|pmax|paid|pago|shopping|display|performance|ads)( |$)') THEN 'Google ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') AND REGEXP_CONTAINS(raw_medium_match, r'grupo.*vip') THEN 'WhatsApp Nao Oficial'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') THEN 'WhatsApp Oficial'
      WHEN REGEXP_CONTAINS(origem_match, r'(email|e mail|mail)') THEN 'E-mail'
      WHEN raw_channel_key IN ('', 'nenhum', 'none', 'direct') THEN 'Direto'
      WHEN raw_medium_key = 'bio' THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(facebook|instagram|tiktok|youtube|linktr|shareable)') THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|bing|duckduckgo|yahoo|brave|ecosia)') THEN 'Organico'
      ELSE 'Outros'
    END AS canal
  FROM normalized
),
classified AS (
  SELECT
    *,
    CASE
      WHEN canal IN ('Meta ADS', 'Google ADS', 'WhatsApp Oficial') THEN 'paid'
      ELSE 'organic'
    END AS tipo
  FROM classified_base
)
SELECT
  data,
  order_name,
  source_order_id,
  canal,
  tipo,
  CAST(total_amount AS NUMERIC) AS receita_pedido,
  is_new
FROM classified;
