-- Auditoria historica GT + Avant
-- Fonte canonica: pedidos validos unificados de Shoppub + Shopify.
-- Shoppub: reise-ssot.stg.shoppub_orders_tbl com is_valid_order_calc = TRUE.
-- Shopify: reise-ssot.core.order_item + reise-ssot.core.order com o.is_valid_order = TRUE.
-- Objetivo: recalcular D0, D7, D15, D30, D60 e D90 e abrir os totais por origem.

CREATE TEMP FUNCTION norm_text(s STRING) AS (
  REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(IFNULL(s, ''), NFD), r'\pM', '')
);

CREATE TEMP FUNCTION parse_money_shoppub(s STRING) AS (
  CASE
    WHEN s IS NULL OR TRIM(s) = '' THEN NULL

    -- 1.234,56
    WHEN REGEXP_CONTAINS(TRIM(s), r'^\d{1,3}(\.\d{3})+,\d{2}$') THEN
      SAFE_CAST(REPLACE(REPLACE(TRIM(s), '.', ''), ',', '.') AS NUMERIC)

    -- 1234,56
    WHEN REGEXP_CONTAINS(TRIM(s), r'^\d+,\d{2}$') THEN
      SAFE_CAST(REPLACE(TRIM(s), ',', '.') AS NUMERIC)

    -- 1234.56
    WHEN REGEXP_CONTAINS(TRIM(s), r'^\d+\.\d{1,3}$') THEN
      ROUND(SAFE_CAST(TRIM(s) AS NUMERIC), 2)

    -- Legado Shoppub em centavos: 89990 = 899.90
    WHEN REGEXP_CONTAINS(TRIM(s), r'^\d+$') THEN
      SAFE_CAST(TRIM(s) AS NUMERIC) / 100

    ELSE
      SAFE_CAST(
        REPLACE(
          REPLACE(
            REPLACE(
              REGEXP_REPLACE(TRIM(s), r'[^0-9,.-]', ''),
              ',',
              '|'
            ),
            '.',
            ''
          ),
          '|',
          '.'
        ) AS NUMERIC
      )
  END
);

