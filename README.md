# Sistema Julia

Sistema de **regularização e vistorias** da Julia (Plenno Arquitetura):
**processos** com a prefeitura (etapas, protocolos com prazo, documentos exigidos,
RRT, despesas), imóveis com ficha cadastral e planta com pinos, o **módulo de
vistorias** — captura guiada de fotos pelo celular (PWA, com GPS), conferência por
fita cronológica, quadro de áreas, checklists e não conformidades — e os
entregáveis: laudos em **PDF emitidos e versionados**, documentos Word, export em
ZIP, portal do cliente. Com papéis, auditoria, lixeira, notificações e backup.

Camada de regularização (as 20 funcionalidades de 08/09/2026): [`docs/regularizacao.md`](docs/regularizacao.md).
Segurança, papéis e backup: [`docs/seguranca-e-backup.md`](docs/seguranca-e-backup.md).

Plano e decisões: [`docs/plano-modulo-vistorias.md`](docs/plano-modulo-vistorias.md).
Integração com o Claude Code do WebAge Hub: [`docs/integracao-webage-hub.md`](docs/integracao-webage-hub.md).
Endereços de todas as telas: [`docs/mapa-de-urls.md`](docs/mapa-de-urls.md).
Leitura da planta (PDF → ambientes): [`docs/leitura-de-planta.md`](docs/leitura-de-planta.md).
Viagem, cronograma e despesas: [`docs/viagem-e-despesas.md`](docs/viagem-e-despesas.md).
Relatório de despesas em Excel (IA): [`docs/relatorio-despesas.md`](docs/relatorio-despesas.md).
Relatório da vistoria (EVTL): [`docs/relatorio-evtl.md`](docs/relatorio-evtl.md).
Importar fatura / corridas: [`docs/importar-fatura.md`](docs/importar-fatura.md).

- **Backend:** Express (Node, PostgreSQL via `pg`, JWT, senha com scrypt) — container `4700`, host `4703`.
- **Frontend:** Next.js 14 + Tailwind + shadcn/ui — container `3500`, host `3503`.
- **Banco:** PostgreSQL 16 — host `5563` (só no loopback).

## Rodar

```bash
docker compose up -d --build
```

- Frontend: http://localhost:3503
- Backend:  http://localhost:4703/api/health
- Público (WebAge Hub tunnel): https://sistema-julia-dev.webage.com.br

O frontend chama a API na mesma origem (`/api/*`); o Next faz proxy para o backend.

## Login padrão

Criado automaticamente no primeiro boot:

- **admin@sistema-julia.local** / **admin123** — troque em Usuários (ou gere um link de redefinição).

Papéis: administrador, arquiteto(a), estagiário(a), financeiro. Só o administrador
mexe em usuários e configurações.

## Estrutura

```
backend/    Express — server.js + src/*.js
            vistorias/fotos/uploads/planta/viagens/relatorios/modelos/lip/divergencias (vistoria)
            schema-regularizacao/processos/arquivos/escritorio/auditoria/lixeira/inspecao/
            areas/comparar/planta-pinos/pdf/laudos/portal/notificacoes/painel/seguranca (regularização)
            hub.js = ponte com o Claude Code do WebAge Hub (/api/hub/*)
            Fotos/plantas/laudos/arquivos no volume docker uploads_data
frontend/   Next.js — app/(login, esqueci-senha, redefinir-senha,
            (app)/{painel,processos,clients,imoveis,vistorias,relatorios,agenda,financeiro,
                   notificacoes,users,configuracoes,auditoria,lixeira,ia},
            captura/[id] (PWA, tela cheia), portal/[token] (cliente))
            public/sw.js = service worker (abre sem sinal)
scripts/    backup.ps1 + registrar-backup.ps1 (cópia diária), ícones do PWA, fotos de teste
backups/    cópias geradas pelo backup (montada só para leitura no backend)
```

## Variáveis de ambiente

Copie `.env.example` para `.env` (não versionado):

- `JWT_SECRET` — segredo das sessões (obrigatório fora do desenvolvimento).
- `HUB_URL`, `HUB_INTEGRATION_KEY` — integração com o Claude do WebAge Hub. Sem
  elas o sistema funciona; ficam indisponíveis a aba **IA**, a leitura de planta
  (texto e imagem), a fatura por IA e o "escrever com a IA".

E-mail (SMTP) e WhatsApp (Evolution API) das notificações são configurados na
tela **Configurações → Notificações**, não em variáveis de ambiente.
