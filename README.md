# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

Ele roda na Vercel, lê JSONs da pasta `/data` via `fetch` e não depende de backend em runtime. A atualização dos dados vem do BigQuery/SSOT pelo Apps Script; a planilha é opcional e serve apenas para mídia paga e CRM manual.

## O que está pronto

- `index.html`: dashboard em tema escuro, acento laranja e navegação por seções.
- `assets/styles.css`: design system v2 aplicado.
- `assets/app.js`: leitura de JSON, seletor de modelo, KPIs, tabelas, gráficos, sazonalidade, ações e projeção.
- `data/*.json`: estrutura inicial de dados com histórico de GT, Avant e Phantom, além de RS8 Avant Monochrome ativo e Dia dos Pais planejado.
- `apps_script/ExportLaunchAnalysis.gs`: exporta BigQuery + fontes manuais opcionais para JSON no GitHub.
- `sql/lancamentos_produtos_dia.sql`: query-base do pipeline de vendas por lançamento.
- `sql/diagnostico_monochrome.sql`: query de diagnóstico filtrado para produtos RS8/Avant/Mono vendidos desde o D0 do Monochrome.
- `sql/diagnostico_monochrome_amplo.sql`: diagnóstico amplo, sem filtro de nome/SKU, para descobrir como o produto foi cadastrado de verdade.
- `sql/auditoria_historico_gt_avant.sql`: query de auditoria para recalcular GT e Avant no SSOT usando apenas pedidos validos, com abertura Shopify/Shoppub.
- `vercel.json`: configuração simples para deploy estático.

## Estrutura

```txt
reise-launch-dashboard-v2/
├── index.html
├── assets/
│   ├── app.js
│   ├── embedded-data.js
│   └── styles.css
├── data/
│   ├── calendario_br.json
│   ├── crm_disparos.json
│   ├── estoque.json
│   ├── lancamentos_historico.json
│   ├── lancamentos_modelos.json
│   ├── lancamentos_produtos_dia.json
│   ├── manifest.json
│   └── midia_paga.json
├── apps_script/
│   └── ExportLaunchAnalysis.gs
└── sql/
    ├── diagnostico_monochrome.sql
    ├── diagnostico_monochrome_amplo.sql
    ├── diagnostico_rs8_monochrome.sql
    ├── auditoria_historico_gt_avant.sql
    └── lancamentos_produtos_dia.sql
```

## Como rodar localmente

Como o dashboard lê JSON via `fetch`, o ideal é abrir com um servidor local:

```bash
cd reise-launch-dashboard-v2
python3 -m http.server 8000
```

Depois acesse `http://localhost:8000`.

O arquivo `assets/embedded-data.js` existe só para fallback quando o HTML for aberto direto. Em produção, a fonte principal continua sendo `data/*.json`.

## Como subir na Vercel

1. Conectar o repositório GitHub na Vercel.
2. Framework preset: `Other`.
3. Build command: vazio.
4. Output directory: vazio ou `.`.

## Apps Script

Script Properties obrigatórias:

```txt
BQ_PROJECT_ID = reise-ssot
GITHUB_TOKEN
GITHUB_REPO = PauloCastroDomingues/Launch-Analysis-v2
GITHUB_BRANCH = main
DATA_PATH = data
```

Script Property opcional:

```txt
MIDIA_SPREADSHEET_ID
```

`exportarTudo()` não depende de planilha ativa. Ele lê `data/lancamentos_modelos.json` no GitHub, consulta vendas no BigQuery/SSOT, exporta `lancamentos_produtos_dia.json`, tenta atualizar estoque e só abre planilha se `MIDIA_SPREADSHEET_ID` estiver configurado.

## Origem das vendas

As vendas vêm do BigQuery/SSOT e precisam unificar Shopify + Shoppub.

Regras fixas:

- Usar `reise-ssot.mart_shared.orders_all_valid_no_migracao` como base de pedidos válidos.
- Para recalcular benchmarks historicos de GT e Avant, usar `sql/auditoria_historico_gt_avant.sql`, baseada em pedidos validos de Shopify e Shoppub, com abertura de pedidos, pares e receita por origem.
- Usar Shopify para pedidos a partir de `2025-07-10 05:00:00` BRT.
- Usar Shoppub para histórico até `2025-07-10 05:00:00` BRT.
- Sempre filtrar lançamento com `v.data >= m.d0` para incluir o D0.
- Não criar views ou tabelas no BigQuery para este dashboard.
- Rodar as queries em `southamerica-east1`.
- Se `novos` e `recorrentes` ainda não forem seguros, exportar `null`.
- Ausência de dado vira `—` no front e `null` nos gráficos, nunca `0`.
- A saída de `lancamentos_produtos_dia.json` inclui `origem`, `source_order_id`, `sku`, `nome_produto`, `variant_title`, `sub_modelo`, `cor`, `pedidos`, `pares`, `receita`, `novos` e `recorrentes`.
- A classificação da linha do produto usa prioridade fixa pelo texto/SKU normalizado: Monochrome, Phantom, GT e depois Avant.

