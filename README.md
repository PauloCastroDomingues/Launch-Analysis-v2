# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

## O que está pronto

- `index.html`: dashboard final em tema escuro, acento laranja e navegação por seções.
- `assets/styles.css`: design system v2 aplicado.
- `assets/app.js`: leitura de JSON via `fetch`, seletor de modelo, KPIs, tabelas, gráficos, sazonalidade, ações e projeção.
- `data/*.json`: estrutura inicial de dados, com histórico de GT, Avant e Phantom e cadastros de RS8 Avant Monochrome e Dia dos Pais.
- `apps_script/ExportLaunchAnalysis.gs`: script-base para exportar Google Sheets + BigQuery para JSON no GitHub.
- `sql/lancamentos_produtos_dia.sql`: query-base do pipeline de vendas por lançamento.
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

1. Criar um repositório novo no GitHub.
2. Subir todos os arquivos desta pasta.
3. Conectar o repositório na Vercel.
4. Framework preset: `Other`.
5. Build command: vazio.
6. Output directory: vazio ou `.`.

## Como cadastrar novo lançamento

Editar a aba `lancamentos_modelos` no Google Sheets com as colunas:

```txt
modelo_id | modelo | linha | data_lancamento | data_oficial | day_zero_base | termos_busca | sku_prefixos | status | observacao
```

Regras:

- `day_zero_base` é a data usada para análise.
- `termos_busca` deve trazer nomes que aparecem no produto/SKU, separados por `|`.
- Status sugeridos: `historico`, `ativo`, `planejado`.
- Depois de cadastrar, rodar `exportarTudo()` no Apps Script.

## Regras preservadas

- Filtro de data usa `>=` para incluir D0.
- GT usa `day_zero_base: 2025-02-11`.
- Avant 90d sempre carrega aviso de Black Friday/Natal.
- Dado ausente aparece como `—` e vai para gráficos como `null`, nunca como `0`.
- Novos lançamentos entram via JSON/Google Sheets, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`.

## Observação sobre RS8 Avant Monochrome

O modelo já está cadastrado em `lancamentos_modelos.json` como ativo, com D0 em `2026-06-25`.

O arquivo `lancamentos_produtos_dia.json` está vazio porque eu não tenho acesso direto ao BigQuery nesta execução. Quando o Apps Script rodar, o dashboard já vai calcular as janelas automaticamente a partir das vendas exportadas.
