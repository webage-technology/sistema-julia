# Camada de regularização — o que foi construído em 08/09/2026

> Vinte funcionalidades para o sistema ser usado de verdade por uma empresa de
> regularização de arquitetura e urbanismo. Este arquivo é o mapa: o que cada
> uma faz, onde fica e como se liga ao resto. Detalhes de tela estão em
> [`mapa-de-urls.md`](mapa-de-urls.md); segurança e cópia de segurança em
> [`seguranca-e-backup.md`](seguranca-e-backup.md).

## A ideia

Até aqui o sistema sabia **fotografar, conferir e montar laudos**. Uma empresa de
regularização trabalha por **processo com a prefeitura**: etapas, protocolos com
prazo, documentos que o cliente precisa entregar, despesas. O processo é a
entidade-mãe; a vistoria continua sendo a unidade do trabalho de campo. Tudo o
que se acrescentou gira em torno disso — e do que uma operação de verdade
precisa: papéis, auditoria, lixeira, avisos, portal do cliente, PDF emitido.

Esquema: `backend/src/schema-regularizacao.js` (roda em todo boot, idempotente).

## As vinte, uma a uma

### O processo, acima da vistoria

| # | O quê | Onde | Backend |
|---|---|---|---|
| 1 | **Processo** com número (PROC-2026-001), etapa (levantamento → projeto → protocolado → comunique-se → aprovação → concluído), prioridade, responsável, previsão. Quadro por etapa e lista. | `/processos`, `/processos/:id` | `src/processos.js` |
| 2 | **Protocolos e prazos**: cada ida ao órgão (prefeitura, bombeiros, cartório, CETESB…) com número, assunto, prazo de resposta e situação. Um comunique-se muda a etapa sozinho; o deferimento leva a "aprovação". Os prazos aparecem na agenda, no painel e viram aviso. | aba *Protocolos e prazos* do processo; `/agenda`; `/painel` | `src/processos.js` (`/prazos`) |
| 3 | **Documentos exigidos**: modelo por tipo de serviço (Configurações) que vira o checklist de documentos do processo — pendente/recebido/vencido/dispensado, validade, upload. O cliente também envia pelo portal. | aba *Documentos*; `/configuracoes?aba=documentos` | `processo_documentos`, `documentos_modelo` |
| 4 | **GED (arquivos)**: qualquer arquivo anexado a processo, imóvel, cliente ou vistoria, com categoria, validade, visibilidade no portal e **versões** (enviar "no lugar de"). | aba *Arquivos* do processo e do imóvel | `src/arquivos.js` |
| 5 | **Ficha cadastral do imóvel**: matrícula/cartório, inscrição (SQL), lote/quadra, zoneamento, uso, áreas do terreno/aprovada/IPTU, lat/long, CEP/município/UF. Base do quadro de áreas e da identificação do laudo. | `/imoveis/:id` (aba *Ficha e modelo*) | colunas em `imoveis` |
| 6 | **Responsabilidade técnica**: registro CAU/CREA, título e assinatura (PNG) no usuário; RRT/ART por processo (número, atividade, profissional, PDF no GED). Saem na capa e no fecho do PDF. | `/users`; aba *RRT / ART* do processo | `rrts`, colunas em `users` |

### Levantamento e entregáveis

| # | O quê | Onde | Backend |
|---|---|---|---|
| 7 | **Quadro de áreas**: comprimento × largura × pé-direito (ou área direta) por ambiente; soma por pavimento e total, comparado com a área aprovada e a do IPTU (divergência em m² e %). Lançável no celular, na nota do ambiente. | `/vistorias/:id?aba=areas`; captura → *Nota* | `src/areas.js` |
| 8 | **Não conformidades** (NBR 16747): anomalia, grau de risco, descrição, recomendação, prazo e foto. "Escrever com a IA" redige descrição e recomendação. Entram no PDF do LIP, do bombeiro e da regularização. | `/vistorias/:id/relatorio?modelo=lip` | `src/inspecao.js` |
| 9 | **Checklists por tipo de serviço** (bombeiro, acessibilidade, as-built, regularização, LIP, locação, entrega de obra): modelo em Configurações; aplicado à vistoria vira um item por ambiente (ou geral), marcável na tela e no celular. Tabela no PDF, com as evidências dos não conformes. | `/vistorias/:id?aba=checklist`; captura → *Check*; `/configuracoes?aba=checklists` | `src/inspecao.js` |
| 10 | **Comparação entre vistorias** do mesmo imóvel, ambiente a ambiente: igual / alterado (área, pé-direito, NC nova) / novo / não existe mais, com claquete e foto de cada lado. | `/imoveis/:id/comparar?a=&b=` | `src/comparar.js` |
| 11 | **Planta com pinos** + **leitura visual**: a prancha (PDF ou imagem) é rasterizada com `pdftoppm`; cada ambiente do modelo ganha um pino (coordenadas relativas). No celular, tocar no pino troca de ambiente. Planta escaneada ou com fontes em curvas é lida como imagem pelo Claude com visão (`ai-vision` do Hub), no mesmo diálogo da leitura por texto. | `/imoveis/:id?aba=planta`; `?ler-planta=visual`; captura → *Planta* | `src/planta-pinos.js` |
| 12 | **Foto com data, hora, ambiente e GPS**: a captura grava a posição do aparelho em cada foto (e a câmera nativa traz do EXIF); com "carimbar fotos" ligado, a faixa entra nas cópias exibidas e impressas (o original nunca muda). **Anotação** com setas/círculos na conferência, também só nas cópias. ZIP "carimbado" opcional. | conferência → *Anotar*; `/configuracoes` (carimbo) | `src/fotos.js`, `src/uploads.js` |
| 13 | **PDF emitido e versionado**: capa com timbre, identificação, textos padrão, seções do modelo (divergências, NCs, checklist, quadro de áreas, protocolos, registro fotográfico), conclusão e responsabilidade técnica com assinatura; rodapé "página X de Y". Prévia sem guardar; **Emitir** gera número oficial (LIP-2026-014), hash SHA-256 e congela a versão (v2 na retificação). PDF assinado (gov.br/ICP) volta por upload. | `/vistorias/:id/relatorio` (bloco *Emitir*); `/relatorios?aba=emitidos` | `src/pdf.js` (pdfkit), `src/laudos.js` |
| 14 | **Configurações do escritório**: razão social, CNPJ, logo, cor, fonte das fotos, carimbo, antecedência dos avisos, URL pública; **textos padrão** (objetivo, metodologia, conclusão) por tipo de serviço. O nome e a cor que estavam fixos no código saem daqui (também nos .docx). | `/configuracoes` | `src/escritorio.js` |

