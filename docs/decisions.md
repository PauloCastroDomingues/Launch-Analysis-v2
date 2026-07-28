# Decisões de implementação

1. O HTML antigo foi usado como referência de conteúdo, não como base visual, porque a v2 exige tema escuro.
2. Os dados históricos foram movidos para `data/lancamentos_historico.json`.
3. O front nunca contém números históricos hardcoded fora dos JSONs.
4. RS8 Avant Monochrome e Dia dos Pais entram no seletor pelo cadastro de modelos.
5. A ausência de dados do pipeline é tratada como ausência real, sem preenchimento com zero.
6. A projeção usa o 30d quando existe. Quando só houver 15d, duplica o 15d como aproximação conservadora para base de 30d e mantém aviso visual.
7. O pipeline de vendas precisa unificar Shopify + Shoppub no BigQuery/SSOT, respeitando o corte `2025-07-10 05:00 BRT`.
8. Mídia paga é manual por campanha na aba `midia_paga`; o dashboard não calcula investimento de campanha pelo BigQuery.
9. Lançamentos planejados aparecem no seletor/countdown, mas ficam fora das análises de venda, mídia, CRM e projeção até D0/dados reais.
10. Comparativos D+n e curva normalizada só usam dado diário quando ele existe; histórico apenas agregado não vira curva diária inventada.
11. `first_sale_date` é diagnóstico de qualidade de match/exportação. O front não troca automaticamente o D0 do Monochrome por essa data.
12. O relógio analítico do front vem de `manifest.generated_at`; se o manifest estiver ausente, usa a maior data em `lancamentos_produtos_dia.json` e só então a data do navegador como fallback.
13. As janelas `7d`, `15d`, `30d`, `60d` e `90d` representam marcos D+N inclusivos, ou seja, acumulam de D0 até D+N para manter paridade com as auditorias SQL.
14. Clientes novos/recorrentes no pipeline exportavel sao classificados por `customer_key` segura, preferencialmente `customer_sk` vindo de `fct_order_item`, com fallback para email/telefone quando confiaveis. A primeira compra e buscada no historico valido completo de `fct_order_item` ate o fim da janela exportada. Quando nao houver chave confiavel, `novos` e `recorrentes` permanecem `null`. Pedidos com multiplas linhas contam cliente apenas uma vez por `modelo_id + order_sk`.
15. O frontend pode somar percentuais e deltas simples, mas nao reclassifica SKU, nao decide pedido valido e nao troca a base de receita. Essas regras pertencem ao SQL exportavel.
16. ROAS de mídia e CRM é campo informado na planilha (`roas`) em escala de multiplicador; o dashboard não calcula ROAS a partir de receita de janela, receita_linha ou receita_dia. Valores percentuais/textuais ou acima de `100` são normalizados por `/100` para evitar exibição irreal por confusão entre percentual e `x`. Investimentos vêm das abas `midia_paga` e `crm_disparos`, não de APIs de mídia.
17. Toda venda de modelo precisa vir de pedido valido no SSOT. A camada canonica exportavel usa `reise-ssot.mart_shared.fct_order_item` com `i.is_valid_order = TRUE`.
18. A camada canonica nova de vendas por lancamento usa `reise-ssot.mart_shared.fct_order_item` com `i.is_valid_order = TRUE`, `order_sk` como identificador de pedido e `COUNT(DISTINCT order_sk)` para pedidos.
19. O faturamento principal do dashboard passa a ser `receita_bruta = line_gross_amount`. `desconto = IFNULL(line_discount_amount, 0)` e `receita_liquida = line_gross_amount - desconto` ficam disponiveis no JSON para auditoria e analise financeira.
20. A classificacao de itens fica concentrada no BigQuery, com prioridade Monochrome > Series 2 > Phantom > GT > Avant > genericos. O frontend nao reclassifica SKU nem decide pedido valido.
21. Cor, tamanho e `variant_title` do export principal priorizam `reise-ssot.mart_shared.produto_lancamento_v`; regex em `item_name` e sufixo de SKU ficam apenas como fallback para dado antigo ou incompleto.
22. Neste dashboard, o rotulo tecnico de custo por pedido/venda e `CPA`. `CPS` nao deve ser usado no codigo/JSON porque no SSOT geral significa custo por sessao.
23. `impacto_investimento.json` esta aposentado no fluxo principal. Correlacao por janela de investimento nao e atribuicao real; midia fica agregada por janela ate existir last-click por pedido no payload.
24. Quando a mesma `receita_atribuida` aparece em canais diferentes do mesmo modelo/janela, ROAS/CPA por canal sao bloqueados e a UI mostra apenas o total agregado da janela.
25. O card de promotores/ofensores usa desvios de participacao por cor e tamanho dentro do lancamento selecionado. Canal so entra quando o JSON trouxer atribuicao real por pedido.
26. Series 2 e um relancamento do RS8 Avant por cor. O match canonico entra antes do Avant comum e so captura RS8 Avant/Series 2 com cor Whisky, Off White ou Azul Marinho, abrindo sub-modelos por cor no export.
27. Atribuicao real de canal usa chave validada por email normalizado + data paga BRT + valor total arredondado. Como `mart_growth_us` fica em US e `mart_shared` em southamerica-east1, o dashboard espera uma tabela espelho `mart_shared.canal_atribuicao_pedido_mirror`; enquanto ela nao existir, `canal_real`, `tipo_real`, `receita_paga` e `receita_organica` permanecem `null`.
28. `day_zero_base` e o unico D0 canonico para calculo de janela. `data_lancamento` e `data_oficial` sao contexto do calendario/oficial, mas nao podem ser usadas como fallback silencioso para D0 em exportacao, front ou inferencia de janela.
29. O faturamento exibido no dashboard e sempre `receita_bruta` (`line_gross_amount`) ou o campo legado `receita` quando `receita_bruta` nao existir. `receita_liquida` permanece apenas como dado auxiliar/auditoria e nao deve ser priorizada em rankings, curvas, composicao por cor/tamanho ou comparativos executivos.
30. Historico e pipeline compartilham o mesmo contrato no frontend. Quando existe linha em `lancamentos_produtos_dia.json`, ela tem prioridade; `lancamentos_historico.json` fica apenas como fallback/benchmark estatico e e normalizado antes de alimentar janelas, curvas, rankings e badges.
31. `data_lancamento` e `day_zero_base` nao fazem fallback entre si. `data_lancamento` e data oficial/cadastro; `day_zero_base` e D0 analitico. `mart_shared.linha_cadastro` sincroniza os dois campos separadamente, e `share_trajetoria.json` passa a declarar `day_zero_base` alem do alias legado `data_lancamento`.
32. O pacote publico nao expõe identificadores brutos de pedido. `source_order_id`, `order_name` e `atribuicao_match_key` podem ser usados dentro do Apps Script para last-click, mas sao removidos antes de publicar `lancamentos_produtos_dia.json` e `assets/embedded-data.js`. A deduplicacao publica usa `order_sk` hashado.
33. Metodologia, alertas e estoque ficam acessiveis no painel recolhivel `Apoio de leitura`, logo abaixo da central de analise. Esse painel nao altera calculos nem cria uma nova etapa decisoria; ele apenas explica D0, janela, receita, meta, ausencia e ressalvas operacionais de estoque/canal/pacote de dados.
34. O front carrega `manifest.json` primeiro e depois baixa os demais `DATA_FILES` em paralelo, usando `manifest.generated_at` como chave de cache. A Vercel serve `/data/(.*)` com `no-store`; CSS/JS continuam versionados por query string em `index.html` e `dashboard.html`.
