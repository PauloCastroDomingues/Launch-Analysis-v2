-- Diagnostico de atribuicao real por origem para Avant e GT.
--
-- Objetivo:
-- Verificar se os pedidos antigos de Avant/GT estao vindo de SHOPIFY ou SHOPPUB
-- e onde a chave de atribuicao por canal deixa de casar:
-- email normalizado + data do pedido + valor total.
--
-- Rode em BigQuery com JOB LOCATION = southamerica-east1.

WITH modelos AS (
  SELECT
    'avant' AS modelo_id,
    'Avant' AS modelo,
    DATE('2025-12-14') AS d0,
    r'(^|[^a-z0-9])(avant|rs8 avant|rs6 avant|rs7 avant)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs8avant|rs6avant|rs7avant)' AS sku_regex

  UNION ALL

  SELECT
    'gt' AS modelo_id,
    'GT Collection' AS modelo,
    DATE('2025-12-17') AS d0,
    r'(^|[^a-z0-9])(gt collection|rs6 gt|knit gt|911 gt)([^a-z0-9]|$)' AS termo_regex,
    r'^(rs6gt|knitgt|911gt)' AS sku_regex
),
itens AS (
  SELECT
    m.modelo_id,
    m.modelo,
    CAST(i.order_sk AS STRING) AS order_sk,
    UPPER(TRIM(CAST(o.source_system AS STRING))) AS source_system,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_pedido,
    o.paid_at,
    o.created_at,
    NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '') AS email_norm,
    ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2) AS total_amount,
    canal_real.canal AS canal_real,
    canal_real.tipo AS tipo_real,
    REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  JOIN `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
    ON CAST(o.order_sk AS STRING) = CAST(i.order_sk AS STRING)
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
  LEFT JOIN `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror` canal_real
    ON canal_real.email_norm = NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '')
   AND canal_real.paid_date_brt = DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo')
   AND canal_real.total_amount = ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2)
  WHERE i.is_valid_order = TRUE
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
pedido_modelo AS (
  SELECT
    modelo_id,
    modelo,
    order_sk,
    ANY_VALUE(source_system) AS source_system,
    ANY_VALUE(data_pedido) AS data_pedido,
    COUNTIF(paid_at IS NULL) > 0 AS sem_paid_at,
    COUNTIF(created_at IS NULL) > 0 AS sem_created_at,
    COUNTIF(email_norm IS NULL) > 0 AS sem_email,
    COUNTIF(total_amount IS NULL) > 0 AS sem_total_amount,
    ARRAY_AGG(canal_real IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS canal_real,
    ARRAY_AGG(tipo_real IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS tipo_real
  FROM itens
  GROUP BY modelo_id, modelo, order_sk
)
SELECT
  modelo_id,
  modelo,
  COALESCE(source_system, 'SEM_SOURCE_SYSTEM') AS source_system,
  COUNT(*) AS pedidos,
  COUNTIF(sem_paid_at) AS pedidos_sem_paid_at,
  COUNTIF(sem_created_at) AS pedidos_sem_created_at,
  COUNTIF(sem_email) AS pedidos_sem_email,
  COUNTIF(sem_total_amount) AS pedidos_sem_total_amount,
  COUNTIF(tipo_real IS NOT NULL) AS pedidos_com_atribuicao,
  COUNTIF(tipo_real = 'paid') AS pedidos_pagos,
  COUNTIF(tipo_real = 'organic') AS pedidos_organicos,
  0 AS pedidos_crm,
  COUNTIF(tipo_real IS NOT NULL AND tipo_real NOT IN ('paid', 'organic')) AS pedidos_outros,
  COUNTIF(tipo_real IS NULL) AS pedidos_sem_atribuicao,
  SAFE_DIVIDE(COUNTIF(tipo_real IS NOT NULL), COUNT(*)) AS cobertura_atribuicao
FROM pedido_modelo
GROUP BY modelo_id, modelo, source_system
ORDER BY modelo_id, source_system;
