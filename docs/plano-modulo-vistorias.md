# Plano — Módulo de Vistorias do Sistema Julia

> Documento de referência do plano definido com a Julia em **11/08/2026**.
> **Status: Fases 1 e 2 implementadas e testadas de ponta a ponta em 11/08/2026** (cadastro, captura guiada PWA, conferência e export ZIP). **Fase 3 desenhada, aguardando autorização para construir.** Pendente: piloto real no iPhone 16 da Julia.
> Este arquivo é o registro canônico do que foi decidido e por quê. Se o plano mudar, este arquivo deve ser atualizado junto.

## 1. Contexto e problema

- Julia é arquiteta e urbanista atuando em vistorias: **laudo de bombeiro, as-built, regularização, atualização**, entre outras.
- Método de trabalho: percorrer o local fotografando em sequência, formando um **caminho** que outras pessoas conseguem seguir pelas fotos. Já é hábito da equipe fotografar como "claquete" o ambiente indicado na planta e a placa da sala, quando existe.
- Volume: **500 a 1000 fotos por local**.
- Dor: depois do campo, organizar tudo em pastas por pavimento/ambiente e montar o laudo PDF consome períodos inteiros de trabalho.
- Entregáveis atuais: **as pastas organizadas e um laudo em PDF**. Tour virtual interessa como entregável novo.
- Celular de campo: **iPhone 16**; hoje as fotos chegam ao computador pelo **iCloud**.

### As duas ideias-chave que sustentam todo o plano

1. A organização deixa de existir quando a estrutura é registrada **na hora da captura** (ou vira mecânica logo depois dela).
2. Como as fotos são tiradas andando o caminho, a **ordem cronológica equivale à ordem espacial**. Separar 1000 fotos em 20 ambientes são ~20 decisões de fronteira, não 1000 decisões.

## 2. Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Estratégia | Rota C — módulo próprio dentro do Sistema Julia. Apps prontos de mercado foram avaliados e **descartados**: são para vistoria de locação em checklist e não atendem o método do caminho nem os serviços da Julia |
| Sistema em campo | **PWA** — o próprio sistema aberto no navegador do celular, com ícone na tela inicial, sem loja de aplicativos. App nativo só se o piloto real mostrar fricção de câmera |
| Sistema no escritório | O Sistema Julia atual, pelo navegador do computador (cadastros, conferência, laudo, export) |
| Divergência planta × real | **Núcleo do produto** — é o que as-built/regularização/atualização entregam, não um recurso lateral |
| Claquete | Hábito mantido; a primeira foto do ambiente vira "foto de abertura" |
| Armazenamento, bateria, offline | Deliberadamente fora do desenho de produto; primeira pauta do desenho técnico |
| Ordem das fases | F1 → F2 (piloto) → F3a → F3b; cada fase entrega valor sozinha |

## 3. Estrutura da informação

**Cliente → Imóvel/Local → Vistoria → Pavimento → Ambiente → Foto**

- **Cliente**: já existe no sistema atual.
- **Imóvel**: endereço, planta anexada (PDF/imagem) e o **modelo de pavimentos/ambientes na ordem prevista do caminho**. Um cliente pode ter vários imóveis.
- **Vistoria**: criada a partir do imóvel, **nasce com os ambientes copiados do modelo**; tem tipo de serviço (bombeiro, as-built, regularização, atualização…), data e participantes. Um imóvel pode ter várias vistorias — o que habilita comparação entre elas no futuro.
- **Ambiente**: pertence a um pavimento; guarda ordem prevista, ordem real, notas, medidas e fotos. Pode ser marcado como **"não previsto na planta"** (criado em campo) ou **"não existe no local"** — as duas formas de divergência.
- **Foto**: ordem de captura (global e dentro do ambiente), data/hora, marcações (claquete/abertura, destaque/patologia).

## 4. Fase 1 — Cadastro, conferência e export

**Objetivo:** eliminar o pós-campo manual sem mudar nada no jeito de fotografar. É a fundação de todo o resto.

1. **Cadastro do imóvel** (no escritório, com calma): planta anexada, pavimentos, ambientes na ordem prevista do caminho, reordenáveis arrastando. Com a planta em PDF, o botão **“Ler planta e sugerir ambientes”** monta a lista sozinho para revisão — ver [`leitura-de-planta.md`](leitura-de-planta.md).
2. **Criação da vistoria** a partir do imóvel — ambientes já vêm copiados, sem redigitar.
3. **Upload das fotos em lote** pelo computador (vindas do iCloud, como hoje).
4. **Tela de conferência (triagem)**: fotos em fita cronológica; Julia clica na **primeira foto de cada ambiente** (as claquetes tornam as fronteiras visuais) e dá o nome; tudo entre uma fronteira e a próxima se encaixa sozinho. Ajustes finos: arrastar foto para outro ambiente, renomear, excluir.
5. **Export em ZIP** com a estrutura exata do entregável atual: pastas por pavimento/ambiente, fotos numeradas na ordem do caminho (numeração global e por ambiente), datas preservadas.

