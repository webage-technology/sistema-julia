# Sistema Julia

Sistema minimal com **login**, **CRUD de usuários** e **CRUD de clientes**.

Base limpa, clonada do esqueleto do `sistema-arquitetura` (login + usuários + clientes),
sem nenhum dado além do admin do seed.

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
backend/    Express — server.js + src/{store,auth}.js
frontend/   Next.js — app/(login, (app)/users, (app)/clients) + components/ui (shadcn)
```
