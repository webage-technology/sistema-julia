'use client'

// Tipos e rótulos da camada de regularização (processos, protocolos,
// documentos, RRT, despesas, laudos emitidos, arquivos, notificações,
// inspeção). Os rótulos ficam aqui para que toda tela escreva igual.

export const ETAPAS = ['levantamento', 'projeto', 'protocolo', 'comunique_se', 'aprovacao', 'concluido', 'arquivado'] as const
export type Etapa = (typeof ETAPAS)[number]
export const ETAPA_LABEL: Record<string, string> = {
  levantamento: 'Levantamento',
  projeto: 'Projeto',
  protocolo: 'Protocolado',
  comunique_se: 'Comunique-se',
  aprovacao: 'Aprovação',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
}
// Cinza para o que espera, vermelho para o que exige resposta, preto para o
// que está com o órgão, verde discreto para concluído.
export const ETAPA_COR: Record<string, string> = {
  levantamento: 'bg-muted text-muted-foreground ring-1 ring-border',
  projeto: 'bg-zinc-200 text-zinc-900',
  protocolo: 'bg-zinc-900 text-white',
  comunique_se: 'bg-primary text-primary-foreground',
  aprovacao: 'bg-zinc-700 text-white',
  concluido: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300',
  arquivado: 'bg-card text-muted-foreground ring-1 ring-border',
}

export const PRIORIDADE_LABEL: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }

export const TIPOS_PROCESSO = [
  'Regularização',
  'Habite-se',
  'AVCB / CLCB',
  'Alvará de reforma',
  'Aprovação de projeto',
  'Desdobro / Unificação',
  'EVTL — Estudo de Viabilidade Técnica e Legal',
  'LIP — Laudo de Inspeção Predial',
  'Laudo de bombeiro',
  'As-built',
  'Consultoria',
  'Outro',
]

export const ORGAO_LABEL: Record<string, string> = {
  prefeitura: 'Prefeitura',
  bombeiros: 'Corpo de Bombeiros',
  cartorio: 'Cartório',
  cetesb: 'CETESB',
  vigilancia: 'Vigilância Sanitária',
  condominio: 'Condomínio',
  outro: 'Outro',
}
export const TIPO_PROTOCOLO_LABEL: Record<string, string> = {
  protocolo: 'Protocolo',
  comunique_se: 'Comunique-se',
  exigencia: 'Exigência',
  resposta: 'Resposta enviada',
  deferimento: 'Deferimento',
  indeferimento: 'Indeferimento',
  vistoria_orgao: 'Vistoria do órgão',
  outro: 'Outro',
}
export const STATUS_PROTOCOLO_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  respondido: 'Respondido',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
  cancelado: 'Cancelado',
}
export const STATUS_DOC_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  recebido: 'Recebido',
  vencido: 'Vencido',
  dispensado: 'Dispensado',
}
export const STATUS_DOC_COR: Record<string, string> = {
  pendente: 'bg-primary/10 text-primary ring-1 ring-primary/30',
  recebido: 'bg-emerald-100 text-emerald-900',
  vencido: 'bg-primary text-primary-foreground',
  dispensado: 'bg-muted text-muted-foreground',
}
export const STATUS_RRT_LABEL: Record<string, string> = { emitida: 'Emitida', registrada: 'Registrada', baixada: 'Baixada', cancelada: 'Cancelada' }
export const CATEGORIA_DESPESA_LABEL: Record<string, string> = {
  taxa_prefeitura: 'Taxa da prefeitura',
  cartorio: 'Cartório',
  bombeiros: 'Bombeiros',
  copias: 'Cópias / plotagem',
  correio: 'Correio',
  deslocamento: 'Deslocamento',
  outro: 'Outro',
}
export const CATEGORIA_ARQUIVO_LABEL: Record<string, string> = {
  planta: 'Planta',
  matricula: 'Matrícula',
  iptu: 'IPTU',
  alvara: 'Alvará',
  'habite-se': 'Habite-se',
  avcb: 'AVCB / CLCB',
  projeto: 'Projeto',
  rrt: 'RRT / ART',
  guia: 'Guia paga',
  contrato: 'Contrato / proposta',
  procuracao: 'Procuração',
  'documento-pessoal': 'Documento do cliente',
  laudo: 'Laudo',
  oficio: 'Ofício',
  foto: 'Foto',
  outro: 'Outro',
}
export const GRAU_LABEL: Record<string, string> = { critico: 'Crítico', regular: 'Regular', minimo: 'Mínimo' }
export const GRAU_COR: Record<string, string> = {
  critico: 'bg-primary text-primary-foreground',
  regular: 'bg-zinc-900 text-white',
  minimo: 'bg-muted text-muted-foreground ring-1 ring-border',
}
export const PRAZO_NC_LABEL: Record<string, string> = { imediato: 'Imediato', curto: 'Curto prazo', medio: 'Médio prazo', longo: 'Longo prazo' }
export const ANOMALIA_LABEL: Record<string, string> = {
  fissura: 'Fissura',
  trinca: 'Trinca',
  infiltracao: 'Infiltração',
  umidade: 'Umidade',
  corrosao: 'Corrosão',
  desplacamento: 'Desplacamento',
  eletrica: 'Instalação elétrica',
  hidraulica: 'Instalação hidráulica',
  estrutural: 'Estrutural',
  acessibilidade: 'Acessibilidade',
  incendio: 'Segurança contra incêndio',
  esquadria: 'Esquadria',
  cobertura: 'Cobertura',
  pintura: 'Pintura',
  piso: 'Piso',
  outro: 'Outro',
}
export const RESULTADO_LABEL: Record<string, string> = {
  pendente: 'Não verificado',
  conforme: 'Conforme',
  nao_conforme: 'Não conforme',
  nao_aplicavel: 'Não se aplica',
}

