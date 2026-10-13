'use strict'

// Esquema da camada de REGULARIZAÇÃO — o que fica por cima da vistoria.
//
// Até aqui o sistema sabia fotografar, conferir e montar laudos. Uma empresa
// de regularização trabalha por PROCESSO com a prefeitura: etapas, protocolos
// com prazo, documentos exigidos, honorários. Estas tabelas dão esse esqueleto,
// mais o que uma operação de verdade precisa: papéis, auditoria, lixeira,
// configurações do escritório, notificações, portal do cliente e laudos
// emitidos em PDF.
//
// Tudo é CREATE/ALTER ... IF NOT EXISTS: roda em todo boot, sem migrações
// numeradas (o mesmo padrão do db.js).
const { hashPassword } = require('./auth')

async function migrar(pool) {
  const q = (sql, params) => pool.query(sql, params)

  // ---- usuários: papéis, registro profissional e assinatura (6, 19, 20) ----
  // Papéis: admin · arquiteto · estagiario · financeiro. 'user' era o papel
  // genérico da base antiga — vira arquiteto, que é o que ele fazia na prática.
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS registro TEXT NOT NULL DEFAULT ''") // "CAU A123456-7"
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT ''") // "Arquiteta e Urbanista"
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone TEXT NOT NULL DEFAULT ''")
  await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS assinatura TEXT NOT NULL DEFAULT ''") // imagem (PNG) para o PDF
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true')
  await q("UPDATE users SET role = 'arquiteto' WHERE role = 'user'")

  // Redefinição de senha por link (e-mail ou link gerado pelo administrador).
  await q(`
    CREATE TABLE IF NOT EXISTS senha_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expira_em  TIMESTAMPTZ NOT NULL,
      usado_em   TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // ---- lixeira: exclusão reversível (19) ----------------------------------
  for (const t of ['clients', 'imoveis', 'vistorias']) {
    await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ`)
  }

  // ---- auditoria: quem fez o quê (19) --------------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_nome   TEXT NOT NULL DEFAULT '',
      acao        TEXT NOT NULL,
      entidade    TEXT NOT NULL,
      entidade_id INTEGER,
      processo_id INTEGER,
      descricao   TEXT NOT NULL DEFAULT '',
      dados       JSONB,
      ip          TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria (entidade, entidade_id, id)')
  await q('CREATE INDEX IF NOT EXISTS idx_auditoria_processo ON auditoria (processo_id, id)')

  // ---- escritório: identidade, textos padrão e numeração (14) --------------
  // Uma linha só (id = 1). O timbre dos laudos e o nome na legenda das fotos
  // saem daqui — antes estavam fixos no código.
  await q(`
    CREATE TABLE IF NOT EXISTS escritorio (
      id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      razao_social      TEXT NOT NULL DEFAULT '',
      nome_fantasia     TEXT NOT NULL DEFAULT 'Plenno Arquitetura',
      cnpj              TEXT NOT NULL DEFAULT '',
      registro          TEXT NOT NULL DEFAULT '',
      endereco          TEXT NOT NULL DEFAULT '',
      cidade            TEXT NOT NULL DEFAULT 'São Paulo',
      telefone          TEXT NOT NULL DEFAULT '',
      email             TEXT NOT NULL DEFAULT '',
      site              TEXT NOT NULL DEFAULT '',
      logo              TEXT NOT NULL DEFAULT '',
      cor               TEXT NOT NULL DEFAULT 'C00000',
      fonte_fotos       TEXT NOT NULL DEFAULT 'Plenno Arquitetura',
      carimbo_fotos     BOOLEAN NOT NULL DEFAULT false,
      prazo_alerta_dias INTEGER NOT NULL DEFAULT 7,
      url_publica       TEXT NOT NULL DEFAULT '',
      notificacoes      JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('INSERT INTO escritorio (id) VALUES (1) ON CONFLICT (id) DO NOTHING')

  // Textos que se repetem de laudo em laudo, por tipo de serviço e seção.
  await q(`
    CREATE TABLE IF NOT EXISTS textos_padrao (
      id           SERIAL PRIMARY KEY,
      tipo_servico TEXT NOT NULL DEFAULT '',
      secao        TEXT NOT NULL DEFAULT 'conclusao',
      titulo       TEXT NOT NULL DEFAULT '',
      texto        TEXT NOT NULL DEFAULT '',
      ordem        INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Numeração oficial (LIP-2026-014): um contador por chave.
  await q(`
    CREATE TABLE IF NOT EXISTS sequencias (
      chave TEXT PRIMARY KEY,
      valor INTEGER NOT NULL DEFAULT 0
    )
  `)

  // ---- processos: a entidade-mãe (1) ---------------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS processos (
      id             SERIAL PRIMARY KEY,
      numero         TEXT NOT NULL UNIQUE,
      client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      imovel_id      INTEGER REFERENCES imoveis(id) ON DELETE SET NULL,
      titulo         TEXT NOT NULL,
      tipo           TEXT NOT NULL DEFAULT '',
      etapa          TEXT NOT NULL DEFAULT 'levantamento',
      prioridade     TEXT NOT NULL DEFAULT 'normal',
      responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      descricao      TEXT NOT NULL DEFAULT '',
      inicio         DATE,
      previsao       DATE,
      concluido_em   DATE,
      excluido_em    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS processo_id INTEGER REFERENCES processos(id) ON DELETE SET NULL')
  await q('CREATE INDEX IF NOT EXISTS idx_vistorias_processo ON vistorias (processo_id)')

  // ---- arquivos: o GED (4) — vem antes de quem o referencia -----------------
  await q(`
    CREATE TABLE IF NOT EXISTS arquivos (
      id                  SERIAL PRIMARY KEY,
      processo_id         INTEGER REFERENCES processos(id) ON DELETE CASCADE,
      imovel_id           INTEGER REFERENCES imoveis(id) ON DELETE CASCADE,
      client_id           INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      vistoria_id         INTEGER REFERENCES vistorias(id) ON DELETE CASCADE,
      categoria           TEXT NOT NULL DEFAULT 'outro',
      nome                TEXT NOT NULL,
      descricao           TEXT NOT NULL DEFAULT '',
      arquivo             TEXT NOT NULL,
      nome_original       TEXT NOT NULL DEFAULT '',
      mime                TEXT NOT NULL DEFAULT '',
      tamanho             BIGINT NOT NULL DEFAULT 0,
      versao              INTEGER NOT NULL DEFAULT 1,
      substitui_id        INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
      validade            DATE,
      visivel_cliente     BOOLEAN NOT NULL DEFAULT false,
      enviado_por         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      enviado_pelo_cliente BOOLEAN NOT NULL DEFAULT false,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_arquivos_processo ON arquivos (processo_id, id)')
  await q('CREATE INDEX IF NOT EXISTS idx_arquivos_imovel ON arquivos (imovel_id, id)')

  // ---- protocolos e prazos com os órgãos (2) -------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS protocolos (
      id            SERIAL PRIMARY KEY,
      processo_id   INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
      orgao         TEXT NOT NULL DEFAULT 'prefeitura',
      tipo          TEXT NOT NULL DEFAULT 'protocolo',
      numero        TEXT NOT NULL DEFAULT '',
      assunto       TEXT NOT NULL,
      data          DATE,
      prazo         DATE,
      status        TEXT NOT NULL DEFAULT 'aberto',
      resposta      TEXT NOT NULL DEFAULT '',
      respondido_em DATE,
      observacoes   TEXT NOT NULL DEFAULT '',
      arquivo_id    INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_protocolos_processo ON protocolos (processo_id, prazo)')

  // ---- documentos exigidos (3): o modelo por tipo e a lista de cada processo
  await q(`
    CREATE TABLE IF NOT EXISTS documentos_modelo (
      id           SERIAL PRIMARY KEY,
      tipo_servico TEXT NOT NULL,
      nome         TEXT NOT NULL,
      descricao    TEXT NOT NULL DEFAULT '',
      obrigatorio  BOOLEAN NOT NULL DEFAULT true,
      ordem        INTEGER NOT NULL DEFAULT 0
    )
  `)
  await q(`
    CREATE TABLE IF NOT EXISTS processo_documentos (
      id          SERIAL PRIMARY KEY,
      processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      obrigatorio BOOLEAN NOT NULL DEFAULT true,
      status      TEXT NOT NULL DEFAULT 'pendente',
      arquivo_id  INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
      validade    DATE,
      recebido_em DATE,
      observacao  TEXT NOT NULL DEFAULT '',
      ordem       INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // ---- responsabilidade técnica (6) ----------------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS rrts (
      id          SERIAL PRIMARY KEY,
      processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
      vistoria_id INTEGER REFERENCES vistorias(id) ON DELETE SET NULL,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      tipo        TEXT NOT NULL DEFAULT 'RRT',
      numero      TEXT NOT NULL DEFAULT '',
      atividade   TEXT NOT NULL DEFAULT '',
      data        DATE,
      valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'emitida',
      arquivo_id  INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
      observacoes TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // ---- ficha cadastral do imóvel (5) ---------------------------------------
  const colsImovel = [
    "matricula TEXT NOT NULL DEFAULT ''",
    "cartorio TEXT NOT NULL DEFAULT ''",
    "inscricao TEXT NOT NULL DEFAULT ''", // SQL / inscrição imobiliária (IPTU)
    "lote TEXT NOT NULL DEFAULT ''",
    "quadra TEXT NOT NULL DEFAULT ''",
    "zoneamento TEXT NOT NULL DEFAULT ''",
    "uso TEXT NOT NULL DEFAULT ''",
    'area_terreno NUMERIC(12,2)',
    'area_aprovada NUMERIC(12,2)',
    'area_iptu NUMERIC(12,2)',
    'latitude DOUBLE PRECISION',
    'longitude DOUBLE PRECISION',
    "cep TEXT NOT NULL DEFAULT ''",
    "municipio TEXT NOT NULL DEFAULT ''",
    "uf TEXT NOT NULL DEFAULT ''",
    "observacoes TEXT NOT NULL DEFAULT ''",
  ]
  for (const c of colsImovel) await q(`ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS ${c}`)

  // ---- medidas estruturadas por ambiente (7) -------------------------------
  // `medidas` (texto livre) continua como observação; a área vem destas.
  await q('ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS comprimento NUMERIC(8,2)')
  await q('ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS largura NUMERIC(8,2)')
  await q('ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS pe_direito NUMERIC(6,2)')
  await q('ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS area NUMERIC(10,2)') // informada; nula = comprimento × largura

  // ---- não conformidades (8) — o miolo do LIP ------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS nao_conformidades (
      id           SERIAL PRIMARY KEY,
      vistoria_id  INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      ambiente_id  INTEGER REFERENCES ambientes(id) ON DELETE SET NULL,
      foto_id      INTEGER REFERENCES fotos(id) ON DELETE SET NULL,
      titulo       TEXT NOT NULL DEFAULT '',
      anomalia     TEXT NOT NULL DEFAULT 'outro',
      grau         TEXT NOT NULL DEFAULT 'regular',
      descricao    TEXT NOT NULL DEFAULT '',
      recomendacao TEXT NOT NULL DEFAULT '',
      prazo        TEXT NOT NULL DEFAULT 'curto',
      ordem        INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_nc_vistoria ON nao_conformidades (vistoria_id, ordem, id)')

  // ---- checklists por tipo de serviço (9) ----------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS checklist_modelos (
      id           SERIAL PRIMARY KEY,
      tipo_servico TEXT NOT NULL,
      nome         TEXT NOT NULL,
      por_ambiente BOOLEAN NOT NULL DEFAULT true,
      ordem        INTEGER NOT NULL DEFAULT 0
    )
  `)
  await q(`
    CREATE TABLE IF NOT EXISTS checklist_itens (
      id          SERIAL PRIMARY KEY,
      vistoria_id INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      ambiente_id INTEGER REFERENCES ambientes(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      resultado   TEXT NOT NULL DEFAULT 'pendente',
      foto_id     INTEGER REFERENCES fotos(id) ON DELETE SET NULL,
      observacao  TEXT NOT NULL DEFAULT '',
      ordem       INTEGER NOT NULL DEFAULT 0
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_checklist_vistoria ON checklist_itens (vistoria_id, ambiente_id, ordem)')

  // ---- planta com pinos (11) -----------------------------------------------
  // Um pino por ambiente do MODELO do imóvel, em coordenadas relativas (0..1)
  // sobre a prancha rasterizada. A vistoria acha o pino pelo nome do ambiente.
  await q(`
    CREATE TABLE IF NOT EXISTS planta_pinos (
      id          SERIAL PRIMARY KEY,
      imovel_id   INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE,
      ambiente_id INTEGER NOT NULL UNIQUE REFERENCES ambientes(id) ON DELETE CASCADE,
      prancha     INTEGER NOT NULL DEFAULT 0,
      x           REAL NOT NULL,
      y           REAL NOT NULL
    )
  `)

  // ---- fotos: posição, carimbo e anotação (12) -----------------------------
  await q('ALTER TABLE fotos ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION')
  await q('ALTER TABLE fotos ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION')
  await q('ALTER TABLE fotos ADD COLUMN IF NOT EXISTS precisao REAL')
  await q("ALTER TABLE fotos ADD COLUMN IF NOT EXISTS anotacao TEXT NOT NULL DEFAULT ''") // PNG transparente
  await q('ALTER TABLE fotos ADD COLUMN IF NOT EXISTS carimbada BOOLEAN NOT NULL DEFAULT false')
  // Cartão de claquete lido na foto (SJ-AMB:<id> ou SJ-NOVO) — ver claquete-qr.js.
  await q("ALTER TABLE fotos ADD COLUMN IF NOT EXISTS qr TEXT NOT NULL DEFAULT ''")

  // ---- laudos emitidos em PDF (13) -----------------------------------------
  await q(`
    CREATE TABLE IF NOT EXISTS laudos (
      id                   SERIAL PRIMARY KEY,
      vistoria_id          INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      processo_id          INTEGER REFERENCES processos(id) ON DELETE SET NULL,
      modelo               TEXT NOT NULL,
      numero               TEXT NOT NULL,
      versao               INTEGER NOT NULL DEFAULT 1,
      titulo               TEXT NOT NULL DEFAULT '',
      arquivo              TEXT NOT NULL,
      hash                 TEXT NOT NULL DEFAULT '',
      paginas              INTEGER NOT NULL DEFAULT 0,
      tamanho              BIGINT NOT NULL DEFAULT 0,
      emitido_por          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      emitido_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
      observacoes          TEXT NOT NULL DEFAULT '',
      assinado_arquivo     TEXT NOT NULL DEFAULT '',
      assinado_em          TIMESTAMPTZ,
      visivel_cliente      BOOLEAN NOT NULL DEFAULT true,
      aprovado_em          TIMESTAMPTZ,
      aprovacao_comentario TEXT NOT NULL DEFAULT '',
      opcoes               JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_laudos_vistoria ON laudos (vistoria_id, id)')

  // ---- portal do cliente (15) ----------------------------------------------
  await q('ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token TEXT UNIQUE')
  await q("ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_senha TEXT NOT NULL DEFAULT ''")
  await q('ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_ativo BOOLEAN NOT NULL DEFAULT false')
  await q("ALTER TABLE clients ADD COLUMN IF NOT EXISTS endereco TEXT NOT NULL DEFAULT ''")

  // ---- notificações (16) ---------------------------------------------------
  // `chave` evita repetir o mesmo aviso (ex.: prazo-123-7d) a cada varredura.
  await q(`
    CREATE TABLE IF NOT EXISTS notificacoes (
      id           SERIAL PRIMARY KEY,
      chave        TEXT UNIQUE,
      tipo         TEXT NOT NULL DEFAULT 'aviso',
      titulo       TEXT NOT NULL,
      mensagem     TEXT NOT NULL DEFAULT '',
      canal        TEXT NOT NULL DEFAULT 'interno',
      destinatario TEXT NOT NULL DEFAULT '',
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      processo_id  INTEGER REFERENCES processos(id) ON DELETE CASCADE,
      vistoria_id  INTEGER REFERENCES vistorias(id) ON DELETE CASCADE,
      link         TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pendente',
      erro         TEXT NOT NULL DEFAULT '',
      enviada_em   TIMESTAMPTZ,
      lida_em      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS idx_notificacoes_user ON notificacoes (user_id, lida_em, id)')

  // ---- despesas do processo (17) -------------------------------------------
  // Honorários e parcelas saíram do sistema: o dinheiro que o escritório
  // controla é a VERBA DA VIAGEM (tabelas `viagens`/`despesas`, tela
  // /financeiro). As tabelas antigas não são mais criadas; onde já existirem,
  // ficam paradas — ninguém lê nem escreve nelas.
  await q(`
    CREATE TABLE IF NOT EXISTS despesas_processo (
      id             SERIAL PRIMARY KEY,
      processo_id    INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
      categoria      TEXT NOT NULL DEFAULT 'outro',
      descricao      TEXT NOT NULL DEFAULT '',
      valor          NUMERIC(12,2) NOT NULL DEFAULT 0,
      data           DATE,
      reembolsavel   BOOLEAN NOT NULL DEFAULT true,
      reembolsado_em DATE,
      arquivo        TEXT NOT NULL DEFAULT '',
      nome_original  TEXT NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await semear(pool)
}

// Modelos que já vêm prontos: documentos exigidos e checklists por tipo de
// serviço. Só entram quando a tabela está vazia — depois o escritório edita.
async function semear(pool) {
  const docs = await pool.query('SELECT COUNT(*)::int AS c FROM documentos_modelo')
  if (docs.rows[0].c === 0) {
    const lista = [
      ['Regularização', 'Matrícula atualizada do imóvel (até 30 dias)', true],
      ['Regularização', 'Carnê ou espelho do IPTU do ano', true],
      ['Regularização', 'Documento do proprietário (RG/CNH ou contrato social + CNPJ)', true],
      ['Regularização', 'Projeto aprovado anterior / alvará antigo', false],
      ['Regularização', 'Levantamento as-built (planta do existente)', true],
      ['Regularização', 'RRT/ART de levantamento e regularização', true],
      ['Regularização', 'Certidão de zoneamento / uso do solo', false],
      ['Regularização', 'Procuração para o escritório', true],
      ['Laudo de bombeiro', 'AVCB/CLCB anterior', false],
      ['Laudo de bombeiro', 'Projeto técnico de segurança contra incêndio', true],
      ['Laudo de bombeiro', 'ART/RRT do projeto e da execução', true],
      ['Laudo de bombeiro', 'Laudos de instalações (elétrica, GLP, SPDA)', true],
      ['Laudo de bombeiro', 'Matrícula ou IPTU', true],
      ['As-built', 'Projeto executivo de referência', false],
      ['As-built', 'Matrícula ou IPTU', true],
      ['As-built', 'RRT/ART de levantamento', true],
      ['LIP — Laudo de Inspeção Predial', 'Documentação do condomínio / síndico', true],
      ['LIP — Laudo de Inspeção Predial', 'Projetos disponíveis (arquitetura, estrutura, instalações)', false],
      ['LIP — Laudo de Inspeção Predial', 'Laudos anteriores e manutenções', false],
      ['LIP — Laudo de Inspeção Predial', 'RRT/ART de inspeção', true],
      ['EVTL — Estudo de Viabilidade Técnica e Legal', 'Matrícula atualizada', true],
      ['EVTL — Estudo de Viabilidade Técnica e Legal', 'Planta aprovada na prefeitura', true],
      ['EVTL — Estudo de Viabilidade Técnica e Legal', 'IPTU', true],
      ['EVTL — Estudo de Viabilidade Técnica e Legal', 'Certidão de zoneamento', false],
    ]
    let ordem = 0
    for (const [tipo, nome, obrig] of lista) {
      await pool.query(
        'INSERT INTO documentos_modelo (tipo_servico, nome, obrigatorio, ordem) VALUES ($1,$2,$3,$4)',
        [tipo, nome, obrig, ordem++]
      )
    }
  }

  const chk = await pool.query('SELECT COUNT(*)::int AS c FROM checklist_modelos')
  if (chk.rows[0].c === 0) {
    const lista = [
      // [tipo, nome, por ambiente?]
      ['Laudo de bombeiro', 'Extintores: quantidade, tipo, validade e sinalização', true],
      ['Laudo de bombeiro', 'Hidrantes e mangueiras acessíveis', true],
      ['Laudo de bombeiro', 'Iluminação de emergência funcionando', true],
      ['Laudo de bombeiro', 'Sinalização de rota de fuga e saída', true],
      ['Laudo de bombeiro', 'Portas corta-fogo / barras antipânico', true],
      ['Laudo de bombeiro', 'Alarme e acionadores manuais', true],
      ['Laudo de bombeiro', 'Rotas de fuga desobstruídas', true],
      ['Laudo de bombeiro', 'Central de GLP e SPDA com laudo', false],
      ['Laudo de bombeiro', 'Brigada de incêndio treinada', false],
      ['Regularização', 'Cotas conferidas com trena/laser', true],
      ['Regularização', 'Esquadrias conforme levantamento', true],
      ['Regularização', 'Pé-direito medido', true],
      ['Regularização', 'Uso do ambiente compatível com o projeto', true],
      ['Regularização', 'Recuos e afastamentos conferidos', false],
      ['Regularização', 'Área construída total conferida', false],
      ['As-built', 'Cotas conferidas com trena/laser', true],
      ['As-built', 'Esquadrias e aberturas registradas', true],
      ['As-built', 'Pé-direito medido', true],
      ['As-built', 'Instalações aparentes registradas', true],
      ['LIP — Laudo de Inspeção Predial', 'Fissuras e trincas', true],
      ['LIP — Laudo de Inspeção Predial', 'Infiltrações e umidade', true],
      ['LIP — Laudo de Inspeção Predial', 'Revestimentos (piso, parede, teto)', true],
      ['LIP — Laudo de Inspeção Predial', 'Instalações elétricas aparentes', true],
      ['LIP — Laudo de Inspeção Predial', 'Instalações hidráulicas', true],
      ['LIP — Laudo de Inspeção Predial', 'Esquadrias e vidros', true],
      ['LIP — Laudo de Inspeção Predial', 'Fachada e cobertura', false],
      ['Locação', 'Estado de pintura', true],
      ['Locação', 'Pontos de luz e tomadas funcionando', true],
      ['Locação', 'Torneiras, registros e descargas', true],
      ['Locação', 'Chaves e fechaduras', true],
      ['Entrega de obra', 'Acabamentos sem defeitos', true],
      ['Entrega de obra', 'Instalações testadas', true],
      ['Entrega de obra', 'Esquadrias funcionando', true],
      ['Acessibilidade', 'Rampa com inclinação adequada (NBR 9050)', false],
      ['Acessibilidade', 'Corrimãos nos dois lados', false],
      ['Acessibilidade', 'Banheiro acessível com barras', true],
      ['Acessibilidade', 'Sinalização tátil e visual', true],
      ['Acessibilidade', 'Vagas reservadas sinalizadas', false],
    ]
    let ordem = 0
    for (const [tipo, nome, porAmb] of lista) {
      await pool.query(
        'INSERT INTO checklist_modelos (tipo_servico, nome, por_ambiente, ordem) VALUES ($1,$2,$3,$4)',
        [tipo, nome, porAmb, ordem++]
      )
    }
  }

  const txt = await pool.query('SELECT COUNT(*)::int AS c FROM textos_padrao')
  if (txt.rows[0].c === 0) {
    const lista = [
      ['', 'introducao', 'Objetivo', 'O presente documento tem por objetivo registrar o levantamento técnico realizado no imóvel, com base em vistoria presencial e registro fotográfico, servindo de subsídio à análise de conformidade entre o existente e a documentação aprovada.'],
      ['', 'metodologia', 'Metodologia', 'A vistoria foi realizada percorrendo-se todos os ambientes acessíveis do imóvel, com registro fotográfico sequencial, anotações de campo e medições com trena e medidor a laser, quando aplicável. As informações constantes deste documento refletem as condições observadas na data da vistoria.'],
      ['Regularização', 'conclusao', 'Conclusão', 'Diante do exposto, constatou-se que a edificação apresenta divergências em relação ao projeto aprovado, relacionadas neste documento, sendo necessária a regularização junto ao órgão municipal competente, mediante apresentação de projeto de levantamento e documentação pertinente.'],
      ['EVTL — Estudo de Viabilidade Técnica e Legal', 'conclusao', 'Conclusão', 'Com base no levantamento realizado e na análise da documentação disponível, conclui-se pela viabilidade técnica e legal da regularização, observadas as divergências apontadas e as exigências da legislação municipal vigente.'],
      ['LIP — Laudo de Inspeção Predial', 'conclusao', 'Conclusão', 'As anomalias e falhas identificadas foram classificadas quanto ao grau de risco, com as recomendações e prazos correspondentes, cabendo ao responsável pela edificação a adoção das medidas indicadas, na ordem de prioridade estabelecida.'],
      ['Laudo de bombeiro', 'conclusao', 'Conclusão', 'Verificadas as medidas de segurança contra incêndio instaladas, relacionam-se neste documento as conformidades e as pendências observadas em relação às Instruções Técnicas do Corpo de Bombeiros, para as providências necessárias à obtenção ou renovação do AVCB.'],
      ['As-built', 'conclusao', 'Conclusão', 'O levantamento cadastral registra a edificação como executada na data da vistoria, com as cotas e áreas apuradas em campo, servindo de base para a atualização do projeto e da documentação do imóvel.'],
    ]
    let ordem = 0
    for (const [tipo, secao, titulo, texto] of lista) {
      await pool.query(
        'INSERT INTO textos_padrao (tipo_servico, secao, titulo, texto, ordem) VALUES ($1,$2,$3,$4,$5)',
        [tipo, secao, titulo, texto, ordem++]
      )
    }
  }

  // Garante que exista pelo menos um admin ativo (a base antiga só tinha o seed).
  const adm = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND ativo")
  if (adm.rows[0].c === 0) {
    await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ('Administrador', 'admin@sistema-julia.local', $1, 'admin') ON CONFLICT (email) DO UPDATE SET role = 'admin', ativo = true",
      [hashPassword('admin123')]
    )
  }
}

module.exports = { migrar }