WITH modelos AS (
  SELECT
    'gt' AS modelo_id,
    'GT Collection' AS modelo,
    r'(^|[^a-z0-9])gt([^a-z0-9]|$)' AS match_regex
  UNION ALL
  SELECT
    'avant' AS modelo_id,
    'Avant' AS modelo,
    r'(^|[^a-z0-9])avant([^a-z0-9]|$)' AS match_regex
), shoppub_orders AS (
  SELECT
    'shoppub' AS origem,
    DATE(COALESCE(paid_at, created_at), 'America/Sao_Paulo') AS data_venda,
    CAST(order_name AS STRING) AS pedido,
    CAST(source_order_id AS STRING) AS pedido_id,
    customer_email,
    customer_phone_digits AS customer_phone,
    total_amount AS total_pedido,
    status_raw,
    row_json
  FROM `reise-ssot.stg.shoppub_orders_tbl`
  WHERE is_valid_order_calc = TRUE
), shoppub_items_raw AS (
  SELECT
    o.origem,
    o.data_venda,
    o.pedido,
    o.pedido_id,
    o.customer_email,
    o.customer_phone,
    o.total_pedido,
    o.status_raw,
    item_json
  FROM shoppub_orders o,
  UNNEST(
    ARRAY_CONCAT(
      IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'), []),
      IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.pedidoitem_set')), []),
      IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.itens'), []),
      IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.itens')), []),
      IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.items'), []),
      IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.items')), []),
      IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'), []),
      IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.line_items')), []),
      IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.produtos'), []),
      IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.produtos')), [])
    )
  ) AS item_json
), shoppub AS (
  SELECT
    origem,
    data_venda,
    pedido,
    pedido_id,
    customer_email,
    customer_phone,
    COALESCE(
      JSON_VALUE(item_json, '$.sku'),
      JSON_VALUE(item_json, '$.codigo'),
      JSON_VALUE(item_json, '$.codigo_produto'),
      JSON_VALUE(item_json, '$.product_sku'),
      JSON_VALUE(item_json, '$.referencia')
    ) AS sku,
    COALESCE(
      JSON_VALUE(item_json, '$.title'),
      JSON_VALUE(item_json, '$.descricao'),
      JSON_VALUE(item_json, '$.nome'),
      JSON_VALUE(item_json, '$.produto'),
      JSON_VALUE(item_json, '$.product_title'),
      JSON_VALUE(item_json, '$.nome_produto'),
      JSON_VALUE(item_json, '$.descricao_produto')
    ) AS titulo_produto,
    SAFE_CAST(
      ROUND(
        SAFE_CAST(
          REPLACE(
            COALESCE(
              JSON_VALUE(item_json, '$.quantidade'),
              JSON_VALUE(item_json, '$.qty'),
              JSON_VALUE(item_json, '$.quantity')
            ),
            ',',
            '.'
          ) AS NUMERIC
        ),
        0
      ) AS INT64
    ) AS quantidade,
    parse_money_shoppub(
      COALESCE(
        JSON_VALUE(item_json, '$.valor_unitario'),
        JSON_VALUE(item_json, '$.preco_unitario'),
        JSON_VALUE(item_json, '$.unit_price'),
        JSON_VALUE(item_json, '$.price'),
        JSON_VALUE(item_json, '$.preco'),
        JSON_VALUE(item_json, '$.valor')
      )
    ) AS preco_unitario,
    parse_money_shoppub(
      COALESCE(
        JSON_VALUE(item_json, '$.valor_total'),
        JSON_VALUE(item_json, '$.total'),
        JSON_VALUE(item_json, '$.subtotal'),
        JSON_VALUE(item_json, '$.total_price'),
        JSON_VALUE(item_json, '$.line_total')
      )
    ) AS valor_total_item_raw,
    total_pedido,
    CAST(NULL AS STRING) AS pagamento,
    status_raw AS financial_status,
    CAST(NULL AS STRING) AS fulfillment_status
  FROM shoppub_items_raw
), shopify AS (
  SELECT
    'shopify' AS origem,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data_venda,
    CAST(o.order_name AS STRING) AS pedido,
    CAST(o.source_order_id AS STRING) AS pedido_id,
    o.customer_email,
    o.customer_phone,
    i.sku,
    i.item_name AS titulo_produto,
    SAFE_CAST(i.quantity AS INT64) AS quantidade,
    SAFE_CAST(i.unit_price AS NUMERIC) AS preco_unitario,
    SAFE_CAST(
      COALESCE(
        i.line_net_amount,
        i.line_gross_amount - IFNULL(i.line_discount_amount, 0)
      ) AS NUMERIC
    ) AS valor_total_item_raw,
    o.total_amount AS total_pedido,
    o.payment_method_tag AS pagamento,
    o.financial_status,
    o.fulfillment_status
  FROM `reise-ssot.core.order_item` i
  JOIN `reise-ssot.core.order` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order = TRUE
), base_historica AS (
  SELECT
    origem,
    data_venda,
    pedido,
    pedido_id,
    CONCAT(origem, '|', COALESCE(pedido_id, pedido)) AS pedido_key,
    customer_email,
    customer_phone,
    sku,
    titulo_produto,
    quantidade,
    preco_unitario,
    COALESCE(valor_total_item_raw, preco_unitario * quantidade) AS valor_liquido_item,
    total_pedido,
    pagamento,
    financial_status,
    fulfillment_status
  FROM shoppub

  UNION ALL

  SELECT
    origem,
    data_venda,
    pedido,
    pedido_id,
    CONCAT(origem, '|', COALESCE(pedido_id, pedido)) AS pedido_key,
    customer_email,
    customer_phone,
    sku,
    titulo_produto,
    quantidade,
    preco_unitario,
    valor_total_item_raw AS valor_liquido_item,
    total_pedido,
    pagamento,
    financial_status,
    fulfillment_status
  FROM shopify
), vendas_modelo AS (
  SELECT
    m.modelo_id,
    m.modelo,
    b.*
  FROM base_historica b
  JOIN modelos m
    ON REGEXP_CONTAINS(norm_text(b.titulo_produto), m.match_regex)
  WHERE b.titulo_produto IS NOT NULL
    AND b.quantidade IS NOT NULL
    AND b.quantidade > 0
), primeira_venda AS (
  SELECT
    modelo_id,
    modelo,
    MIN(data_venda) AS data_primeira_venda
  FROM vendas_modelo
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
  COUNT(DISTINCT v.pedido_key) AS pedidos,
  SUM(v.quantidade) AS pares_vendidos,
  ROUND(SUM(v.valor_liquido_item), 2) AS receita_liquida_itens,
  ROUND(
    SAFE_DIVIDE(SUM(v.valor_liquido_item), COUNT(DISTINCT v.pedido_key)),
    2
  ) AS ticket_medio_item_por_pedido,
  ROUND(
    SAFE_DIVIDE(SUM(v.valor_liquido_item), SUM(v.quantidade)),
    2
  ) AS preco_medio_liquido_por_par,
  COUNT(DISTINCT IF(v.origem = 'shoppub', v.pedido_key, NULL)) AS pedidos_shoppub,
  COUNT(DISTINCT IF(v.origem = 'shopify', v.pedido_key, NULL)) AS pedidos_shopify,
  SUM(IF(v.origem = 'shoppub', v.quantidade, 0)) AS pares_shoppub,
  SUM(IF(v.origem = 'shopify', v.quantidade, 0)) AS pares_shopify,
  ROUND(SUM(IF(v.origem = 'shoppub', v.valor_liquido_item, 0)), 2) AS receita_shoppub,
  ROUND(SUM(IF(v.origem = 'shopify', v.valor_liquido_item, 0)), 2) AS receita_shopify
FROM primeira_venda p
CROSS JOIN janelas j
LEFT JOIN vendas_modelo v
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