export interface Processo {
  id: number
  numero: string
  clientId: number
  imovelId: number | null
  titulo: string
  tipo: string
  etapa: string
  prioridade: string
  responsavelId: number | null
  responsavelNome: string | null
  descricao: string
  inicio: string | null
  previsao: string | null
  concluidoEm: string | null
  createdAt: string
  updatedAt: string
  clienteNome: string
  imovelNome: string | null
  imovelEndereco: string | null
  protocolosAbertos: number
  proximoPrazo: string | null
  docsPendentes: number
  vistorias: number
}

export interface Protocolo {
  id: number
  processoId: number
  orgao: string
  tipo: string
  numero: string
  assunto: string
  data: string | null
  prazo: string | null
  status: string
  resposta: string
  respondidoEm: string | null
  observacoes: string
  arquivoId: number | null
  vencido: boolean
  diasParaPrazo: number | null
}

export interface Documento {
  id: number
  processoId: number
  nome: string
  obrigatorio: boolean
  status: string
  arquivoId: number | null
  arquivoNome: string | null
  validade: string | null
  recebidoEm: string | null
  observacao: string
  ordem: number
}

export interface Rrt {
  id: number
  processoId: number
  vistoriaId: number | null
  userId: number | null
  profissionalNome: string | null
  profissionalRegistro: string | null
  tipo: string
  numero: string
  atividade: string
  data: string | null
  valor: number
  status: string
  arquivoId: number | null
  arquivoNome: string | null
  observacoes: string
}

export interface DespesaProcesso {
  id: number
  processoId: number
  categoria: string
  descricao: string
  valor: number
  data: string | null
  reembolsavel: boolean
  reembolsadoEm: string | null
  temComprovante: boolean
  nomeOriginal: string
}

export interface Laudo {
  id: number
  vistoriaId: number
  processoId: number | null
  modelo: string
  numero: string
  versao: number
  titulo: string
  hash: string
  paginas: number
  tamanho: number
  emitidoPorNome: string | null
  emitidoEm: string
  observacoes: string
  temAssinado: boolean
  assinadoEm: string | null
  visivelCliente: boolean
  aprovadoEm: string | null
  aprovacaoComentario: string
  imovelNome?: string
  clienteNome?: string
  dataVistoria?: string | null
  processoNumero?: string | null
}

export interface Arquivo {
  id: number
  processoId: number | null
  imovelId: number | null
  clientId: number | null
  vistoriaId: number | null
  categoria: string
  nome: string
  descricao: string
  nomeOriginal: string
  mime: string
  tamanho: number
  versao: number
  substituiId: number | null
  validade: string | null
  visivelCliente: boolean
  enviadoPorNome: string | null
  enviadoPeloCliente: boolean
  createdAt: string
  vencido: boolean
}

export interface Notificacao {
  id: number
  tipo: string
  titulo: string
  mensagem: string
  link: string
  lidaEm: string | null
  createdAt: string
  processoId: number | null
  vistoriaId: number | null
}

export interface NaoConformidade {
  id: number
  vistoriaId: number
  ambienteId: number | null
  fotoId: number | null
  titulo: string
  anomalia: string
  grau: string
  descricao: string
  recomendacao: string
  prazo: string
  ordem: number
  ambienteNome: string | null
  pavimentoNome: string | null
}

export interface ChecklistItem {
  id: number
  vistoriaId: number
  ambienteId: number | null
  nome: string
  resultado: string
  fotoId: number | null
  observacao: string
  ordem: number
  ambienteNome: string | null
  pavimentoNome: string | null
}

export interface Pino {
  id?: number
  ambienteId: number
  nome: string
  pavimentoNome?: string
  prancha: number
  x: number
  y: number
}

export interface Prazo {
  chave: string
  tipo: 'protocolo' | 'documento'
  subtipo?: string
  id: number
  data: string
  dias: number
  vencido: boolean
  titulo: string
  detalhe: string
  processoId: number
  processoNumero: string
  processoTitulo: string
  clienteNome: string
  responsavelId: number | null
  valor?: number
  link: string
}

export interface ModeloLaudo {
  id: string
  label: string
  prefixo: string
  titulo: string
}

export const dinheiro = (n: number | null | undefined) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const dia = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
export const dataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
export const tamanho = (bytes: number) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
export const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
