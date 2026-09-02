// Tipos e constantes compartilhados do módulo de vistorias.

export interface Ambiente {
  id: number
  pavimentoId: number
  nome: string
  ordem: number
  origem: 'planta' | 'campo'
  situacao: 'previsto' | 'nao_existe'
  nomearDepois: boolean
  nota: string
  medidas: string
  fotos: number
}

export interface Pavimento {
  id: number
  nome: string
  ordem: number
  ambientes: Ambiente[]
}

export interface VistoriaResumo {
  id: number
  imovelId: number
  tipoServico: string
  dataVistoria: string | null
  status: string
  imovelNome?: string
  endereco?: string
  clienteNome?: string
  responsavelId?: number | null
  responsavelNome?: string | null
  fotos: number
}

export interface VistoriaDetalhe {
  id: number
  imovelId: number
  tipoServico: string
  dataVistoria: string | null
  participantes: string
  status: string
  responsavelId: number | null
  responsavelNome: string | null
  viagemId: number | null
  viagemTitulo: string | null
  imovelNome: string
  endereco: string
  temPlanta: boolean
  clienteNome: string
  pavimentos: Pavimento[]
  totais: { fotos: number; semAmbiente: number }
}

export interface ClienteOpcao {
  id: number
  name: string
  company: string
  tipo: 'pf' | 'pj'
}

// Cliente pessoa jurídica é conhecido pela empresa (razão social); pessoa física,
// pelo próprio nome. É a mesma regra do backend (db.js → CLIENTE_NOME), que já
// entrega `clienteNome` pronto — isto serve às telas que montam a lista a partir
// de /clients, como o cadastro de imóvel.
export const nomeDoCliente = (c: Pick<ClienteOpcao, 'name' | 'company' | 'tipo'>) =>
  c.tipo === 'pj' && c.company ? c.company : c.name

export interface Imovel {
  id: number
  clientId: number
  nome: string
  endereco: string
  clienteNome?: string
  plantaNome?: string
  temPlanta?: boolean
  vistorias?: number
}

export interface Foto {
  id: number
  ambienteId: number | null
  capturadaEm: string | null
  nomeOriginal: string
  claquete: boolean
  destaque: boolean
  lip: boolean
  ordem: number
}

// Etapas na ordem do trabalho. 'relatorio' é o depois de "Finalizar vistoria":
// as fotos acabaram e o que resta é o laudo.
export const STATUS_LABEL: Record<string, string> = {
  preparo: 'Em preparo',
  campo: 'Em campo',
  conferencia: 'Em conferência',
  relatorio: 'Relatório',
  concluida: 'Concluída',
}

// Cinza, vermelho e preto: o vermelho cheio é só de "em campo" (o que está
// acontecendo agora) e o preto de "relatório" (o que exige trabalho no
// escritório). O resto é cinza, para não competir por atenção.
export const STATUS_COR: Record<string, string> = {
  preparo: 'bg-muted text-muted-foreground ring-1 ring-border',
  campo: 'bg-primary text-primary-foreground',
  conferencia: 'bg-zinc-200 text-zinc-900',
  relatorio: 'bg-zinc-900 text-white',
  concluida: 'bg-card text-muted-foreground ring-1 ring-border',
}

// A etapa de fotos acabou? Vale para a tela decidir o que colocar em destaque.
export const emRelatorio = (status: string) => status === 'relatorio' || status === 'concluida'

export const TIPOS_SERVICO = [
  'EVTL — Estudo de Viabilidade Técnica e Legal',
  'LIP — Laudo de Inspeção Predial',
  'Laudo de bombeiro',
  'As-built',
  'Regularização',
  'Atualização',
  'Cautelar de vizinhança',
  'Entrega de obra',
  'Locação',
  'Outro',
]

// Paleta para identificar ambientes na conferência (indexada pela posição do
// ambiente na lista achatada da vistoria).
export const CORES_AMBIENTE = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2',
  '#be185d', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#b91c1c',
]

export const corDoAmbiente = (indice: number) => CORES_AMBIENTE[indice % CORES_AMBIENTE.length]

// Lista achatada de ambientes com o nome do pavimento junto (ordem do caminho previsto).
export function ambientesAchatados(pavimentos: Pavimento[]) {
  return pavimentos.flatMap((p) =>
    p.ambientes.map((a) => ({ ...a, pavimentoNome: p.nome }))
  )
}

// Busca por nome nas listas: ignora acentos e maiúsculas, e exige que TODAS as
// palavras digitadas apareçam em algum dos campos ("joao silva" acha "João da
// Silva"). Filtra no navegador — as listas do escritório cabem na memória.
const semAcento = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function filtrarPorTexto<T>(itens: T[], busca: string, campos: (item: T) => unknown[]): T[] {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean)
  if (!termos.length) return itens
  return itens.filter((item) => {
    const alvo = campos(item).map(semAcento).join(' ')
    return termos.every((t) => alvo.includes(t))
  })
}

// Classe utilitária de <select> nativo no estilo dos inputs do shadcn.
export const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
