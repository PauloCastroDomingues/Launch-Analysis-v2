-- Auditoria historica GT + Avant
-- Fonte canonica: reise-ssot.core.order_item + reise-ssot.core.order
-- Regra principal: somente pedidos validos (o.is_valid_order = TRUE).
-- Objetivo: recalcular as janelas D0, D7, D15, D30, D60 e D90 usadas como
-- benchmark historico no dashboard.

WITH modelos AS (
  SELECT 'gt' AS modelo_id, 'GT Collection' AS modelo, r'gt' AS match_regex
  UNION ALL
  SELECT 'avant' AS modelo_id, 'Avant' AS modelo, r'avant' AS match_regex
), vendas AS (
  SELECT
    m.modelo_id,
    m.modelo,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_venda,
    CAST(o.order_name AS STRING) AS pedido,
    CAST(o.source_order_id AS STRING) AS pedido_id_shopify,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS titulo_produto,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(i.unit_price AS NUMERIC) AS preco_unitario,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS valor_bruto_item,
    SAFE_CAST(i.line_discount_amount AS NUMERIC) AS desconto_item,
    SAFE_CAST(
      COALESCE(
        i.line_net_amount,
        i.line_gross_amount - IFNULL(i.line_discount_amount, 0)
      ) AS NUMERIC
    ) AS valor_liquido_item,
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\pM', ''),
      r'[^a-z0-9]+',
      ' '
    )) AS item_name_norm
  FROM `reise-ssot.core.order_item` i
  JOIN `reise-ssot.core.order` o
    ON o.order_sk = i.order_sk
  CROSS JOIN modelos m
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND SAFE_CAST(i.quantity AS INT64) > 0
    AND REGEXP_CONTAINS(
      REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(i.item_name, NFD), r'\pM', ''),
      m.match_regex
    )
), primeira_venda AS (
  SELECT
    modelo_id,
    modelo,
    MIN(data_venda) AS data_primeira_venda
  FROM vendas
  GROUP BY 1, 2
), janelas AS (
  SELECT 'D0' AS periodo, 0 AS dias UNION ALL
  SELECT 'D7', 7 UNION ALL
  SELECT 'D15', 15 UNION ALL
  SELECT 'D30', 30 UNION ALL
  SELECT 'D60', 60 UNION ALL
  SELECT 'D90', 90
)
SELECT
  p.modelo_id,
  p.modelo,
  j.periodo,
  p.data_primeira_venda,
  DATE_ADD(p.data_primeira_venda, INTERVAL j.dias DAY) AS data_limite,
  COUNT(DISTINCT v.pedido) AS pedidos,
  SUM(v.quantidade) AS pares_vendidos,
  ROUND(SUM(v.valor_liquido_item), 2) AS receita_liquida_itens,
  ROUND(SAFE_DIVIDE(SUM(v.valor_liquido_item), COUNT(DISTINCT v.pedido)), 2) AS ticket_medio_item_por_pedido,
  ROUND(SAFE_DIVIDE(SUM(v.valor_liquido_item), SUM(v.quantidade)), 2) AS preco_medio_liquido_por_par
FROM primeira_venda p
CROSS JOIN janelas j
LEFT JOIN vendas v
  ON v.modelo_id = p.modelo_id
 AND v.data_venda BETWEEN p.data_primeira_venda
                      AND DATE_ADD(p.data_primeira_venda, INTERVAL j.dias DAY)
GROUP BY
  p.modelo_id,
  p.modelo,
  j.periodo,
  j.dias,
  p.data_primeira_venda
ORDER BY
  p.modelo_id,
  j.dias;