### Cliente, equipe e operação

| # | O quê | Onde | Backend |
|---|---|---|---|
| 15 | **Portal do cliente**: link privado por cliente (senha opcional). Etapa e prazos dos processos, documentos pendentes com **upload pelo cliente**, laudos emitidos com **aprovação**, arquivos marcados como visíveis e o **tour** das fotos (modo caminho, índice por ambiente, setas). | `/portal/:token`, `/portal/:token/tour/:vistoriaId`; ativação em `/clients?portal=<id>` | `src/portal.js` |
| 16 | **Notificações**: varredura a cada 10 min gera avisos de prazo (janela configurável e vencido), vistoria amanhã, documentos obrigatórios pendentes (semanal), backup atrasado; laudo emitido, documento e aprovação vindos do portal avisam na hora. Canais: sino na tela, **e-mail (SMTP)** e **WhatsApp (Evolution API)**. | sino no menu; `/notificacoes`; `/configuracoes?aba=notificacoes` | `src/notificacoes.js` |
| 17 | **Despesas do processo e verba de campo**: despesas reembolsáveis do processo (taxas, cartório, cópias) com comprovante e "a reembolsar"; em Financeiro, a **verba da viagem** — o valor disponibilizado ao analista pelos dias de vistoria (alimentação, Uber, hospedagem, passagem), com saldo, prestação de contas e a planilha de despesas em Excel. | aba *Despesas* do processo; `/financeiro` | `despesas_processo`, `viagens`/`despesas` (`src/viagens.js`) |
| 18 | **Painel** (raiz do sistema) e **busca global** (Ctrl+K): prazos da semana, vistorias da semana, processos por etapa, documentos faltando, verba em campo/a prestar contas, últimos laudos, estado do backup. A busca acha cliente, imóvel, processo, vistoria, protocolo, laudo e arquivo. | `/painel`; Ctrl+K em qualquer tela | `src/painel.js` |
| 19 | **Papéis, auditoria e lixeira**: papéis admin / arquiteto / estagiário / financeiro (o backend nega o que o papel não permite); **auditoria** de cada ação (quem, o quê, quando, IP) com linha do tempo por processo; **lixeira** — excluir cliente/imóvel/vistoria/processo é reversível, com cascata lógica e apagar definitivo só pelo administrador. | `/users`; `/auditoria`; `/lixeira`; aba *Histórico* do processo | `src/auth.js` (`permitir`), `src/auditoria.js`, `src/lixeira.js` |
| 20 | **Endurecimento**: cookie HttpOnly para imagens e downloads (sem `?token=` na URL), segredo do JWT no `.env`, limite de tentativas no login (5 em 15 min), recuperação de senha por e-mail ou link gerado pelo admin, usuário desativável, **backup** (script + tarefa agendada, estado no painel) e **service worker** para o app abrir sem sinal. | `/esqueci-senha`, `/redefinir-senha`; `scripts/backup.ps1`, `scripts/registrar-backup.ps1`; `public/sw.js` | `src/seguranca.js` |

## Como se encaixa no fluxo

1. **Cliente** → **Imóvel** (ficha, plantas, modelo de ambientes, pinos) → **Processo** (tipo → documentos exigidos) → **Vistoria** (dentro do processo).
2. Em campo: captura com GPS, planta com pinos, checklist, nota com medidas.
3. Escritório: conferência (anotações), quadro de áreas, não conformidades, divergências.
4. Laudo: prévia → **emitir** (número, versão, hash) → assinar fora → anexar assinado → visível no portal → cliente aprova.
5. Prefeitura: protocolo → comunique-se (prazo → aviso) → resposta → deferimento → aprovação → concluído.
6. Dinheiro: verba liberada para a viagem → dias em campo → despesas com comprovante → saldo prestado; despesas do processo reembolsáveis → reembolsado.

## Dependências novas

- `pdfkit` (PDF), `nodemailer` (SMTP) no backend; `poppler-utils` (pdftoppm/pdfinfo) na imagem — `docker compose up -d --build` na próxima subida.
- Nenhuma dependência nova no frontend.

## O que não foi feito (de propósito)

- Assinatura digital ICP-Brasil **dentro** do sistema: exige certificado A1/A3 e serviço próprio; o fluxo previsto é assinar fora (gov.br, Adobe) e anexar.
- Consulta automática de zoneamento no GeoSampa: não há API pública estável; ficou o link direto na ficha.
- WhatsApp e e-mail dependem de configuração do escritório (SMTP e Evolution); sem eles, os avisos ficam no sino.
