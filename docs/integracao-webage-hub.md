# Integração com o WebAge Hub — Claude Code

> Implementada e testada em **12/08/2026**.
> Objetivo: o Sistema Julia usar o **Claude Code CLI** que roda no WebAge Hub —
> pedir alterações no próprio código, acompanhar o log ao vivo e usar o Claude
> como provedor de texto, sem instalar nada aqui e sem chave da Anthropic.

## Como funciona (o desenho)

O `claude` CLI **não roda neste sistema**. Ele vive na máquina do Hub, cujo backend
roda no **host** (fora do Docker) justamente para ter `git` + `claude` + a sessão
logada. O Hub expõe uma API de integração autenticada por uma **chave por sistema**
(header `X-Integration-Key`).

```
navegador  →  /api/hub/*  →  backend do Sistema Julia  →  Hub (host:4601)  →  claude CLI
   (JWT)         (JWT)         (guarda a chave)            (X-Integration-Key)
```

A chave **nunca vai ao navegador**: fica na env `HUB_INTEGRATION_KEY` do backend.
O endpoint de status remove a `key` que o Hub devolve no `resolve` antes de
responder ao frontend.

## O que o Sistema Julia já é no Hub

| Item | Valor |
|---|---|
| ID no Hub | `sys_bf5dede56631` |
| Caminho local | `E:\Workspace\felix\sistema-julia` |
| Repositório GitHub | **não tem** → os jobs rodam em **modo local** |
| URL pública | https://sistema-julia-dev.webage.com.br |

**Modo local:** o Hub roda o Claude Code direto sobre esta cópia de trabalho e
deixa as alterações no working tree (sem branch, sem PR). Se um dia o repositório
ganhar remoto no GitHub, o modo PR passa a ser possível — e o chat que lê o código
(abaixo) também.

## Configuração

`.env` ao lado do `docker-compose.yml` (não versionado — veja `.env.example`):

```env
HUB_URL=http://host.docker.internal:4601
HUB_INTEGRATION_KEY=wsk_…            # Hub → Sistemas → Sistema Julia
```

O serviço `backend` no compose recebe essas variáveis e ganha
`extra_hosts: host.docker.internal:host-gateway` para alcançar o backend do Hub,
que roda fora do Docker. Sem a chave, a tela de IA aparece como
"integração não configurada" e nada é enviado.

## Endpoints (`backend/src/hub.js`)

Todos exigem login (JWT) no Sistema Julia. Os que **alteram código** exigem
`role = admin` — a Julia usa o sistema; quem o edita é quem administra.

| Rota | Quem | O que faz |
|---|---|---|
| `GET /api/hub/status` | logado | Ponte configurada? Hub online? Qual sistema o Hub enxerga |
| `POST /api/hub/teste` | logado | **Teste de um clique**: percorre configuração → Hub → Claude respondendo de verdade → permissão, devolvendo uma etapa por passo com tempo |
| `POST /api/hub/texto` | logado | Completação texto→texto pelo Claude do Hub (`ai-text`) |
| `POST /api/hub/jobs` | **admin** | Enfileira alteração por IA (modo `local`) |
| `GET /api/hub/jobs/:id` | **admin** | Status + **log ao vivo** (o frontend faz polling de 2s) |
| `POST /api/hub/jobs/:id/{pause,cancel,resume,revert}` | **admin** | Controles do job |
| `POST /api/hub/chats`, `POST …/mensagens`, `GET …` | logado | Chat que lê o código — **só com repositório GitHub** |

## Tela

**IA** no menu lateral (só aparece para administradores), em `/ia`:

- **Status** da ponte no topo (conectado como "Sistema Julia", modo de edição), com
  o botão **Testar integração**: mostra as 4 etapas com ✓/✗, tempo de cada uma e o
  custo da chamada real ao Claude. É o primeiro lugar a olhar quando algo falhar.
- **Pedir alteração no sistema** — título, modelo (Haiku/Sonnet/Opus/padrão),
  descrição; ao enviar, mostra o job com **log ao vivo** e os botões Pausar,
  Parar, Retomar e Desfazer.
- **Perguntar à IA** — conversa só de leitura. Sem repositório GitHub, usa a
  completação de texto (a IA responde **sem abrir os arquivos**); com repositório,
  passa a usar o chat que lê o código.

## O que foi testado (12/08/2026)

| Teste | Resultado |
|---|---|
| `GET /api/hub/status` | conectado como "Sistema Julia", `hasRepo: false` |
| `POST /api/hub/teste` (botão) | 4/4 etapas OK — Claude respondeu "PONTE OK" em 4,4 s (US$ 0,0077) |
| Chave vazando para o navegador | **não** — `key` removida da resposta |
| `POST /api/hub/texto` | Claude do Hub respondeu ("PONTE OK"), com uso e custo |
| `POST /api/hub/jobs` | job **#745** criado no Hub, modo `local` |
| `GET /api/hub/jobs/:id` (log ao vivo) | validado com o job **#744** em execução — 7 KB de log em tempo real |
| `cancel` de job na fila | `canceled: false` (o Hub só mata job em execução) |
| Sem token / usuário comum | `401` / `403` nas rotas de alteração |
| Chat que lê o código | `Sistema sem repositório GitHub configurado` (esperado) |

### Detalhe importante: um Claude por cópia local

O Hub **serializa** os jobs por caminho local — dois Claudes não editam a mesma
cópia ao mesmo tempo. Por isso o job de teste #745 ficou `queued`: a própria
sessão que implementou esta integração (job #744) segurava o caminho. Ele roda
sozinho quando a sessão terminar; o prompt é só-leitura ("não altere nenhum
arquivo"), então não muda nada. Para dispensá-lo antes, é só cancelá-lo na aba
**IA** do sistema dentro do Hub.

## Quando aparecer “Hub inacessível”

O backend do Hub roda **no host** (fora do Docker), porque precisa de `git` + o
`claude` CLI logado. Se ele parar — reinício da máquina, janela fechada — a ponte
cai, e a mensagem já diz o que fazer: subir `webage-hub\backend\start-host.cmd`.

Para que uma queda de segundos não derrube um trabalho de um minuto (ler uma
planta, por exemplo), falhas de **conexão** são tentadas 3 vezes, com espera
crescente. Erros de resposta (chave inválida, 4xx) não são repetidos, e o
indicador de status na tela usa uma tentativa só, para não travar a página.

## Limites conhecidos

- **Chat que lê o código** exige repositório GitHub no Hub (hoje não há remoto).
- Enquanto houver um job rodando sobre esta cópia local, o próximo espera na fila.
- O backend do Hub precisa estar de pé no host (`backend\start-host.cmd`); se
  cair, o status mostra "Hub inacessível" e nada é enviado.
