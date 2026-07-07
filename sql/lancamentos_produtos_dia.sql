-- Reise Launch Analysis v2
-- Consulta base para gerar data/lancamentos_produtos_dia.json.
-- Regras fixas:
-- 1) usar >= no filtro de data para incluir D0;
-- 2) rodar em southamerica-east1;
-- 3) não criar views/tabelas;
-- 4) não transformar dado ausente em zero.

WITH modelos AS (
  -- Preenchido pelo Apps Script a partir da aba lancamentos_modelos.
  -- Exemplo:
  SELECT 'rs8_monochrome' AS modelo_id,
         'RS8 Avant Monochrome' AS modelo,
         DATE('2026-06-25') AS d0,
         r'RS8 Avant Monochrome|RS8 Monochrome|Monochrome' AS regex
), vendas AS (
  SELECT
    DATE(o.paid_at, 'America/Sao_Paulo') AS data,
    o.source_order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.item_name, '') AS nome_produto,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita
  FROM `reise-ssot.stg.shopify_order_items` i
  JOIN `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
    ON o.source_order_id = i.source_order_id
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos)
), match AS (
  SELECT
    m.modelo_id,
    v.data,
    v.source_order_id,
    v.sku,
    v.nome_produto,
    REGEXP_EXTRACT(v.nome_produto, r'^(.*?)(?: - | / |\|)') AS sub_modelo,
    NULL AS cor,
    v.pares,
    v.receita
  FROM vendas v
  JOIN modelos m
    ON v.data >= m.d0
   AND REGEXP_CONTAINS(LOWER(CONCAT(v.nome_produto, ' ', v.sku)), LOWER(m.regex))
)
SELECT
  modelo_id,
  data,
  COALESCE(NULLIF(sub_modelo, ''), nome_produto) AS sub_modelo,
  cor,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CAST(NULL AS INT64) AS novos,
  CAST(NULL AS INT64) AS recorrentes
FROM match
GROUP BY 1,2,3,4
ORDER BY modelo_id, data, sub_modelo;