**Valor entregue:** horas de organização viram minutos, já na primeira versão — antes mesmo da captura guiada existir.

## 5. Fase 2 — Captura guiada no campo (PWA)

**Objetivo:** a foto nascer classificada; a organização deixar de existir.

### Fluxo na prática

- **Véspera (escritório):** abrir cliente → imóvel → criar vistoria → conferir a ordem prevista dos ambientes. Minutos, porque o imóvel guarda o modelo.
- **No local — como começar:** abra o app e toque em **Iniciar vistoria** (botão
  verde no topo do menu; instalado no celular, o app já abre nessa tela). Ela
  lista o que é de hoje e o que está em andamento — um toque leva à câmera.
- **No local — tela de captura:**
  - **Ambiente atual** em destaque no topo + contador de fotos dele;
  - Botão de **disparo** grande;
  - Botão **"Próximo ambiente →"** seguindo a ordem prevista;
  - **Lista/atalho** para pular fora de ordem (o caminho real pode divergir do previsto — o sistema registra a **ordem que Julia de fato andou**, e é essa que vale);
  - **"+ Novo ambiente"** para o que não estava na planta: nome na hora ou **"nomear depois"** (entra como "Novo 1", renomeado na conferência). Fica marcado como **divergência**.
- Cada foto cai direto no ambiente atual, na ordem em que foi tirada. **Único gesto novo: um toque ao trocar de ambiente.**
- **Claquete:** primeira foto do ambiente (planta apontada/placa) marcada como abertura — hábito mantido, com lugar fixo no laudo.
- **Acréscimos definidos junto com a Fase 3** (construir já na F2, baratos agora e caros depois):
  1. **Nota rápida por ambiente** (texto ou ditado por voz): "trinca na parede norte", "extintor vencido";
  2. **Marcar foto como destaque/patologia** (um toque na foto recém-tirada);
  3. **Campo de medidas por ambiente** (anotações de trena/laser do as-built saem do papel).
- **Encerramento:** resumo (X ambientes, Y fotos, Z divergências) + **alerta de ambientes previstos sem nenhuma foto** → marcar "não existe no local" (divergência) ou voltar e fotografar. Elimina o risco de ir embora com cômodo esquecido.
- **De volta:** conferência em minutos (renomear os "Novo", ajustes finos) e export.

### Plano B permanente (resiliência)

Cartões de **claquete-QR** imprimíveis por ambiente, gerados pelo sistema. Se Julia preferir a câmera nativa do iPhone (ou o app falhar no meio da vistoria): fotografa o cartão ao entrar em cada ambiente, as fotos chegam pelo iCloud como hoje, sobem em lote e o sistema separa tudo sozinho lendo os códigos.

### Piloto

A primeira vistoria real com o PWA no iPhone 16 é o teste que decide se o PWA basta ou se vale embalar as mesmas telas num app nativo. Critérios de avaliação: velocidade entre fotos, qualidade em ambiente escuro, conforto de uso.

## 6. Fase 3 — Entregáveis

**Princípio:** capturar uma vez, gerar três saídas do mesmo banco — pastas (já vem da F1), laudo PDF (3a) e tour navegável (3b).

### 6a. Laudo em PDF

**Divisão de trabalho: a montagem é do sistema; a análise técnica é da Julia — com o texto quase pronto.**

Rascunho gerado automaticamente, nesta estrutura:

1. **Capa** — identidade visual da Julia, tipo de serviço, cliente, endereço, data da vistoria, responsável técnica com número do CAU.
2. **Dados da vistoria** — período, participantes, planta de referência.
3. **Divergências planta × real** — seção montada sozinha (ambientes novos encontrados + ambientes previstos inexistentes). Para as-built/regularização é o produto em si; para atualização, o mapa do que mudou.
4. **Registro fotográfico por pavimento/ambiente** — cada ambiente abre com a claquete; grade de fotos na ordem do caminho, com data/hora e número; **fotos destaque ampliadas com legenda**; notas e medidas do ambiente.
5. **Observações e conclusão** — com **templates de texto por tipo de serviço** (bombeiro, as-built, regularização, atualização): Julia escreve seus parágrafos padrão uma vez e eles vêm carregados nas próximas vistorias do mesmo tipo.
6. **Fecho e assinatura** — responsável técnica; futuramente, assinatura digital gov.br/ICP-Brasil.

**Fluxo de emissão:** rascunho editável no navegador (esconder/reordenar fotos, escrever textos) → botão **"Emitir"** congela uma **versão numerada** (v1; v2 em retificação), com data de emissão. O PDF é o formato aceito por órgãos (prefeitura, Corpo de Bombeiros); o tour é para o cliente.

### 6b. Tour navegável ("andar o caminho" no navegador)

Link privado hospedado no próprio Sistema Julia, enviado ao cliente:

