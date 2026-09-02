-- Zera os dados de teste e deixa no banco um único cenário: o cliente Plenno
-- com o imóvel da Casa Pacaembu e o modelo de pavimentos/ambientes já montado a
-- partir do PDF "PRANCHAS UNIFICADAS - CASA PACAEMBU".
--
-- Rodar da raiz do repositório, com o stack no ar:
--   docker compose exec -T db psql -U sysjulia -d sistema_julia < scripts/dados-teste-plenno.sql
--
-- O que sobrevive: o usuário admin do seed. O que NÃO é tocado: os arquivos já
-- gravados no volume uploads_data (fotos, plantas e comprovantes órfãos) — as
-- linhas do banco somem, os arquivos ficam. Para zerar também os arquivos:
--   docker compose down && docker volume rm sistema-julia_uploads_data
--
-- Por que a estrutura vem daqui e não da leitura da planta: neste PDF os textos
-- foram convertidos em curvas (CAD exportado com fontes vetorizadas), então ele
-- não tem camada de texto e o "Ler planta" responde, corretamente, que a planta
-- é uma imagem. Os 4 pavimentos e 28 ambientes abaixo saíram da leitura visual
-- das pranchas 3 a 13.
BEGIN;

TRUNCATE fotos, divergencias, despesas, viagem_itens, viagem_vistorias, viagens,
         ambientes, pavimentos, vistorias, imoveis, clients
  RESTART IDENTITY CASCADE;

DELETE FROM users WHERE role <> 'admin';

-- Cliente → imóvel → pavimentos → ambientes em uma tacada só: cada CTE devolve
-- os ids que a etapa seguinte precisa.
WITH cliente AS (
  INSERT INTO clients (name, email, phone, company, tipo, documento)
  -- Razão social e CNPJ em branco/aproximados de propósito: completar pela tela.
  -- Sendo pessoa jurídica, é a EMPRESA que aparece nas listas de imóvel e vistoria.
  VALUES ('Plenno', '', '', 'Plenno', 'pj', '')
  RETURNING id
),
imovel AS (
  INSERT INTO imoveis (client_id, nome, endereco)
  SELECT id, 'Casa Pacaembu', 'Pacaembu — São Paulo/SP' FROM cliente
  RETURNING id
),
-- Duas edificações no mesmo lote (a casa principal e a edícula), cada uma com
-- térreo e 1º pavimento. Não há ático nem cobertura habitável.
pavimento AS (
  INSERT INTO pavimentos (imovel_id, nome, ordem)
  SELECT imovel.id, v.nome, v.ordem
  FROM imovel, (VALUES
    ('Térreo — Estrutura Principal', 1),
    ('Térreo — Edícula', 2),
    ('1º Pavimento (Superior) — Estrutura Principal', 3),
    ('1º Pavimento (Superior) — Edícula', 4)
  ) AS v(nome, ordem)
  RETURNING id, nome
)
-- Ordem dentro do pavimento: varredura espacial da prancha (de cima para baixo,
-- da esquerda para a direita) — é o ponto de partida do caminho da vistoria.
INSERT INTO ambientes (pavimento_id, nome, ordem, origem)
SELECT pavimento.id, a.nome, a.ordem, 'planta'
FROM pavimento
JOIN (VALUES
  ('Térreo — Estrutura Principal', 'Operação',      1),
  ('Térreo — Estrutura Principal', 'Reuniões P',    2),
  ('Térreo — Estrutura Principal', 'Reuniões M',    3),
  ('Térreo — Estrutura Principal', 'Sanitários',    4),
  ('Térreo — Estrutura Principal', 'Depósito',      5),
  ('Térreo — Estrutura Principal', 'Café',          6),
  ('Térreo — Estrutura Principal', 'ADM',           7),
  ('Térreo — Estrutura Principal', 'Recepção',      8),

  ('Térreo — Edícula', 'Refeitório',  1),
  ('Térreo — Edícula', 'Sanitário 1', 2),
  ('Térreo — Edícula', 'Fumódromo',   3),
  ('Térreo — Edícula', 'Sanitário 2', 4),
  ('Térreo — Edícula', 'Depósito',    5),
  ('Térreo — Edícula', 'Sala Lazer',  6),
  ('Térreo — Edícula', 'Sala TV',     7),
  ('Térreo — Edícula', 'Sanitários',  8),

  ('1º Pavimento (Superior) — Estrutura Principal', 'Resp. Técnica', 1),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Operação',      2),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Sala TI',       3),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Comercial',     4),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Café',          5),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Sanitários',    6),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Compliance',    7),
  ('1º Pavimento (Superior) — Estrutura Principal', 'Diretoria',     8),

  ('1º Pavimento (Superior) — Edícula', 'Lavanderia',      1),
  ('1º Pavimento (Superior) — Edícula', 'Área Descoberta', 2),
  ('1º Pavimento (Superior) — Edícula', 'Sanitário 1',     3),
  ('1º Pavimento (Superior) — Edícula', 'Sanitário 2',     4)
) AS a(pavimento, nome, ordem) ON a.pavimento = pavimento.nome;

COMMIT;

-- Conferência rápida do que ficou.
SELECT p.ordem, p.nome AS pavimento, count(a.id) AS ambientes
FROM pavimentos p LEFT JOIN ambientes a ON a.pavimento_id = p.id
GROUP BY p.ordem, p.nome ORDER BY p.ordem;
