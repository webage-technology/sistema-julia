# Segurança, papéis e cópia de segurança

> Implementado em **08/09/2026** como parte da camada de regularização
> ([`regularizacao.md`](regularizacao.md), itens 19 e 20).

## Sessão

- Login devolve o JWT (guardado em `localStorage['sj_token']`, enviado no header
  `Authorization`) **e** define o cookie HttpOnly `sj_sessao`. O cookie só vale
  para **GET** — é o que faz `<img src>` e downloads funcionarem sem o token na
  URL (antes ia em `?token=`, que vaza para log do túnel, histórico e prints).
  Requisição que altera dados exige o header, o que fecha CSRF por link.
- `POST /api/logout` apaga o cookie. Sessão dura 7 dias.
- Segredo do JWT: `JWT_SECRET` no `.env` (gerado em 08/09/2026). Sem ele o
  backend sobe com um valor de desenvolvimento e **avisa no log**. Trocar o
  segredo invalida todos os logins.
- Limite de tentativas: 5 falhas seguidas por IP+e-mail bloqueiam por 15 min
  (`429`).

## Papéis

| Papel | Pode |
|---|---|
| `admin` | Tudo: usuários, configurações, auditoria, lixeira, IA |
| `arquiteto` | Processos, vistorias, laudos (emitir), exclusões, verba das viagens |
| `estagiario` | Captura, conferência, cadastros — sem excluir, sem emitir, sem dinheiro |
| `financeiro` | Verba das viagens, despesas e prestação de contas; consulta o resto |

O papel viaja no token (`permitir(...)` em `src/auth.js`); mudar o papel de
alguém vale no próximo login. `user` da base antiga virou `arquiteto`.
Usuário **desativado** não entra, mas o histórico dele fica.

## Senha

- **Esqueci a senha** (`/esqueci-senha`): com SMTP configurado, o link vai por
  e-mail; sem SMTP, a tela orienta a pedir ao administrador.
- **Administrador gera o link** na tela de usuários (ícone de chave) e manda
  por onde quiser. Vale 1 hora, uma vez.
- Troca da própria senha: `PUT /api/minha-senha`.

## Auditoria e lixeira

- `auditoria`: login, criar/editar/excluir cadastros, mudança de etapa e de
  status, emissão de laudo, pagamento, envio pelo portal, aprovação do cliente.
  Tela `/auditoria` (admin) e aba *Histórico* de cada processo.
- Exclusão de cliente, imóvel, vistoria e processo é **lógica**
  (`excluido_em`). Excluir o cliente leva imóveis, vistorias e processos com o
  mesmo instante; restaurar o cliente traz tudo de volta. Apagar de vez
  (arquivos inclusive) só na `/lixeira`, pelo administrador.

## Limpeza de dados

Para zerar a base depois dos testes, sem derrubar o banco:
*Configurações → Backup e dados → **Limpar dados do sistema*** (`?limpar=1`).
O diálogo lista os grupos com quantos registros cada um tem hoje e o
administrador marca o que apagar; escrever `APAGAR` libera o botão.

Grupos (`backend/src/dados.js`): auditoria · notificações · laudos ·
relatórios · viagens e despesas · arquivos (GED) · processos · vistorias e
fotos · imóveis · clientes · textos/documentos/checklists · numeração ·
usuários (menos você). Marcar um grupo marca os que ele **arrasta** por
dependência (cliente → imóvel → vistoria), porque o banco apaga em cascata.

Isto **não** passa pela lixeira: os registros somem do banco (num só
`BEGIN/COMMIT` — se algo falhar, nada é apagado) e os arquivos correspondentes
saem do disco. Faça uma cópia de segurança antes.

## Backup

O banco e as fotos vivem só nesta máquina (volume Docker `uploads_data`).

```powershell
# uma vez, como administrador, na raiz do projeto — tarefa diária às 02:30
powershell -ExecutionPolicy Bypass -File scripts\registrar-backup.ps1

# manual
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
```

`scripts/backup.ps1` deixa em `backups/` o `db-<data>.sql.gz` (pg_dump) e o
`uploads-<data>.tgz` (tar do volume via container `alpine`), mantém 14 cópias
e replica em `BACKUP_DESTINO_EXTRA` se a variável estiver definida (disco
externo, pasta sincronizada). A pasta é montada **só para leitura** no backend
(`./backups:/app/backups:ro`): o painel mostra a última cópia e avisa
(notificação diária aos administradores) quando passa de 2 dias.

Restaurar:

```powershell
# banco
docker compose exec -T db sh -c 'gunzip -c' < backups\db-2026-09-08-0230.sql.gz | docker compose exec -T db psql -U sysjulia -d sistema_julia
# uploads (com o stack parado)
docker run --rm -v sistema-julia_uploads_data:/dados -v ${PWD}\backups:/entrada alpine sh -c "cd /dados && tar xzf /entrada/uploads-2026-09-08-0230.tgz"
```

## Sem sinal

`public/sw.js` (registrado em toda tela da equipe) guarda em cache os chunks do
Next, as páginas visitadas e as respostas de `GET /api/vistorias/:id`,
`/pinos` e a imagem da planta. A tela de captura abre num galpão sem sinal
depois de ter sido aberta uma vez com sinal; as fotos já iam para a fila do
IndexedDB e sobem quando a conexão volta.
