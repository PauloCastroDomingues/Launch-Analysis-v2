-- Diagnostico executavel em BigQuery JOB LOCATION = southamerica-east1.
--
-- Por que esta versao usa mirror:
--   `mart_shared.Vendas_pedidos_Linha` esta em southamerica-east1.
--   `mart_growth_us.shopify__orders_journey_latest_v` esta em US.
--   O BigQuery nao permite cruzar datasets de regioes diferentes na mesma query.
--
-- Entao o caminho executavel e:
--   Vendas_pedidos_Linha
--     x mart_shared.canal_atribuicao_pedido_mirror
--
-- A mirror e a copia regional criada a partir de:
--   mart_growth_us.shopify__orders_journey_latest_v
--
-- Regra de cruzamento:
--   1) Vendas_pedidos_Linha.source_order_id = mirror.source_order_id
--   2) fallback: Vendas_pedidos_Linha.numero_pedido = mirror.order_name
--
-- Regra de diagnostico:
--   A mirror ja traz o SSOT 9 canais. Meta ADS, Google ADS e WhatsApp Oficial
--   sao paid; WhatsApp Nao Oficial, E-mail, Direto, Social, Organico e Outros
--   sao organic.
--
-- Antes de rodar:
--   1) atualize o Apps Script para v39;
--   2) rode exportarTudo();
--   3) confirme no log:
--      exportarTudo versao=20260821-ssot-9-channel-paid3-v39

DECLARE timezone STRING DEFAULT 'America/Sao_Paulo';
DECLARE data_inicio DATE DEFAULT DATE('2025-12-01');
DECLARE data_fim DATE DEFAULT CURRENT_DATE(timezone);

