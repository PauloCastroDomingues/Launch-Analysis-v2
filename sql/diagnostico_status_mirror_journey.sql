-- Diagnostico rapido da mirror de atribuicao.
-- Rode em BigQuery JOB LOCATION = southamerica-east1.
--
-- Se `linhas_v39` vier 0 e `linhas_legadas` vier alto, a mirror ainda nao
-- foi regravada pela versao v39 do Apps Script.

DECLARE data_inicio DATE DEFAULT DATE('2025-12-01');
DECLARE data_fim DATE DEFAULT CURRENT_DATE('America/Sao_Paulo');

WITH mirror AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(regra_atribuicao_real AS STRING)), ''), 'sem_regra') AS regra_atribuicao_real,
    COALESCE(NULLIF(TRIM(CAST(canal AS STRING)), ''), 'sem_canal') AS canal_gravado,
    COALESCE(NULLIF(TRIM(CAST(tipo AS STRING)), ''), 'sem_tipo') AS tipo_gravado,
    NULLIF(TRIM(CAST(source_order_id AS STRING)), '') AS source_order_id,
    NULLIF(LOWER(TRIM(CAST(order_name AS STRING))), '') AS order_name
  FROM `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror`
  WHERE paid_date_brt BETWEEN data_inicio AND data_fim
),
classificada AS (
  SELECT
    *,
    CASE
      WHEN canal_gravado IN ('Meta ADS', 'Google ADS', 'WhatsApp Oficial') THEN 'paid'
      WHEN canal_gravado != 'sem_canal' THEN 'organic'
      ELSE 'sem_tipo'
    END AS tipo_pelo_canal
  FROM mirror
),
resumo AS (
  SELECT
    COUNT(*) AS linhas_mirror,
    COUNTIF(regra_atribuicao_real IN ('shopify_journey_latest_v', 'mirror_ssot_9_channel_paid3', 'core_order_ssot_9_channel_paid3')) AS linhas_v39,
    COUNTIF(regra_atribuicao_real NOT IN ('shopify_journey_latest_v', 'mirror_ssot_9_channel_paid3', 'core_order_ssot_9_channel_paid3')) AS linhas_legadas,
    COUNTIF(tipo_pelo_canal = 'organic') AS linhas_organicas_pela_regra,
    COUNTIF(tipo_pelo_canal = 'paid') AS linhas_pagas_pela_regra,
    COUNTIF(tipo_gravado != tipo_pelo_canal) AS linhas_divergentes,
    COUNTIF(source_order_id IS NOT NULL) AS linhas_com_source_order_id,
    COUNTIF(order_name IS NOT NULL) AS linhas_com_order_name
  FROM classificada
),
por_regra AS (
  SELECT
    regra_atribuicao_real,
    tipo_gravado,
    canal_gravado,
    COUNT(*) AS linhas
  FROM classificada
  GROUP BY regra_atribuicao_real, tipo_gravado, canal_gravado
)
SELECT
  'RESUMO' AS bloco,
  CAST(NULL AS STRING) AS regra_atribuicao_real,
  CAST(NULL AS STRING) AS tipo_gravado,
  CAST(NULL AS STRING) AS canal_gravado,
  linhas_mirror AS linhas,
  linhas_v39,
  linhas_legadas,
  linhas_organicas_pela_regra,
  linhas_pagas_pela_regra,
  linhas_divergentes,
  linhas_com_source_order_id,
  linhas_com_order_name
FROM resumo

UNION ALL

SELECT
  'POR_REGRA' AS bloco,
  regra_atribuicao_real,
  tipo_gravado,
  canal_gravado,
  linhas,
  CAST(NULL AS INT64) AS linhas_v39,
  CAST(NULL AS INT64) AS linhas_legadas,
  CAST(NULL AS INT64) AS linhas_organicas_pela_regra,
  CAST(NULL AS INT64) AS linhas_pagas_pela_regra,
  CAST(NULL AS INT64) AS linhas_divergentes,
  CAST(NULL AS INT64) AS linhas_com_source_order_id,
  CAST(NULL AS INT64) AS linhas_com_order_name
FROM por_regra
ORDER BY bloco, linhas DESC;