## Como cadastrar novo lançamento

Editar `data/lancamentos_modelos.json` no GitHub/repositório com os campos:

```txt
modelo_id | modelo | linha | data_lancamento | data_oficial | day_zero_base | termos_busca | sku_prefixos | status | observacao
```

Regras:

- `day_zero_base` é a data usada para análise.
- `termos_busca` deve trazer nomes que aparecem em `nome_produto`, `sku`, `product_title`, `variant_title` ou campos equivalentes, separados por `|`.
- `sku_prefixos` aceita prefixos separados por vírgula ou `|`.
- Status sugeridos: `historico`, `ativo`, `planejado`.
- Lançamento futuro deve entrar apenas em `data/lancamentos_modelos.json` com `status = planejado`.
- Depois de cadastrar ou alterar termos, rodar `exportarTudo()` no Apps Script.

## Como inserir mídia paga manualmente

A mídia paga é preenchida manualmente na aba `midia_paga` de uma planilha opcional. Para o Apps Script exportar essa aba, configure a Script Property `MIDIA_SPREADSHEET_ID`. Sem essa propriedade, `exportarTudo()` mantém `midia_paga.json` e `crm_disparos.json` atuais e continua exportando vendas/estoque.

Colunas aceitas:

```txt
modelo_id | campanha | canal | data_inicio | data_fim | janela | investimento | receita_atribuida | pedidos | roas | cpa | observacao | status
```

Regras:

- `campanha` é obrigatório.
- `investimento` deve ser o valor real informado por campanha.
- `janela` pode ser preenchida manualmente.
- Se `janela` vier vazia, o Apps Script calcula pela relação entre `data_inicio`/`data_fim` e o D0 do modelo.
- O dashboard mostra totais por modelo, janela e canal, e também as linhas detalhadas por campanha.

## RS8 Avant Monochrome

O modelo `rs8_monochrome` está cadastrado como ativo, com D0 em `2026-06-25`.

Ele deve puxar vendas desde `2026-06-25`. Se aparecer sem dados, o problema esperado está em BigQuery, termos de busca, prefixos de SKU ou exportação do Apps Script, não no front.

Termos atuais:

```txt
RS8|Monochrome|Mono|RS8 Avant|RS8 Monochrome|RS8 Avant Monochrome
```

Prefixos atuais:

```txt
RS8-AVANT-MONO,RS8-MONO,RS8AVANTMONO,RS8AVANT,MONO
```

Para diagnosticar, rodar `sql/diagnostico_monochrome.sql` no BigQuery ou a função `diagnosticarMonochrome()` no Apps Script. Se o filtro não retornar nada, rodar `sql/diagnostico_monochrome_amplo.sql` ou `diagnosticarMonochromeAmplo()` para listar os produtos mais vendidos desde `2026-06-25` até hoje sem filtro de nome/SKU. A função antiga `diagnosticarRs8Monochrome()` continua como alias.

## Comparativos

O dashboard mostra quatro leituras:

- Comparativo por janelas fixas: 15d, 30d e 90d.
- Comparativo D+n real: usa dados diários reais até o D+ atual do modelo selecionado; se um histórico só tiver janelas agregadas, aparece `—`.
- Ranking de lançamentos: faturamento, ticket, pares, % novos e velocidade R$/dia, sempre com delta contra o modelo selecionado.
- Curva normalizada D0 → D+90: dados diários viram linha contínua; históricos apenas agregados viram pontos/linha pontilhada em D+15, D+30 e D+90.

O bloco de metodologia também mostra `Data oficial`, `Day zero usado`, `Primeira venda encontrada` e `Gap base`. Se a primeira venda encontrada vier depois do D0 em lançamento ativo, o dashboard alerta para revisar termos, SKU e exportação.

## Regras preservadas

- Filtro de data usa `>=` para incluir D0.
- GT historico usa `day_zero_base: 2025-12-17`, primeira venda valida encontrada na auditoria SSOT.
- Avant historico usa `day_zero_base: 2025-12-14`, primeira venda valida encontrada na auditoria SSOT.
- Mix por cor e novos/recorrentes de GT/Avant continuam pendentes de auditoria SSOT propria.
- Dado ausente aparece como `—` e vai para gráficos como `null`, nunca como `0`.
- Novos lançamentos entram via `data/lancamentos_modelos.json`, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`; Chart.js não escolhe cores automaticamente.
