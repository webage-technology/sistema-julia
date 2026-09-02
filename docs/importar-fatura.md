# Importar fatura, extrato e corridas (Uber)

> Implementado em **13/08/2026**. Na viagem, **Prestação de contas → Importar
> fatura** lê o arquivo, separa os lançamentos e cria as despesas escolhidas.

## O que dá e o que não dá

**Não dá** para o sistema entrar na conta da Uber ou do banco da Julia: não
existe integração autorizada para isso e o sistema não guarda (nem deve guardar)
essas senhas. Fazer login em nome dela seria raspagem da conta pessoal — frágil
e arriscado.

**Dá** para importar o que essas plataformas já entregam:

| Origem | Como obter |
|---|---|
| Fatura do cartão | app/site do banco → fatura em **PDF, CSV ou OFX** |
| Extrato da conta | mesmo caminho |
| Corridas da Uber | **Uber Empresas** → Relatórios → viagens em **CSV** (também chega por e-mail) |

Como o cartão é usado só nas viagens da empresa, a fatura já é a lista de gastos
da viagem — inclusive as corridas pagas direto no app.

## Como funciona

1. **Envie o arquivo.** PDF passa por extração de texto por linha (data,
   descrição e valor ficam juntos); CSV/OFX/TXT são lidos direto.
2. **A IA separa os lançamentos**: data, descrição limpa, valor e categoria
   (passagem, hospedagem, transporte, alimentação, outro). Ela **ignora** o que
   não é compra: pagamento da fatura anterior, encargos, IOF, juros, anuidade,
   limites, saldo e estornos.
3. **Repetidos vêm desmarcados.** Se já existe despesa na viagem com a mesma
   data e o mesmo valor, o item aparece marcado como “já lançado” e não vem
   selecionado — evita contar duas vezes o gasto que você lançou na hora com a
   foto do recibo.
4. **Você confere e lança.** As despesas criadas ficam com **a própria fatura
   como comprovante** (é ela que prova o gasto).

Depois é só gerar o **Relatório em Excel**: as despesas importadas entram nas
colunas certas como qualquer outra.

## Teste real (fatura CSV com 8 linhas)

Reconheceu 6 compras e classificou todas certo — Uber → transporte, Latam →
passagem, Hotel → hospedagem, Metrô → transporte, Restaurante → alimentação,
Estacionamento → transporte. **Descartou** “PAGAMENTO FATURA ANTERIOR” e
“ENCARGOS E IOF”. Marcou como já lançados os 5 que a viagem já tinha. Levou 8 s.

## Endpoints

| Rota | O que faz |
|---|---|
| `POST /api/viagens/:id/fatura` | Envia o arquivo e **dispara** a leitura → `{ leituraId, arquivo }` |
| `GET /api/fatura/leituras/:id` | `processando` \| `ok` (lançamentos) \| `erro` |
| `POST /api/viagens/:id/despesas/lote` | Cria as despesas escolhidas, com a fatura como comprovante |

A leitura é assíncrona pelo mesmo motivo da planta: passa dos 30 s do proxy em
faturas grandes.

## Limites

- PDF **escaneado** (imagem) não é lido — nesse caso exporte CSV/OFX no app do
  banco.
- A IA lê o que está escrito: se a descrição do estabelecimento for críptica
  (“PG *ABC1234”), a categoria pode sair como “outro” — corrija na lista antes
  de lançar ou depois, na despesa.
- Um arquivo por importação; para vários meses, importe um de cada vez.
