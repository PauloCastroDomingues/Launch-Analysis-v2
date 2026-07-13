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
14. Clientes novos/recorrentes no pipeline exportável (`status = historico` ou `ativo`) são classificados por `customer_key` segura (`email:` normalizado ou `phone:` normalizado). Pedidos sem chave confiável permanecem `null`, e pedidos com múltiplas linhas contam cliente apenas uma vez por `modelo_id + source_order_id`.
15. O vínculo de cliente no pipeline usa uma referência de pedido tolerante (`source_order_id`, `order_name`, e variantes com/sem `#`) para cobrir diferenças entre fontes históricas e atuais sem inventar cliente.
16. ROAS de mídia e CRM é campo informado na planilha (`roas`) em escala de multiplicador; o dashboard não calcula ROAS a partir de receita de janela, receita_linha ou receita_dia. Valores percentuais/textuais ou acima de `100` são normalizados por `/100` para evitar exibição irreal por confusão entre percentual e `x`. Investimentos vêm das abas `midia_paga` e `crm_disparos`, não de APIs de mídia.
17. Toda venda de modelo precisa vir de pedido válido no SSOT: Shopify com `is_valid_order = TRUE`, Shoppub com `is_valid_order_calc = TRUE`, e o pipeline unificado passa por `orders_all_valid_no_migracao` quando aplicável.
