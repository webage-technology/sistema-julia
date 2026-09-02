# Relatório de despesas em Excel (preenchido pela IA)

> Implementado em **13/08/2026**. Na viagem, o botão **Relatório em Excel** baixa
> a planilha-padrão da Julia já preenchida com os gastos daquela viagem.

## O que a IA faz

A planilha separa os gastos em colunas: **METRO, ÔNIBUS, UBER|TÁXI, ALIMENT,
CORREIO, TAXAS e TERCEIROS**. O sistema guarda categorias mais largas
(transporte, alimentação, hospedagem, passagem, outro) mais a descrição livre —
então quem decide a coluna certa é a IA, lendo categoria + descrição de cada
lançamento. Ela também escreve uma **observação curta** para a linha
(“aeroporto → hotel”, “hotel 2 diárias”, “sedex documentos”).

Resultado no teste real (7 despesas):

| Despesa lançada | Coluna escolhida |
|---|---|
| Uber aeroporto até o hotel | UBER \| TÁXI |
| Metrô até o centro | METRO |
| Ônibus rodoviário Cuiabá → Várzea Grande | ÔNIBUS |
| Almoço da equipe | ALIMENT |
| Hotel Center — 2 diárias | TERCEIROS |
| Sedex de documentos | CORREIO |
| Estacionamento do prédio | TAXAS |

**Sem IA o relatório continua saindo:** há uma regra fixa por palavra-chave e
categoria, usada como plano B (e acionável com `?ia=0`). O cabeçalho da resposta
`X-Classificacao` informa qual caminho foi usado (`ia` ou `regra`).

## O que é preenchido

- **Lançamentos** (linhas 6 a 30): data, `CLIENTE | UNIDADE` (cliente e imóvel
  quando a despesa está vinculada a uma vistoria), processo, o valor na coluna
  certa e a observação. Despesa sem comprovante anexado sai marcada
  “(sem comprovante)” — quem confere vê na hora.
- **Rodapé**: funcionário responsável, líder conferente, período de apuração,
  total de antecipação (a verba), total de despesas, retenção para a próxima
  semana com o motivo, e o **saldo a restituir**
  (`verba − gasto − retenção`).

Se houver mais despesas do que linhas na planilha, o cabeçalho
`X-Despesas-Fora` diz quantas ficaram de fora (o modelo tem 25 linhas).

## Campos acrescentados na viagem (para a planilha)

Em **Viagem → Dados do relatório de despesas**:

| Campo | Onde entra na planilha |
|---|---|
| Processo / contrato | coluna PROCESSO de cada linha |
| Líder conferente | `LÍDER CONFERENTE =>` |
| Retenção p/ próxima semana | `RETENÇÃO PARA DESPESAS PRÓXIMA SEMANA =>` |
| Motivo da retenção | `MOTIVO RETENÇÃO` |

O responsável, o período e a verba já vinham dos dados da viagem.

## Endpoint

`GET /api/viagens/:id/relatorio.xlsx` — gera na hora (≈10 s com IA) e baixa.
`?ia=0` pula a IA. Modelo em `backend/templates/relatorio-despesas.xlsx`
(o arquivo original da Julia, preservado com formatação, logo e fórmulas).

## Acentuação

Um bug real foi corrigido junto: o **nome do arquivo enviado** (comprovante,
planta, foto) chegava como “Recibo AlimentaÃ§Ã£o.pdf”, porque a biblioteca de
upload lê o nome como latin1. `nomeOriginal()` em `backend/src/uploads.js`
desfaz isso; textos digitados nos formulários nunca tiveram esse problema.
Verificado que ZIP de fotos (bandeira UTF-8), `.ics` e a planilha saem com
acento correto.
