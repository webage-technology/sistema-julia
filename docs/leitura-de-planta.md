# Leitura da planta → pavimentos e ambientes

> Implementado e testado em **12/08/2026** com a planta real *1340 Santa Beatriz*.
> Na página do imóvel, depois de enviar a planta em PDF, o botão **“Ler planta e
> sugerir ambientes”** monta a lista de pavimentos e ambientes para conferência.

## Como funciona

Duas etapas, propositalmente separadas:

1. **Extração de texto (determinística)** — `backend/src/planta.js` lê o PDF com
   `pdfjs-dist` e pega cada texto **com a posição (x,y)**. Plantas geradas em CAD
   trazem os nomes dos ambientes como texto de verdade. Se o PDF for um
   escaneamento (sem camada de texto), o sistema **avisa** em vez de inventar:
   *“Esta planta não tem texto para ler…”*.
2. **Classificação (IA)** — os textos vão para o Claude do WebAge Hub, que separa
   o que é ambiente do que é ruído e devolve JSON com pavimentos e ambientes.

Nada é gravado automaticamente: a tela mostra a sugestão para a Julia revisar, e
só o que estiver marcado vira modelo do imóvel.

## O que a IA é instruída a ignorar

Combate a incêndio e emergência (extintores, hidrantes, mangueiras, acionadores,
sirenes, saídas e rotas, iluminação/sinalização, corrimão, guarda-corpo), cotas,
áreas em m², escalas, níveis, lotação (“40 Alunos”), cálculos e memoriais,
endereços, matrículas, carimbo e legendas.

Regras aplicadas ao que sobra: repetições viram ambientes numerados
(`SALA DE AULA (8x)` → *Sala de Aula 1…8*; nomes que já vêm numerados na planta,
como `SALA 01` e `SALA 02`, mantêm o número original), siglas são expandidas
(`W.C.` → Banheiro, `D.M.L.` → Depósito de Material de Limpeza, `P.N.E.` →
Banheiro PNE) e a ordem segue uma varredura espacial (de cima para baixo, da
esquerda para a direita), servindo de ponto de partida para a ordem do caminho.

## Várias pranchas (a causa mais comum de “faltou ambiente”)

Plantas de projeto vêm em pranchas: o carimbo traz `01/05`, `02/05`… **Cada
arquivo tem só os ambientes daquele trecho.** Por isso o imóvel aceita **várias
plantas de uma vez** (selecione todos os PDFs no envio) e a leitura processa
todas juntas, devolvendo um pavimento por prancha.

O sistema também soma as marcas `X/Y` de tudo que foi enviado e avisa quando
falta gente: *“Faltam pranchas: você enviou 1 de 5”* — assim fica claro que os
ambientes ausentes estão nos arquivos que não subiram, e não que a leitura errou.

Foi exatamente o caso do teste: o arquivo *1340 Santa Beatriz* é a prancha
**01/05** (só o Térreo, 17 ambientes — todos capturados). Hall, coordenação,
financeiro, CPD, atendimento ao aluno e diretoria **não existem como texto nesse
arquivo**; estão nas outras quatro pranchas. Verificado com dois modos de
extração do pdfjs (simples e `includeMarkedContent`): ambos devolvem os mesmos
256 textos.

Os arquivos ficam em `uploads/plantas/<imovelId>/NN - <nome original>.pdf`; a
listagem da pasta alimenta a tela (cada prancha vira um link) e a leitura. Imóveis
antigos, com uma planta só em `plantas/<id>.pdf`, continuam funcionando.

## Duas passadas da IA

1. **Leitura** — classifica todos os textos em pavimentos e ambientes.
2. **Resgate** — a IA revisa só o que sobrou e diz o que ainda é ambiente. Existe
   porque a primeira passada às vezes esquece um cômodo; é conservadora (na
   dúvida, não inclui) e, se falhar, a leitura principal continua valendo.

Se ainda faltar algo, o rodapé do diálogo tem **“Faltou ambiente? Ler de novo com
mais capacidade”**, que repete a leitura com um modelo mais forte (mais lento).

## Rede de segurança: “textos que a IA não usou”