WITH vendas_linha AS (
  SELECT
    NULLIF(TRIM(CAST(source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(numero_pedido AS STRING))), '') AS order_name,
    NULLIF(TRIM(CAST(order_key AS STRING)), '') AS order_key,
    COALESCE(
      NULLIF(TRIM(CAST(source_order_id AS STRING)), ''),
      NULLIF(LOWER(TRIM(CAST(numero_pedido AS STRING))), ''),
      NULLIF(TRIM(CAST(order_key AS STRING)), '')
    ) AS order_identity,
    DATE(COALESCE(paid_at, created_at, TIMESTAMP(data_pedido, timezone)), timezone) AS data_pedido,
    COALESCE(NULLIF(TRIM(CAST(modelo_simples AS STRING)), ''), NULLIF(TRIM(CAST(modelo AS STRING)), ''), 'Sem modelo') AS modelo_venda,
    COALESCE(NULLIF(TRIM(CAST(categoria_produto AS STRING)), ''), 'Sem categoria') AS categoria_produto,
    NULLIF(TRIM(CAST(sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(nome_produto AS STRING)), '') AS nome_produto,
    SAFE_CAST(quantidade_linha AS NUMERIC) AS quantidade_linha,
    SAFE_CAST(line_gross_amount AS NUMERIC) AS line_gross_amount,
    SAFE_CAST(line_net_amount AS NUMERIC) AS line_net_amount
  FROM `reise-ssot.mart_shared.Vendas_pedidos_Linha`
  WHERE data_pedido BETWEEN DATE_SUB(data_inicio, INTERVAL 1 DAY) AND DATE_ADD(data_fim, INTERVAL 1 DAY)
),
vendas_filtradas AS (
  SELECT *
  FROM vendas_linha
  WHERE order_identity IS NOT NULL
    AND data_pedido BETWEEN data_inicio AND data_fim
    AND COALESCE(line_gross_amount, line_net_amount, 0) > 0
    AND COALESCE(quantidade_linha, 0) > 0
),
pedido_modelo AS (
  SELECT
    source_order_id,
    order_name,
    order_identity,
    data_pedido,
    modelo_venda,
    categoria_produto,
    COUNT(DISTINCT sku) AS skus_distintos,
    ARRAY_AGG(DISTINCT nome_produto IGNORE NULLS LIMIT 5) AS exemplos_produtos,
    SUM(quantidade_linha) AS pares,
    ROUND(SUM(COALESCE(line_gross_amount, line_net_amount, 0)), 2) AS receita_bruta,
    ROUND(SUM(COALESCE(line_net_amount, line_gross_amount, 0)), 2) AS receita_liquida
  FROM vendas_filtradas
  GROUP BY
    source_order_id,
    order_name,
    order_identity,
    data_pedido,
    modelo_venda,
    categoria_produto
),
journey_mirror AS (
  SELECT * EXCEPT(_rn)
  FROM (
    SELECT
      NULLIF(TRIM(CAST(source_order_id AS STRING)), '') AS source_order_id,
      NULLIF(LOWER(TRIM(CAST(order_name AS STRING))), '') AS order_name,
      NULLIF(TRIM(CAST(canal AS STRING)), '') AS canal,
      NULLIF(TRIM(CAST(tipo AS STRING)), '') AS tipo,
      NULLIF(TRIM(CAST(utm_source AS STRING)), '') AS utm_source,
      NULLIF(TRIM(CAST(utm_medium AS STRING)), '') AS utm_medium,
      NULLIF(TRIM(CAST(utm_campaign AS STRING)), '') AS utm_campaign,
      NULLIF(TRIM(CAST(raw_channel AS STRING)), '') AS raw_channel,
      NULLIF(TRIM(CAST(raw_source AS STRING)), '') AS raw_source,
      NULLIF(TRIM(CAST(raw_medium AS STRING)), '') AS raw_medium,
      NULLIF(TRIM(CAST(regra_atribuicao_real AS STRING)), '') AS regra_atribuicao_real,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(
          NULLIF(REGEXP_REPLACE(LOWER(CAST(source_order_id AS STRING)), r'[^a-z0-9]+', ''), ''),
          NULLIF(REGEXP_REPLACE(LOWER(CAST(order_name AS STRING)), r'[^a-z0-9]+', ''), '')
        )
        ORDER BY
          CASE regra_atribuicao_real
            WHEN 'shopify_journey_latest_v' THEN 1
            ELSE 9
          END,
          CASE
            WHEN COALESCE(tipo, CASE WHEN canal IN ('Meta ADS', 'Google ADS', 'WhatsApp Oficial') THEN 'paid' ELSE 'organic' END) = 'paid' THEN 1
            ELSE 2
          END,
          canal
      ) AS _rn
    FROM `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror`
    WHERE paid_date_brt BETWEEN data_inicio AND data_fim
      AND (
        NULLIF(TRIM(CAST(source_order_id AS STRING)), '') IS NOT NULL
        OR NULLIF(TRIM(CAST(order_name AS STRING)), '') IS NOT NULL
      )
  )
  WHERE _rn = 1
),
pedido_atribuido_base AS (
  SELECT
    p.*,
    j.source_order_id AS journey_source_order_id,
    j.order_name AS journey_order_name,
    j.canal AS canal_journey,
    CASE
      WHEN j.source_order_id IS NULL AND j.order_name IS NULL THEN CAST(NULL AS STRING)
      ELSE COALESCE(j.tipo, CASE WHEN j.canal IN ('Meta ADS', 'Google ADS', 'WhatsApp Oficial') THEN 'paid' ELSE 'organic' END)
    END AS tipo_journey,
    j.utm_source,
    j.utm_medium,
    j.utm_campaign,
    j.raw_channel,
    j.raw_source,
    j.raw_medium,
    NULLIF(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(j.utm_medium, j.raw_medium, ''), NFD), r'\p{M}', ''), '') AS medium_norm,
    COALESCE(j.regra_atribuicao_real, 'sem_journey') AS regra_atribuicao
  FROM pedido_modelo p
  LEFT JOIN journey_mirror j
    ON (
      j.source_order_id IS NOT NULL
      AND REGEXP_REPLACE(LOWER(j.source_order_id), r'[^a-z0-9]+', '') =
        REGEXP_REPLACE(LOWER(COALESCE(p.source_order_id, '')), r'[^a-z0-9]+', '')
    )
    OR (
      j.order_name IS NOT NULL
      AND REGEXP_REPLACE(LOWER(j.order_name), r'[^a-z0-9]+', '') =
        REGEXP_REPLACE(LOWER(COALESCE(p.order_name, '')), r'[^a-z0-9]+', '')
    )
),
pedido_atribuido AS (
  SELECT
    *,
    tipo_journey AS tipo_real
  FROM pedido_atribuido_base
)
SELECT
  modelo_venda,
  categoria_produto,
  COUNT(DISTINCT order_identity) AS pedidos,
  COUNT(DISTINCT IF(tipo_real = 'paid', order_identity, NULL)) AS pedidos_pagos,
  COUNT(DISTINCT IF(tipo_real = 'organic', order_identity, NULL)) AS pedidos_organicos,
  ROUND(SUM(receita_bruta), 2) AS receita_bruta,
  ROUND(SUM(IF(tipo_real = 'paid', receita_bruta, 0)), 2) AS receita_paga,
  ROUND(SUM(IF(tipo_real = 'organic', receita_bruta, 0)), 2) AS receita_organica,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(tipo_real = 'paid', order_identity, NULL)),
    COUNT(DISTINCT order_identity)
  ) AS share_pedidos_pagos,
  COUNT(DISTINCT IF(tipo_real = 'organic', order_identity, NULL)) AS pedidos_organicos_por_regra,
  COUNT(DISTINCT IF(regra_atribuicao = 'shopify_journey_latest_v', order_identity, NULL)) AS pedidos_com_journey_v39,
  COUNT(DISTINCT IF(regra_atribuicao NOT IN ('shopify_journey_latest_v', 'sem_journey'), order_identity, NULL)) AS pedidos_journey_legada,
  COUNT(DISTINCT IF(regra_atribuicao = 'sem_journey', order_identity, NULL)) AS pedidos_sem_journey,
  COUNT(DISTINCT IF(medium_norm IS NULL, order_identity, NULL)) AS pedidos_sem_medium
FROM pedido_atribuido
GROUP BY modelo_venda, categoria_produto
ORDER BY receita_bruta DESC;
