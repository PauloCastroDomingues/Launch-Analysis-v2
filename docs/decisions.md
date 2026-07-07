# Decisões de implementação

1. O HTML antigo foi usado como referência de conteúdo, não como base visual, porque a v2 exige tema escuro.
2. Os dados históricos foram movidos para `data/lancamentos_historico.json`.
3. O front nunca contém números históricos hardcoded fora dos JSONs.
4. RS8 Avant Monochrome e Dia dos Pais entram no seletor pelo cadastro de modelos.
5. A ausência de dados do pipeline é tratada como ausência real, sem preenchimento com zero.
6. A projeção usa o 30d quando existe. Quando só houver 15d, duplica o 15d como aproximação conservadora para base de 30d e mantém aviso visual.