A IA erra por omissão de vez em quando. Por isso o resultado traz também a lista
de textos que **parecem** nome de ambiente e não foram aproveitados — com um
clique a Julia promove qualquer um a ambiente. Essa lista é calculada por código
(não pela IA) e ignora o filtro de ruído, para que um engano no filtro não
esconda o mesmo ambiente duas vezes. Siglas conhecidas (`D.M.L.`, `W.C.`…) não
reaparecem ali depois de expandidas, evitando cadastro em duplicidade.

## Aplicar ao modelo

`POST /api/imoveis/:id/estrutura` cria pavimentos e ambientes em lote, numa
transação, **ignorando o que já existe com o mesmo nome** — dá para aplicar de
novo (ou aplicar duas plantas do mesmo imóvel) sem duplicar.

## Endpoints

| Rota | O que faz |
|---|---|
| `POST /api/imoveis/:id/planta` | Envia **uma ou várias** pranchas (campo `planta`, até 20). Substitui o conjunto |
| `GET /api/imoveis/:id/planta?arquivo=N` | Abre a prancha N (0 = primeira) |
| `POST /api/imoveis/:id/planta/ler` | **Dispara** a leitura de TODAS as pranchas e responde na hora `{ leituraId }`. Aceita `{ model }`; padrão `sonnet` |
| `GET /api/planta/leituras/:leituraId` | Resultado: `processando` \| `ok` (com os dados) \| `erro`, e há quantos segundos |
| `POST /api/imoveis/:id/estrutura` | Aplica `{ pavimentos: [{ nome, ambientes: [] }] }` ao modelo |

### Por que a leitura é assíncrona

A primeira versão respondia tudo numa requisição só — e dava **erro 500 aos 30
segundos**: é o limite do proxy do Next (`/api/*` → backend), e o túnel público
corta em ~100 s. Como a leitura leva de 30 s a 1,5 min, a requisição nunca
sobreviveria. Agora o backend inicia o trabalho, devolve um número na hora, e a
tela pergunta o resultado de 2 em 2 segundos (mostrando o cronômetro). Efeito
colateral bom: dá para recarregar a página no meio sem perder a leitura, e uma
segunda chamada para o mesmo imóvel reaproveita a leitura em andamento.

As leituras ficam em memória do backend por 15 minutos após terminarem. Se o
backend reiniciar no meio, a tela avisa e basta ler de novo.

Tela: `/imoveis/:id?ler-planta=1` (o diálogo tem endereço próprio, como as demais).

## Resultado no teste real (1340 Santa Beatriz, 1 página, 256 textos)

Detectou **Térreo** com 17 ambientes: 8 × Sala de Aula, Sala Google, Anfiteatro 01,
2 × Espaço para Recreação, Lanchonete, Dança, Banheiro PNE, Depósito de Material
de Limpeza e Banheiro. Descartou todo o conteúdo de bombeiro, as ruas do entorno,
cotas e legendas. Não criou “Pavimento Superior” a partir da seta
*“VAI PARA PAVIMENTO SUPERIOR”* — corretamente, já que a planta dele não estava
no arquivo.

### Um bug encontrado no caminho (vale lembrar)

O filtro de ruído tinha a sigla `crea` sem delimitador de palavra — e ela casa
**dentro** de “re**crea**ção”. Isso descartava “Espaço para Recreação” antes
mesmo de a IA ver o texto. Siglas curtas no filtro (`crea`, `cau`, `art`, `rrt`)
agora só casam isoladas (`\b…\b`). Cuidado com esse tipo de regra ao adicionar
novos filtros.

## Limites

- Só PDF com camada de texto (CAD). Planta escaneada precisa de OCR — não feito.
- **Cuidado com o PDF “de CAD” sem texto:** algumas exportações convertem as
  fontes em curvas — o arquivo parece um PDF vetorial normal, mas `pdfjs` devolve
  zero textos e a leitura é recusada. Foi o caso das *Pranchas Unificadas — Casa
  Pacaembu*: 13 páginas vetoriais, nenhum caractere. Nesses casos, ou se pede o
  PDF com texto pesquisável ao projetista, ou os ambientes entram à mão.
- Uma página com várias plantas pequenas (implantação + baixa) pode confundir o
  pavimento; a revisão manual resolve.
- A leitura leva de 30 s a 1,5 min, dependendo do tamanho da planta.
