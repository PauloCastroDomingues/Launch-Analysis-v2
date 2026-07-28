-- Classificacao diaria de vendas/pedidos por canal atribuido.
-- Fonte: reise-ssot.mart_growth_us.sales_attributed_to_marketing_v
-- Rode em BigQuery com JOB LOCATION = US.
-- Query somente leitura: nao cria tabela nem view.

WITH base AS (
  SELECT
    report_date,
    LOWER(TRIM(COALESCE(CAST(referring_channel AS STRING), ''))) AS referring_channel_norm,
    LOWER(TRIM(COALESCE(CAST(utm_source AS STRING), ''))) AS utm_source_norm,
    LOWER(TRIM(COALESCE(CAST(utm_medium AS STRING), ''))) AS utm_medium_norm,
    LOWER(TRIM(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(CAST(utm_medium AS STRING), ''), NFD),
      r'\p{M}',
      ''
    ))) AS utm_medium_match,
    SAFE_CAST(orders__last_click AS NUMERIC) AS pedidos,
    SAFE_CAST(net_sales__last_click AS NUMERIC) AS vendas
  FROM `reise-ssot.mart_growth_us.sales_attributed_to_marketing_v`
),
classificado AS (
  SELECT
    report_date,
    CASE
      WHEN REGEXP_CONTAINS(utm_medium_match, r'(cpcp|cpc|pmax|paidsocial|paid|demand[-_ ]gen)')
        THEN 'Paid Media'

      WHEN utm_medium_norm = ''
        AND referring_channel_norm IN ('google', 'bing', 'yahoo!', 'duckduckgo', 'brave')
        THEN 'Organic Search'

      WHEN utm_medium_norm = ''
        AND referring_channel_norm IN ('instagram', 'facebook', 'youtube')
        THEN 'Organic Social'

      WHEN referring_channel_norm = 'direct'
        OR (referring_channel_norm = '' AND utm_source_norm = '')
        OR referring_channel_norm = 'unattributed'
        THEN 'Direct / Unknown'

      WHEN REGEXP_CONTAINS(
        utm_medium_match,
        r'(email|whatsapp|sms|disparo|grupos|canal-de-transmissao|canal de transmissao)'
      )
        THEN 'CRM / Owned'

      WHEN utm_medium_norm = 'referral'
        OR REGEXP_CONTAINS(
          CONCAT(referring_channel_norm, ' ', utm_source_norm),
          r'(linktree|linktr\.ee|nextags|awin|cupomonline|br-desconto|chatgpt\.com|chatgpt|perplexity)'
        )
        THEN 'Referral / Partners'

      ELSE 'Other / Unclassified'
    END AS channel_group,
    pedidos,
    vendas
  FROM base
)
SELECT
  report_date,
  channel_group,
  SUM(COALESCE(pedidos, 0)) AS pedidos,
  SUM(COALESCE(vendas, 0)) AS vendas
FROM classificado
GROUP BY report_date, channel_group
ORDER BY report_date, channel_group;
