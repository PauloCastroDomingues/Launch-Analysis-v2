# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

Ele roda na Vercel, lê JSONs da pasta `/data` via `fetch` e não depende de backend em runtime. A atualização dos dados vem do Google Sheets + BigQuery/SSOT pelo Apps Script.

## O que está pronto

- `index.html`: dashboard em tema escuro, acento laranja e navegação por seções.
- `assets/styles.css`: design system v2 aplicado.
- `assets/app.js`: leitura de JSON, seletor de modelo, KPIs, tabelas, gráficos, sazonalidade, ações e projeção.
- `data/*.json`: estrutura inicial de dados com histórico de GT, Avant e Phantom, além de RS8 Avant Monochrome ativo e Dia dos Pais planejado.
- `apps_script/ExportLaunchAnalysis.gs`: exporta Google Sheets + BigQuery para JSON no GitHub.
- `sql/lancamentos_produtos_dia.sql`: query-base do pipeline de vendas por lançamento.
- `sql/diagnostico_rs8_monochrome.sql`: query de diagnóstico para produtos RS8/Avant/Mono vendidos desde o D0 do Monochrome.
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
    ├── diagnostico_rs8_monochrome.sql
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

## Origem das vendas

As vendas vêm do BigQuery/SSOT e precisam unificar Shopify + Shoppub.

Regras fixas:

- Usar `reise-ssot.mart_shared.orders_all_valid_no_migracao` como base de pedidos válidos.
- Usar Shopify para pedidos a partir de `2025-07-10 05:00:00` BRT.
- Usar Shoppub para histórico até `2025-07-10 05:00:00` BRT.
- Sempre filtrar lançamento com `v.data >= m.d0` para incluir o D0.
- Não criar views ou tabelas no BigQuery para este dashboard.
- Rodar as queries em `southamerica-east1`.
- Se `novos` e `recorrentes` ainda não forem seguros, exportar `null`.
- Ausência de dado vira `—` no front e `null` nos gráficos, nunca `0`.

## Como cadastrar novo lançamento

Editar a aba `lancamentos_modelos` no Google Sheets com as colunas:

```txt
modelo_id | modelo | linha | data_lancamento | data_oficial | day_zero_base | termos_busca | sku_prefixos | status | observacao
```

Regras:

- `day_zero_base` é a data usada para análise.
- `termos_busca` deve trazer nomes que aparecem em `nome_produto`, `sku`, `product_title`, `variant_title` ou campos equivalentes, separados por `|`.
- `sku_prefixos` aceita prefixos separados por vírgula ou `|`.
- Status sugeridos: `historico`, `ativo`, `planejado`.
- Lançamento futuro deve entrar apenas em `lancamentos_modelos` com `status = planejado`.
- Depois de cadastrar ou alterar termos, rodar `exportarTudo()` no Apps Script.

## Como inserir mídia paga manualmente

A mídia paga é preenchida manualmente na aba `midia_paga`. O dashboard não calcula investimento por campanha no BigQuery.

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
RS8 Avant Monochrome|RS8 Avant Mono|RS8 Monochrome|RS8 Mono|Monochrome|Mono
```

Prefixos atuais:

```txt
RS8-AVANT-MONO,RS8-MONO,RS8AVANTMONO,RS8AVANT,MONO
```

Para diagnosticar, rodar `sql/diagnostico_rs8_monochrome.sql` no BigQuery ou a função `diagnosticarRs8Monochrome()` no Apps Script.

## Regras preservadas

- Filtro de data usa `>=` para incluir D0.
- GT usa `day_zero_base: 2025-02-11`.
- Avant 90d sempre carrega aviso de Black Friday/Natal.
- Dado ausente aparece como `—` e vai para gráficos como `null`, nunca como `0`.
- Novos lançamentos entram via JSON/Google Sheets, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`; Chart.js não escolhe cores automaticamente.
