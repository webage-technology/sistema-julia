-- Zera a base de trabalho: nenhum cliente, imóvel, vistoria, foto, processo,
-- viagem ou laudo emitido. Fica de pé o esqueleto do escritório — os usuários e
-- a BIBLIOTECA DE MODELOS (os .docx da Julia e o "Relatório fotográfico"
-- nativo), que é o que se quer levar para a base limpa.
--
-- Rodar da raiz do repositório, com o stack no ar:
--   docker compose exec -T db psql -U sysjulia -d sistema_julia < scripts/limpar-base.sql
--
-- O que sobrevive, além de `modelos`: `users`, `escritorio` (identidade e
-- preferências), `textos_padrao`, `documentos_modelo` e `checklist_modelos` —
-- modelo e configuração, não informação de cliente.
--
-- O que NÃO é tocado: os arquivos já gravados no volume uploads_data. As linhas
-- do banco somem e os arquivos ficam órfãos. Para apagá-los preservando os
-- modelos (que moram em uploads/modelos):
--   docker compose exec backend sh -c 'find /app/uploads -mindepth 1 -maxdepth 1 ! -name modelos -exec rm -rf {} \;'
BEGIN;

-- CASCADE alcança quem aponta para estas tabelas — inclusive as legadas que
-- ainda existam em bases antigas (honorários, parcelas). `modelos` não é
-- atingida: a dependência é relatorios → modelos, e não o contrário.
TRUNCATE clients, imoveis, vistorias, pavimentos, ambientes, fotos,
         divergencias, relatorios, relatorio_fotos,
         processos, arquivos, protocolos, processo_documentos, rrts,
         nao_conformidades, checklist_itens, planta_pinos, laudos,
         despesas_processo,
         viagens, viagem_itens, viagem_vistorias, despesas,
         notificacoes, auditoria, senha_tokens
  RESTART IDENTITY CASCADE;

-- A numeração oficial (LIP-2026-014) contava os laudos que acabaram de sair:
-- volta a zero junto com eles.
TRUNCATE sequencias;

COMMIT;

-- Conferência rápida do que ficou.
SELECT 'modelos' AS tabela, count(*) AS linhas FROM modelos
UNION ALL SELECT 'users',      count(*) FROM users
UNION ALL SELECT 'clients',    count(*) FROM clients
UNION ALL SELECT 'imoveis',    count(*) FROM imoveis
UNION ALL SELECT 'vistorias',  count(*) FROM vistorias
UNION ALL SELECT 'relatorios', count(*) FROM relatorios
UNION ALL SELECT 'laudos',     count(*) FROM laudos;
