# Mapa de URLs

> Regra do sistema (definida em 12/08/2026): **toda tela tem endereço próprio** —
> inclusive as que aparecem como diálogo, as abas e a foto ampliada. Assim dá para
> compartilhar o link, favoritar, recarregar sem perder o lugar e usar o botão
> **voltar** do navegador para fechar o que abriu.

## Páginas

| URL | Tela |
|---|---|
| `/` | redireciona para `/vistorias` |
| `/iniciar` | **iniciar vistoria** — porta de entrada do trabalho de campo (é o `start_url` do app no celular) |
| `/login` | entrar (aceita `?next=/captura/12` para voltar ao destino após o login) |
| `/agenda` | agenda geral: vistorias + trechos de viagem, com filtros |
| `/vistorias` | lista de vistorias |
| `/vistorias/:id` | a vistoria (ações, pavimentos e ambientes) |
| `/vistorias/:id/conferencia` | conferência das fotos (fita cronológica) |
| `/vistorias/:id/relatorio` | aba Relatório: tipo da vistoria e laudo (EVTL) |
| `/vistorias/:id/claquetes` | cartões de claquete para imprimir |
| `/viagens` | viagens (cada uma cobre várias vistorias) |
| `/viagens/:id` | a viagem: vistorias, cronograma, verba e prestação de contas |
| `/imoveis` | lista de imóveis |
| `/imoveis/:id` | o imóvel (planta e modelo de ambientes) |
| `/clients` | clientes |
| `/users` | usuários |
| `/ia` | IA — Claude Code via WebAge Hub (só administradores) |
| `/captura/:id` | captura guiada no celular (tela cheia, fora do menu) |

## Estados com endereço próprio

| URL | O que abre |
|---|---|
| `/vistorias?nova=1` | formulário de nova vistoria |
| `/vistorias/:id?captura=1` | link e QR para capturar no celular |
| `/vistorias/:id?editar=1` | editar dados da vistoria |
| `/vistorias/:id/conferencia?foto=123` | **a foto 123 ampliada** — o link de uma foto específica |
| `/imoveis?novo=1` | formulário de novo imóvel |
| `/imoveis/:id?editar=1` | editar o imóvel |
| `/imoveis/:id?nova-vistoria=1` | criar vistoria desse imóvel |
| `/imoveis/:id?ler-planta=1` | leitura da planta com a lista de ambientes para conferir |
| `/clients?novo=1` · `/clients?editar=7` | novo cliente · editar o cliente 7 |
| `/users?novo=1` · `/users?editar=3` | novo usuário · editar o usuário 3 |
| `/agenda?mes=2026-09` | agenda em outro mês |
| `/agenda?dia=2026-08-20` | agendar vistoria naquele dia |
| `/agenda?responsavel=3` | **agenda só daquele profissional** (link do usuário e de “Minha agenda”) |
| `/agenda?tipo=voo` · `?busca=cuiaba` | filtros por tipo de compromisso e por texto (combináveis) |
| `/viagens?nova=1` | criar viagem |
| `/viagens/:id?vincular=1` | incluir vistorias na viagem |
| `/viagens/:id?item=novo` · `?item=12` | novo item do cronograma · editar o item 12 |
| `/viagens/:id?despesa=1` | lançar despesa com comprovante |
| `/viagens/:id?fatura=1` | importar fatura do cartão, extrato ou CSV da Uber |
| `/clients?busca=silva` · `/imoveis?busca=galpao` · `/vistorias?busca=bombeiro` | listas filtradas (a busca fica no link) |
| `/ia?aba=pergunta` | aba "Perguntar à IA" |
| `/ia?job=745` | acompanha o job 745 (log ao vivo) — dá para fechar e voltar depois |

Renomear pavimento/ambiente segue sem URL: é ação pontual de um item da lista,
não uma tela.

## Como é feito

`frontend/lib/url.ts`:

- **`useParamEstado(nome)`** — liga um parâmetro da query ao estado do componente.
  Abrir empilha no histórico (voltar fecha), fechar remove o parâmetro, e o valor
  é lido da URL ao carregar (link direto ou F5). Usa `history.pushState` — que o
  Next 14 sincroniza com o roteador — em vez de `useSearchParams`, que exigiria
  envolver toda página num `<Suspense>`.
- **`useTitulo(titulo)`** — título da aba por página ("Vistoria #3 — Galpão ·
  Sistema Julia"). É o nome sugerido ao favoritar.

Padrão ao adicionar uma tela nova:

```tsx
const [novo, setNovo] = useParamEstado('novo')
const open = novo === '1'
useTitulo(open ? 'Novo item' : 'Itens')
// …
<Dialog open={open} onOpenChange={(o) => !o && setNovo(null)}>
```

Preencha o formulário num `useEffect` que observa o estado da URL — não no clique
do botão — senão o link direto abre o diálogo vazio.

**Cuidado com o `return` de carregamento.** Páginas de detalhe fazem
`if (!det) return <p>Carregando…</p>`. Todo hook (`useParamEstado`, `useEffect`,
`useTitulo`…) precisa vir **antes** dessa linha — um hook depois dela roda só
quando os dados chegam e quebra a tela com *"Rendered more hooks than during the
previous render"*. Aconteceu ao adicionar a leitura da planta em 12/08/2026.

## Verificado em 12/08/2026

As 25 URLs acima responderam `200` (e `/` deu `307` para `/vistorias`), com
TypeScript limpo.
