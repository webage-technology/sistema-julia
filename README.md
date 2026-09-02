# Sistema Julia

Sistema de **vistorias** da Julia: login, usuários, clientes, imóveis e o
**módulo de vistorias** — captura guiada de fotos pelo celular (PWA), conferência
por fita cronológica e export em ZIP no formato do entregável
(pastas por pavimento/ambiente, fotos numeradas na ordem do caminho).

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

- **admin@sistema-julia.local** / **admin123**

## Estrutura

```
backend/    Express — server.js + src/{db,auth,vistorias,fotos,uploads,hub}.js
            Fotos/plantas no volume docker uploads_data (orig + web + thumb)
            hub.js = ponte com o Claude Code do WebAge Hub (/api/hub/*)
frontend/   Next.js — app/(login, (app)/{users,clients,imoveis,vistorias,ia}, captura/[id])
            captura/[id] = tela de campo (PWA, fora do layout com sidebar)
scripts/    utilitários (gerar ícones do PWA, fotos de teste)
```

## Variáveis de ambiente

Copie `.env.example` para `.env` (não versionado) para ligar a integração com o
Hub (`HUB_URL`, `HUB_INTEGRATION_KEY`). Sem elas o sistema funciona normalmente —
só a aba **IA** fica indisponível.
