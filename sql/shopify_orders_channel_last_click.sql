-- Growth / Marketing (US) - atribuicao Shopify last-click por pedido.
-- Rode em JOB LOCATION = US.
--
-- Esta view expõe o grao por pedido para permitir o cruzamento posterior com
-- os itens classificados por lancamento. Antes de automatizar o join final,
-- valide no BigQuery se lancamentos_produtos_dia/fct_order_item traz order_name
-- ou se sera necessario ligar order_sk via mart_growth_us.bridge_orders_customers.

CREATE OR REPLACE VIEW `reise-ssot.mart_growth_us.shopify_orders_channel_last_click_v` AS
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

    LOWER(TRIM(COALESCE(j.last_source_description, j.last_utm_source, j.last_source))) AS raw_channel,
    LOWER(TRIM(COALESCE(j.last_utm_medium, ''))) AS raw_medium
  FROM orders o
  LEFT JOIN journey j
    ON j.order_id = o.source_order_id
),
classified AS (
  SELECT
    data,
    order_name,
    source_order_id,
    total_amount,
    is_new,

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
      WHEN raw_medium IN ('organic','seo') THEN 'organic'
      WHEN raw_medium IN ('cpc','ppc','paid','paid_social','paidsearch','display','affiliate','affiliates') THEN 'paid'
      WHEN raw_medium IN ('email','newsletter','crm','sms','whatsapp') THEN 'paid'
      WHEN raw_channel LIKE '%google%' AND raw_medium = '' AND LOWER(TRIM(last_source_type)) IN ('search','referring_site') THEN 'organic'
      ELSE 'unknown'
    END AS tipo
  FROM joined
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
