-- Auditoria - produtos aprovados vs atribuicao paga/organica.
--
-- Objetivo:
-- validar se os produtos dos lancamentos vendidos em pedidos aprovados
-- conseguem ser reconciliados com atribuicao real de canal.
--
-- Fontes:
-- - mart_shared.fct_order_item: item/produto vendido; regra oficial is_valid_order = TRUE.
-- - mart_shared.orders_all_valid_no_migracao: pedido aprovado/valido.
-- - mart_shared.canal_atribuicao_pedido_mirror: canal/tipo last-click por pedido.
-- - mart_financeiro.payment_gateway_transactions_unified_v: status do gateway, quando disponivel.
--
-- Resultado:
-- 1) resumo por lancamento
-- 2) amostra de pedidos aprovados sem atribuicao de canal
--
-- Leitura:
-- - pedidos_aprovados_ssot: pedidos validos com itens classificados no lancamento.
-- - pedidos_com_atribuicao: pedidos que bateram na mirror de canal.
-- - cobertura_atribuicao_pct perto de 1 indica que pago/organico/direct/unknown
--   estao reconciliados no universo de pedidos aprovados.
-- - pedidos_gateway_* ajuda a comparar aprovacao do SSOT com eventos financeiros.

CREATE TEMP TABLE auditoria_atribuicao_enriquecido AS
WITH
modelos AS (
  SELECT
    modelo_id,
    modelo,
    DATE(day_zero_base) AS d0,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', '') AS sku_prefixos_compact,
    CASE
      WHEN modelo_id = 'series_2' THEN 0
      WHEN modelo_id = 'rs8_monochrome' THEN 1
      WHEN modelo_id = 'phantom' THEN 2
      WHEN modelo_id = 'gt' THEN 3
      WHEN modelo_id = 'avant' THEN 4
      ELSE 99
    END AS prioridade_modelo
  FROM `reise-ssot.mart_shared.linha_cadastro`
  WHERE LOWER(status) IN ('historico', 'ativo')
    AND day_zero_base IS NOT NULL
),
canal AS (
  SELECT
    NULLIF(TRIM(CAST(source_order_id AS STRING)), '') AS source_order_id_norm,
    NULLIF(LOWER(TRIM(CAST(order_name AS STRING))), '') AS order_name_norm,
    LOWER(TRIM(email_norm)) AS email_norm,
    paid_date_brt,
    ROUND(CAST(total_amount AS NUMERIC), 2) AS total_amount,
    ARRAY_AGG(canal IGNORE NULLS ORDER BY canal LIMIT 1)[SAFE_OFFSET(0)] AS canal_real,
    ARRAY_AGG(tipo IGNORE NULLS ORDER BY canal LIMIT 1)[SAFE_OFFSET(0)] AS tipo_real,
    ARRAY_AGG(regra_atribuicao_real IGNORE NULLS ORDER BY regra_atribuicao_real LIMIT 1)[SAFE_OFFSET(0)] AS regra_atribuicao_real
  FROM `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror`
  WHERE NULLIF(TRIM(CAST(source_order_id AS STRING)), '') IS NOT NULL
    OR (
      email_norm IS NOT NULL
      AND paid_date_brt IS NOT NULL
      AND total_amount IS NOT NULL
    )
  GROUP BY 1,2,3,4,5
),
gateway AS (
  SELECT
    NULLIF(TRIM(CAST(order_reference AS STRING)), '') AS order_reference_norm,
    ARRAY_AGG(status_group IGNORE NULLS ORDER BY
      CASE status_group
        WHEN 'approved' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'cancelled' THEN 3
        ELSE 9
      END
      LIMIT 1
    )[SAFE_OFFSET(0)] AS gateway_status_group,
    ARRAY_AGG(gateway IGNORE NULLS ORDER BY gateway LIMIT 1)[SAFE_OFFSET(0)] AS gateway
  FROM `reise-ssot.mart_financeiro.payment_gateway_transactions_unified_v`
  WHERE NULLIF(TRIM(CAST(order_reference AS STRING)), '') IS NOT NULL
  GROUP BY 1
),
itens_base AS (
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
    NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '') AS order_name,
    LOWER(TRIM(CAST(o.customer_email AS STRING))) AS email_norm,
    DATE(o.paid_at, 'America/Sao_Paulo') AS paid_date_brt,
    ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2) AS total_amount,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  JOIN `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
    ON CAST(o.order_sk AS STRING) = CAST(i.order_sk AS STRING)
  WHERE i.is_valid_order = TRUE
    AND SAFE_CAST(i.quantity AS INT64) > 0
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos), INTERVAL 90 DAY)
),
candidatos AS (
  SELECT
    i.*,
    m.modelo_id,
    m.modelo,
    m.d0,
    DATE_DIFF(i.data, m.d0, DAY) AS dia_desde_d0,
    m.prioridade_modelo
  FROM itens_base i
  JOIN modelos m
    ON i.data BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)
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
            CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(termo), r'\s+', r'\\s+'), r'([^a-z0-9]|$)')
          )
      )
    )
),
classificados AS (
  SELECT *
  FROM candidatos
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_sk, line_item_key
    ORDER BY prioridade_modelo, d0 DESC, modelo_id
  ) = 1
),
enriquecido AS (
  SELECT
    c.*,
    canal.canal_real,
    canal.tipo_real,
    canal.regra_atribuicao_real,
    gateway.gateway,
    gateway.gateway_status_group
  FROM classificados c
  LEFT JOIN canal
    ON (
      canal.source_order_id_norm IS NOT NULL
      AND canal.source_order_id_norm IN (c.source_order_id, c.order_sk)
    )
    OR (
      canal.source_order_id_norm IS NULL
      AND canal.order_name_norm IS NOT NULL
      AND canal.order_name_norm = c.order_name
    )
    OR (
      canal.source_order_id_norm IS NULL
      AND canal.order_name_norm IS NULL
      AND canal.email_norm = c.email_norm
      AND canal.paid_date_brt = c.paid_date_brt
      AND canal.total_amount = c.total_amount
    )
  LEFT JOIN gateway
    ON gateway.order_reference_norm IN (c.source_order_id, c.order_name, c.order_sk)
)
SELECT *
FROM enriquecido;

SELECT
  modelo_id,
  modelo,
  MIN(d0) AS d0,
  COUNT(DISTINCT order_sk) AS pedidos_aprovados_ssot,
  COUNT(DISTINCT IF(tipo_real IS NOT NULL, order_sk, NULL)) AS pedidos_com_atribuicao,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(tipo_real IS NOT NULL, order_sk, NULL)),
    NULLIF(COUNT(DISTINCT order_sk), 0)
  ) AS cobertura_atribuicao_pct,
  COUNT(DISTINCT IF(tipo_real = 'paid', order_sk, NULL)) AS pedidos_pagos_mkt,
  COUNT(DISTINCT IF(tipo_real = 'organic', order_sk, NULL)) AS pedidos_organicos,
  COUNT(DISTINCT IF(tipo_real = 'direct', order_sk, NULL)) AS pedidos_direct,
  COUNT(DISTINCT IF(tipo_real = 'unknown', order_sk, NULL)) AS pedidos_unknown,
  COUNT(DISTINCT IF(tipo_real IS NULL, order_sk, NULL)) AS pedidos_sem_atribuicao,
  COUNT(DISTINCT IF(gateway_status_group IS NOT NULL, order_sk, NULL)) AS pedidos_com_gateway,
  COUNT(DISTINCT IF(gateway_status_group = 'approved', order_sk, NULL)) AS pedidos_gateway_aprovados,
  COUNT(DISTINCT IF(gateway_status_group = 'pending', order_sk, NULL)) AS pedidos_gateway_pendentes,
  COUNT(DISTINCT IF(gateway_status_group = 'cancelled', order_sk, NULL)) AS pedidos_gateway_cancelados,
  ROUND(SUM(receita_bruta), 2) AS receita_aprovada_ssot,
  ROUND(SUM(IF(tipo_real = 'paid', receita_bruta, 0)), 2) AS receita_paga_mkt,
  ROUND(SUM(IF(tipo_real = 'organic', receita_bruta, 0)), 2) AS receita_organica,
  ROUND(SUM(IF(tipo_real IN ('direct', 'unknown'), receita_bruta, 0)), 2) AS receita_nao_paga_atribuida,
  ROUND(SUM(IF(tipo_real IS NULL, receita_bruta, 0)), 2) AS receita_sem_atribuicao,
  ARRAY_AGG(DISTINCT regra_atribuicao_real IGNORE NULLS ORDER BY regra_atribuicao_real) AS regras_atribuicao_usadas,
  ARRAY_AGG(DISTINCT gateway IGNORE NULLS ORDER BY gateway) AS gateways_encontrados
FROM auditoria_atribuicao_enriquecido
GROUP BY modelo_id, modelo
ORDER BY d0, modelo_id;

SELECT
  modelo_id,
  modelo,
  data,
  source_order_id,
  order_name,
  email_norm,
  total_amount,
  sku,
  item_name,
  receita_bruta
FROM auditoria_atribuicao_enriquecido
WHERE tipo_real IS NULL
ORDER BY data DESC, modelo_id
LIMIT 200;