- **Modo caminho:** navegação foto a foto na ordem real, com letreiro de localização ("Térreo → Cozinha · foto 12 de 47") e barra de progresso. É a metodologia do caminho virando experiência — sai das fotos que Julia já tira, sem equipamento novo.
- **Índice** por pavimento/ambiente para pular direto a um cômodo.
- **Modo planta:** tocar no ambiente sobre a planta (depende dos pinos da planta interativa — ver evoluções).
- **Controle de acesso:** link não listado, senha opcional, revogável a qualquer momento.
- **Tour 360° imersivo:** upgrade **opcional por projeto** — ambiente que tiver panorâmica (câmera tipo Insta360) exibe a "bolha" navegável junto das fotos comuns, na mesma estrutura. Pode ser precificado à parte, sem mudar o sistema por baixo.

## 7. Evoluções futuras (fila registrada, sem ordem comprometida)

- **Planta interativa com pinos** — no cadastro, um pino por ambiente sobre a planta; em campo, trocar de ambiente tocando no pino; no tour, vira o modo planta.
- **Troca de ambiente por voz** ("cozinha") durante a captura.
- **Leitura automática das claquetes-QR** / pré-marcação de fronteiras na conferência.
- **Assinatura digital gov.br/ICP-Brasil** no PDF emitido.
- **Checklists por tipo de serviço** — ex.: itens de bombeiro (extintores, sinalização, rotas de fuga) marcáveis por ambiente, com foto vinculada.
- **Comparação entre vistorias do mesmo imóvel** — lado a lado, ambiente por ambiente (o modelo de ambientes do imóvel torna isso possível). Diferencial para o serviço de **atualização**.

## 8. Ordem de construção

1. **Fase 1** — cadastro + conferência + export ZIP (já entrega valor sozinha).
2. **Fase 2** — captura guiada, com **piloto numa vistoria real** no iPhone 16 (decide PWA × app nativo).
3. **Fase 3a** — laudo PDF com templates.
4. **Fase 3b** — tour navegável.

## 9. Decisões técnicas tomadas na implementação (11/08/2026)

- **Armazenamento:** volume Docker local `uploads_data` (→ `/app/uploads` no backend). Cada foto em três variantes: `orig` (original intocado), `web` (até 1800px, q80) e `thumb` (até 400px, q72), geradas com sharp. Migração futura para MinIO/S3 fica isolada em `backend/src/uploads.js`.
- **HEIC (iPhone):** convertido para JPEG q95 na entrada (`heic-convert`); a data EXIF é lida antes da conversão. Pendente validar com um lote real do iCloud.
- **Ordem do caminho:** nunca armazenada — deriva sempre de `(capturada_em, id)`. EXIF manda; sem EXIF vale o `capturadaEm` enviado pelo cliente (hora da captura ou `lastModified` do arquivo).
- **Upload:** uma foto por requisição (lote = 3 em paralelo com progresso; captura = fila sequencial com retentativa infinita e aviso de “sem conexão”).
- **Fila persistente (fotos nunca se perdem):** cada foto capturada é gravada no aparelho (IndexedDB, `frontend/lib/filaCaptura.ts`) ANTES do envio e só é removida após o servidor confirmar. Fechar a aba, travar o navegador ou reiniciar o celular não perde nada — ao reabrir a captura da mesma vistoria, os pendentes são recuperados e o envio retoma (banner “fotos recuperadas da sessão anterior”). Se o servidor rejeitar uma foto (ex.: ambiente excluído no escritório), ela é reenviada sem ambiente e cai na conferência — nunca é descartada. Exceção única: navegação privada sem IndexedDB (indicador “sem cópia local” + aviso ao fechar).
- **PWA:** manifest + ícones gerados; login aceita `?next=` para voltar direto à captura. Câmera via navegador com fallback para a câmera nativa do sistema (botão “Nativa” — resolução máxima do aparelho).
- **Autenticação de imagens:** o backend já aceitava `?token=` na query — usado para `<img>`, planta, QR e download do ZIP.

### Pendências restantes

- **Piloto real** no iPhone 16 da Julia (decide PWA × app nativo e valida qualidade da câmera do navegador).
- **Comportamento com a tela bloqueada por longos períodos** (iOS pode pausar o envio em segundo plano; as fotos ficam guardadas no aparelho e sobem ao reabrir — validar no piloto).
- **Autorização da Fase 3** (laudo PDF e tour navegável).

## 10. Glossário

- **Claquete** — primeira foto ao entrar num ambiente (planta apontada ou placa da sala), que o identifica; vira a foto de abertura.
- **Divergência planta × real** — ambiente que existe no local mas não estava na planta, ou o contrário.
- **Ordem do caminho** — sequência real em que Julia andou e fotografou; vale sobre a ordem prevista.
- **PWA** — aplicativo que roda pelo navegador e ganha ícone na tela inicial do celular, sem loja de aplicativos.
- **Conferência** — revisão rápida pós-campo (minutos) antes do export/laudo.
- **Emitir** — congelar uma versão numerada e datada do laudo, pronta para envio.
