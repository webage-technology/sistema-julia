# Relatório da vistoria — EVTL

> Implementado em **13/08/2026**. O relatório mora **dentro da vistoria**
> (aba **Relatório**, em `/vistorias/:id/relatorio`), porque é o produto daquele
> trabalho de campo.

## Tipo de vistoria e modelo do relatório

No topo da aba, os **tipos de vistoria** aparecem como botões — um clique define
o tipo daquela vistoria (também disponível na tela principal da vistoria). Abaixo,
os **modelos de relatório**: hoje o **EVTL** está pronto; laudo de bombeiro e
as-built ficam visíveis como “em breve”, para o lugar deles já estar reservado.

## EVTL: divergências planta × realidade

Cada item do relatório é uma divergência, com:

- **Título** (ex.: “Depósito: existe no local e não consta na planta”);
- **Foto da planta aprovada** e **foto atual**, lado a lado;
- **Descrição técnica**, escrita à mão ou pela IA.

### De onde vêm as divergências

A vistoria já sabe quais são: ambientes criados em campo (`origem = campo`, ou
seja, existem no local e não estavam na planta) e ambientes marcados como
inexistentes (`situacao = nao_existe`). O botão **“Trazer N da vistoria”** cria
todos de uma vez, **já com as fotos escolhidas**:

- **planta** → a *claquete* do ambiente (a primeira foto, que na prática é a
  planta apontada — o hábito de campo da Julia vira dado do laudo);
- **atual** → a foto marcada como *destaque*, ou a primeira foto comum.

Também dá para incluir divergências manualmente (uma parede removida, por
exemplo, que não muda a lista de ambientes).

### Escrever com a IA

O botão **Escrever com a IA** redige o parágrafo técnico a partir do que o
sistema já sabe: ambiente, pavimento, tipo de divergência, anotação de campo e
medidas. O texto sai no tom do laudo (“Verificou-se que…”), sem inventar medidas
ou materiais, e fica editável — a Julia revisa antes de emitir.

### Saída

**Imprimir / PDF** usa a impressão do navegador: a tela esconde os controles e
imprime só o laudo (cabeçalho com imóvel, cliente, endereço, número e data da
vistoria, responsável; depois as divergências numeradas, cada uma sem quebrar
entre páginas).

## Endpoints

| Rota | O que faz |
|---|---|
| `GET /api/vistorias/:id/divergencias` | Itens do laudo + sugestões ainda não incluídas |
| `POST /api/vistorias/:id/divergencias` | Cria item manual |
| `POST /api/vistorias/:id/divergencias/sugerir` | Cria todos os sugeridos, com as fotos |
| `PUT/DELETE /api/divergencias/:id` | Edita (título, texto, fotos, ambiente, ordem) / exclui |
| `POST /api/divergencias/:id/texto` | Redige a descrição técnica com a IA do Hub |

Tabela `divergencias` (vistoria, ambiente, título, descrição, foto da planta,
foto atual, ordem).

## Limites conhecidos

- A saída é a impressão do navegador (salvar como PDF). Um PDF gerado no
  servidor, com capa e numeração de páginas, é o próximo passo natural.
- Um modelo pronto (EVTL). Os outros tipos aparecem desabilitados até serem
  desenhados com a Julia.
