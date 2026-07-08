-- Reise Launch Analysis v2
-- Consulta base para gerar data/lancamentos_produtos_dia.json.
-- Regras fixas:
-- 1) usar >= no filtro de data para incluir D0;
-- 2) rodar em southamerica-east1;
-- 3) nao criar views/tabelas;
-- 4) nao transformar dado ausente em zero;
-- 5) unificar vendas Shopify + Shoppub, respeitando o corte de migracao.
-- 6) rs8_monochrome usa fonte canonica core.order_item + core.order e match estrito.

WITH params AS (
  SELECT TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
),
modelos AS (
  -- Preenchido pelo Apps Script a partir de data/lancamentos_modelos.json no GitHub.
  -- Exemplo generico para diagnostico local:
  SELECT
    'modelo_exemplo' AS modelo_id,
    'Modelo Exemplo' AS modelo,
    DATE('2026-01-01') AS d0,
    'Modelo Exemplo|Linha Exemplo' AS termos_busca,
    'MODELO-EXEMPLO,LINHA-EXEMPLO' AS sku_prefixos
),
modelos_norm AS (
  SELECT
    *,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS sku_prefixos_norm
  FROM modelos
),
pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    o.paid_at,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos_norm)
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
),
shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS title_text,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS name_text,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount) AS NUMERIC) AS receita
  FROM `reise-ssot.mart_shared.fct_order_item` i
  JOIN `reise-ssot.mart_shared.fct_order` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
),
shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM `reise-ssot.stg.shoppub_orders_tbl` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
),
shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title')
    )), '') AS title_text,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.name'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS name_text,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS pares,
    COALESCE(
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_total'),
        JSON_EXTRACT_SCALAR(item_json, '$.total'),
        JSON_EXTRACT_SCALAR(item_json, '$.subtotal'),
        JSON_EXTRACT_SCALAR(item_json, '$.total_price'),
        JSON_EXTRACT_SCALAR(item_json, '$.line_total')
      ) AS NUMERIC),
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_unitario'),
        JSON_EXTRACT_SCALAR(item_json, '$.valor'),
        JSON_EXTRACT_SCALAR(item_json, '$.preco'),
        JSON_EXTRACT_SCALAR(item_json, '$.price'),
        JSON_EXTRACT_SCALAR(item_json, '$.unit_price')
      ) AS NUMERIC)
      * SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
        JSON_EXTRACT_SCALAR(item_json, '$.qty'),
        JSON_EXTRACT_SCALAR(item_json, '$.quantity')
      ) AS INT64)
    ) AS receita
  FROM shoppub_item_json
),
itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
),
vendas AS (
  SELECT
    p.data,
    p.source_system,
    LOWER(p.source_system) AS origem,
    p.source_order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.nome_produto, i.product_title, '') AS nome_produto,
    COALESCE(i.product_title, i.nome_produto, '') AS product_title,
    COALESCE(i.variant_title, '') AS variant_title,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.sku, ''), ' ',
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.title_text, ''), ' ',
      COALESCE(i.name_text, '')
    ), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    i.pares,
    i.receita
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.pares IS NOT NULL
    AND i.pares > 0
),
candidatos AS (
  SELECT
    v.*,
    m.modelo_id,
    m.d0,
    GREATEST(
      IFNULL((
        SELECT MAX(LENGTH(TRIM(term)))
        FROM UNNEST(SPLIT(IFNULL(m.termos_norm, ''), '|')) AS term
        WHERE TRIM(term) != ''
          AND REGEXP_CONTAINS(
            v.match_text_norm,
            CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(term), r'\s+', r'\\s+'), r'([^a-z0-9]|$)')
          )
      ), 0),
      IFNULL((
        SELECT MAX(1000 + LENGTH(TRIM(prefixo)))
        FROM UNNEST(SPLIT(IFNULL(m.sku_prefixos_norm, ''), '|')) AS prefixo
        WHERE TRIM(prefixo) != ''
          AND STARTS_WITH(v.sku_norm, TRIM(prefixo))
      ), 0)
    ) AS match_score
  FROM vendas v
  JOIN modelos_norm m
    ON m.modelo_id != 'rs8_monochrome'
   AND v.data >= m.d0 -- inclui D0
),
match AS (
  SELECT
    c.modelo_id,
    c.data,
    c.origem,
    c.source_order_id,
    c.sku,
    c.nome_produto,
    c.variant_title,
    COALESCE(
      NULLIF(c.product_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'^(.*?)(?: - | / |\|)'), ''),
      NULLIF(c.nome_produto, '')
    ) AS sub_modelo,
    COALESCE(
      NULLIF(c.variant_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'(?i)(?:cor|color)[: -]+([^|/,-]+)'), '')
    ) AS cor,
    NULLIF(REGEXP_EXTRACT(c.match_text_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    c.pares,
    c.receita,
    c.match_text_norm,
    c.modelo_id AS modelo_id_detectado
  FROM candidatos c
  WHERE c.match_score > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY c.source_system, c.source_order_id, c.sku, c.nome_produto, c.variant_title
    ORDER BY c.match_score DESC, c.d0 DESC, c.modelo_id
  ) = 1
),
monochrome_item_source AS (
  SELECT
    'rs8_monochrome' AS modelo_id,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    'SSOT_CORE' AS source_system,
    'ssot_core' AS origem,
    CAST(o.order_name AS STRING) AS source_order_id,
    CAST(o.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), '') AS line_item_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount - IFNULL(i.line_discount_amount, 0)) AS NUMERIC) AS receita,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.item_name, ''), ' ', COALESCE(i.sku, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.core.order_item` i
  JOIN `reise-ssot.core.order` o
    ON o.order_sk = i.order_sk
  JOIN modelos_norm m
    ON m.modelo_id = 'rs8_monochrome'
   AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= m.d0
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
monochrome_flags AS (
  SELECT
    *,
    REGEXP_CONTAINS(item_name_norm, r'(^|[^a-z0-9])monochrome([^a-z0-9]|$)') AS has_title_match,
    (
      STARTS_WITH(sku_norm, 'rs8 avant mono')
      OR STARTS_WITH(sku_norm, 'rs8 mono')
      OR STARTS_WITH(sku_norm, 'rs8avantmono')
    ) AS has_sku_match
  FROM monochrome_item_source
),
monochrome_filtrado AS (
  SELECT
    *,
    COALESCE(
      NULLIF(line_item_id, ''),
      TO_JSON_STRING(STRUCT(order_sk, sku, nome_produto, pares, receita))
    ) AS dedupe_key
  FROM monochrome_flags
  WHERE has_title_match OR has_sku_match
),
monochrome_match AS (
  SELECT
    modelo_id,
    data,
    origem,
    source_order_id,
    COALESCE(sku, '') AS sku,
    COALESCE(nome_produto, '') AS nome_produto,
    variant_title,
    'RS8 Avant Monochrome' AS sub_modelo,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), '') AS cor,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    pares,
    receita,
    match_text_norm,
    'rs8_monochrome' AS modelo_id_detectado
  FROM monochrome_filtrado
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY dedupe_key
    ORDER BY source_order_id, sku, nome_produto, pares, receita
  ) = 1
),
match_unificado AS (
  SELECT * FROM match
  UNION ALL
  SELECT * FROM monochrome_match
)
SELECT
  modelo_id,
  data,
  source_order_id,
  origem,
  sku,
  nome_produto,
  variant_title,
  COALESCE(NULLIF(sub_modelo, ''), nome_produto) AS sub_modelo,
  NULLIF(cor, '') AS cor,
  NULLIF(tamanho, '') AS tamanho,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CAST(NULL AS INT64) AS novos,
  CAST(NULL AS INT64) AS recorrentes,
  match_text_norm,
  modelo_id_detectado
FROM match_unificado
GROUP BY 1,2,3,4,5,6,7,8,9,10,16,17
ORDER BY modelo_id, data, source_order_id, sku;
