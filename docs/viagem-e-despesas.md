# Viagem, cronograma e prestação de contas

> Implementado em **13/08/2026**. Uma **viagem** é uma ida a campo que cobre
> **várias vistorias** — vários imóveis, do mesmo cliente ou de clientes
> diferentes. Guarda o cronograma (voo, ônibus, hotel, traslados), a verba e os
> comprovantes.

## O fluxo

1. **Clientes → Imóveis → Vistorias**: cadastre as vistorias que serão feitas.
2. **Viagens → Nova viagem**: título, destino, ida/volta, responsável e **verba**.
3. Na viagem, **Incluir vistoria**: escolha todas as vistorias daquela ida (busca
   por imóvel, cliente ou tipo).
4. Monte o **cronograma**: cada trecho com horário, localizador, valor e a opção
   **avisar antes**.
5. **Enviar para o calendário** → baixa um `.ics`. Abrindo no celular, os eventos
   entram no calendário nativo; os itens marcados com “avisar” trazem **alarme**.
   O arquivo inclui também **cada vistoria da viagem** como evento do dia.
6. **Em viagem**: a cada gasto, lance a despesa e **fotografe o recibo** (no
   celular o campo abre a câmera). O gasto pode ser geral da viagem ou vinculado
   a uma vistoria específica.
7. **Prestação de contas**: verba × previsto × gasto × saldo, com aviso de
   despesas sem comprovante e de estouro da verba.

## Por que a notificação é pelo calendário

Não depende de e-mail, SMS, servidor de push nem do sistema aberto: o alarme toca
no aparelho, funciona offline e o compromisso aparece junto da agenda pessoal. O
`.ics` é gerado sob demanda com um `VEVENT` por item (mais as vistorias) e
`VALARM` só nos itens marcados.

## Dados

| Tabela | O que guarda |
|---|---|
| `viagens` | título, destino, ida/volta, verba, observações, responsável |
| `viagem_vistorias` | quais vistorias a viagem cobre (N:N) |
| `viagem_itens` | cada trecho: tipo (voo, ônibus, carro, transfer, hotel, vistoria, outro), título, início/fim, origem/destino, localizador, valor, `notificar` + `lembrete_min` |
| `despesas` | gasto da **viagem** (com `vistoria_id` opcional): categoria, descrição, valor, data e o arquivo do comprovante |
| `vistorias.responsavel_id` | profissional que fará aquela vistoria |

Comprovantes ficam em `uploads/despesas/viagem-<id>/`, guardados como vieram — o
valor probatório está no original.

**Uma vistoria só pode estar em uma viagem.** Ao tentar incluí-la numa segunda, a
API responde 422 dizendo em qual viagem ela já está (senão a mesma despesa seria
contada duas vezes).

## Endpoints

| Rota | O que faz |
|---|---|
| `GET/POST /api/viagens` · `GET/PUT/DELETE /api/viagens/:id` | Viagens |
| `POST /api/viagens/:id/vistorias` · `DELETE /api/viagens/:id/vistorias/:vistoriaId` | Vincula/desvincula vistorias |
| `POST /api/viagens/:id/itens` · `PUT/DELETE /api/viagem-itens/:id` | Cronograma |
| `POST /api/viagens/:id/despesas` | Lança despesa (campo `comprovante`, opcional; `vistoriaId` opcional) |
| `GET /api/despesas/:id/comprovante` · `DELETE /api/despesas/:id` | Abre / exclui |
| `GET /api/viagens/:id/calendario.ics` | Cronograma para o calendário do celular |
| `GET /api/viagens/:id/relatorio.xlsx` | Planilha de prestação de contas preenchida (ver [relatorio-despesas.md](relatorio-despesas.md)) |
| `GET /api/cronograma?dias=90` | Próximos compromissos de todas as viagens (Agenda) |

## Telas

- **Vistorias → aba Viagens** (`/viagens`) — a viagem é contexto da vistoria, por
  isso não ocupa item próprio no menu: fica como aba ao lado de Vistorias. Lista
  com destino, período, responsável, nº de vistorias, verba e gasto, com busca.
- `/viagens/:id` — vistorias cobertas, dados/verba, cronograma e prestação de
  contas. Diálogos com URL: `?vincular=1`, `?item=novo`, `?item=12`, `?despesa=1`.
- `/agenda` — calendário do mês com **vistorias e trechos de viagem juntos**,
  filtros de profissional, tipo e busca, e a lista dos próximos compromissos.
- `/vistorias/:id` — mostra a que viagem pertence (ou o atalho para criar uma) e
  o **profissional responsável**.

## Limites conhecidos

- O `.ics` é um arquivo baixado (não é assinatura automática): mudou o
  cronograma, exporte de novo. Os eventos se atualizam sozinhos porque o `UID` de
  cada item é estável.
- Valores em reais, sem conversão de moeda.
- A verba é da viagem inteira; não há teto por categoria.
