# Análise de Volume — Solicitações Equipe Integrações
**Período analisado:** Out/2025 — Dez/2025
**Gerado em:** 2026-02-21

---

## Visão geral do período

| Mês       | Solicitações | Variação |
|-----------|-------------|----------|
| Jul/2025  | 43          | —        |
| Ago/2025  | 37          | -14%     |
| Set/2025  | 29          | -22%     |
| **Out/2025**  | **60**  | **+107% ⚠️ pico** |
| Nov/2025  | 32          | -47%     |
| Dez/2025  | 21          | -34%     |

---

## 🔴 Outubro/2025 — Pico Operacional (60 solicitações)

### Por que outubro dobrou o volume?

Outubro de 2025 registrou **107% a mais que setembro** e foi o mês com maior volume absoluto no histórico. O pico não foi causado por um único problema, mas por uma **onda simultânea de falhas em integrações de pedidos e produtos** que afetou clientes de múltiplos ERPs.

### Distribuição por tipo de problema

| Categoria                         | Qtd | % |
|-----------------------------------|-----|---|
| Pedido não sobe ao ERP            | 15  | 25% |
| Promoção / Preço / Estoque        | 11  | 18% |
| Carga / Integração de produtos    | 9   | 15% |
| Migração / Configuração           | 4   | 7% |
| Outros (erros variados)           | 21  | 35% |

### ERPs afetados em outubro (13 ERPs diferentes!)

- **Intersolid/Winthor** — 5 ocorrências (maior impacto)
- **Linear** — 3 ocorrências (MIX ATACADÃO com 3 tickets separados)
- **SQL** — 3 ocorrências
- **BLING** — 2 ocorrências
- **Arius** — 2 ocorrências
- **CISS** — 2 ocorrências
- **RPInfo, Shop9, OMIE, Bluesoft, SysPDV, Varejo Fácil, Zanthus** — 1 cada

> 🔑 **Insight principal:** A distribuição por 13 ERPs diferentes indica que não houve uma falha sistêmica única no lado Instabuy — o que ocorreu foi um **período de instabilidade generalizada dos ERPs dos clientes**, possivelmente relacionado a atualizações de API ou versões dos sistemas ERP em Q4/2025.

### Clientes mais demandantes em outubro

| Loja             | Tickets | Tipos de problema |
|------------------|---------|-------------------|
| CASA DO SABÃO    | 4       | Frete, pedidos, preço clube, problemas gerais |
| MIX ATACADÃO     | 3       | Linear (pedidos, produtos, estoque) |
| FRIROCHA         | 3 (+ 2 out/nov) | Shop9 — integração de produtos e pedidos |
| REDESTORE        | 2       | Produtos e categorias |

- **FRIROCHA + Shop9**: levou 3 intervenções separadas em outubro para estabilizar (shop9 produção/pedidos com falha recorrente).
- **MIX ATACADÃO + Linear**: ERP com 3 falhas distintas no mesmo mês.
- **Urgente + Winthor CodPraça** (30/10): bug crítico em campo de praça afetando pedidos do Winthor.

### Distribuição ao longo do mês

Distribuído uniformemente (não houve rush de fim de mês):
- Semana 1 (1-7/out): 16 tasks → maior semana, muitos clientes retornando do início do Q4
- Semana 2 (8-14/out): 11 tasks
- Semana 3 (15-21/out): 11 tasks
- Semana 4 (22-28/out): 12 tasks
- Semana 5 (29-31/out): 10 tasks

### Quem absorveu a demanda

- **Guilherme**: 54 de 60 cards (90%) — ponto único de atenção, sobrecarga evidente
- **Welington**: 7 cards
- **Luís** (suporte/ops): participou em 31 cards como co-responsável

---

## 🟡 Novembro/2025 — Normalização Pós-Pico (32 solicitações)

Volume caiu 47% em relação a outubro, voltando para a média histórica (~30/mês).

### Característica do período

- **Menos emergências, mais configurações**: novembro teve mais tickets de configuração (ClearSale, migração de adquirente, ajuste de Pix) do que correções emergenciais.
- **ZERO HORA** apareceu 2x (produtos duplicados + integração parada) — potencialmente um cliente que ficou com pendências de outubro.
- **Site fora do ar** — BATEL GOURMET (05/11) — emergência pontual.
- **Taxa de rejeição melhorou**: 5/32 rejeitados em nov vs 7/60 em out (em números absolutos menor, mas proporcionalmente similar).

### Conclusão novembro

Outubro "queimou" a fila de demandas represadas. Novembro representa o ritmo natural da equipe sem a pressão acumulada de Q4.

---

## 🔵 Dezembro/2025 — Desaceleração de Fim de Ano (21 solicitações)

### Fatores explicativos

1. **Recesso/férias**: redução natural de demanda nas duas últimas semanas de dezembro.
2. **CASA DO SABÃO** voltou 2x (23/12 e 30/12) com "Erro no envio ao ERP" — possível problema crônico não resolvido definitivamente em outubro.
3. **Consinco como novo ponto de atenção**: BIGBOX (urgente, 02/12) e DONA SUDOESTE (06/12) com falhas no Consinco.
4. **MIX ATACADÃO reintegração** (29/12) — provavelmente ajuste pós-troca de ambiente.

---

## Resumo executivo para apresentação

**Outubro/2025 (60 solicitações — recorde no período):**
> "O pico de outubro foi causado por uma onda de instabilidades em ERPs de clientes — 13 ERPs diferentes foram afetados no mesmo mês. O principal tipo de problema foi 'pedido não sobe ao ERP' (25% dos tickets), indicando falhas nas integrações de envio de pedidos. Os clientes CASA DO SABÃO (4 tickets), MIX ATACADÃO (3) e FRIROCHA (3) concentraram boa parte da demanda. O Guilherme absorveu 90% dos cards, expondo a necessidade de distribuição de carga na equipe."

**Novembro/2025 (32 solicitações):**
> "Queda de 47% em relação ao pico de outubro. A equipe voltou ao ritmo normal após resolver o backlog de urgências. Tickets com perfil mais operacional (configurações, migrações)."

**Dezembro/2025 (21 solicitações):**
> "Menor volume do semestre, reflexo do recesso de fim de ano e da resolução da maior parte das integrações críticas. CASA DO SABÃO apresentou recorrência, indicando que o problema raiz pode não ter sido resolvido completamente."
