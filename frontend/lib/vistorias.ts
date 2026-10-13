'use client'

// Tipos e constantes compartilhados do módulo de vistorias.
import { useEffect, useMemo, useState } from 'react'
import { api } from './api'

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
  comprimento: number | null
  largura: number | null
  peDireito: number | null
  area: number | null
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
  processoId?: number | null
  processoNumero?: string | null
  fotos: number
}

export interface VistoriaDetalhe {
  id: number
  imovelId: number
  clientId?: number
  tipoServico: string
  dataVistoria: string | null
  participantes: string
  status: string
  responsavelId: number | null
  responsavelNome: string | null
  processoId: number | null
  processoNumero: string | null
  processoTitulo: string | null
  viagemId: number | null
  viagemTitulo: string | null
  imovelNome: string
  endereco: string
  temPlanta: boolean
  pinos?: number
  areaAprovada?: number | null
  areaIptu?: number | null
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
  processos?: number
  // Ficha cadastral (regularização)
  matricula?: string
  cartorio?: string
  inscricao?: string
  lote?: string
  quadra?: string
  zoneamento?: string
  uso?: string
  areaTerreno?: number | null
  areaAprovada?: number | null
  areaIptu?: number | null
  latitude?: number | null
  longitude?: number | null
  cep?: string
  municipio?: string
  uf?: string
  observacoes?: string
}

export interface Foto {
  id: number
  ambienteId: number | null
  capturadaEm: string | null
  nomeOriginal: string
  claquete: boolean
  destaque: boolean
  lip: boolean
  legenda: string
  ordem: number
  latitude?: number | null
  longitude?: number | null
  precisao?: number | null
  temAnotacao?: boolean
  carimbada?: boolean
  cartao?: boolean // foto de cartão de claquete com QR (lido no upload)
}

// Resultado de POST /vistorias/:id/fotos/separar — fotos separadas por
// ambiente a partir dos cartões de claquete com QR.
export interface Separacao {
  cartoes: number
  separadas: number
  ambientesCriados: number
  semAmbiente: number
  ambientes: number
}

export const separarPorCartoes = (vistoriaId: number | string, refazer = false) =>
  api.post<{ data: Separacao }>(`/vistorias/${vistoriaId}/fotos/separar`, { refazer }).then((r) => r.data)

// cartoes/semAmbiente = vistoria inteira; separadas/ambientes/criados = só esta passada.
export function resumoSeparacao(s: Separacao) {
  if (!s.cartoes) return 'Nenhum cartão de claquete encontrado nas fotos — separe na Conferência.'
  const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
  const partes = [
    s.separadas
      ? `${pl(s.separadas, 'foto separada', 'fotos separadas')} em ${pl(s.ambientes, 'ambiente', 'ambientes')} pelos cartões de claquete`
      : 'Nenhuma foto nova para separar',
  ]
  if (s.ambientesCriados) partes.push(`${pl(s.ambientesCriados, 'ambiente novo', 'ambientes novos')} para nomear na Conferência`)
  if (s.semAmbiente) partes.push(`${pl(s.semAmbiente, 'foto ficou', 'fotos ficaram')} sem ambiente (antes do primeiro cartão do dia) — veja na Conferência`)
  return partes.join(' · ')
}

// Relatório como DOCUMENTO: existe como registro, aparece na área de Relatórios
// e pode ser lido no contexto amplo (todos) ou filtrado por vistoria/imóvel.
export interface Relatorio {
  id: number
  vistoriaId: number
  modelo: string
  titulo: string
  subtitulo: string
  dataTexto: string
  fonte: string
  texto: string
  modeloId: number | null
  modeloNome: string | null
  modeloTipo: 'nativo' | 'docx'
  imovelId: number
  imovelNome: string
  endereco: string
  clientId: number
  clienteNome: string
  tipoServico: string
  dataVistoria: string | null
  fotosIncluidas: number
  createdAt: string
  updatedAt: string
}

// Um modelo da biblioteca (o "armário" de documentos do escritório).
//   'nativo' — montado por código, com as fotos da vistoria (o fotográfico)
//   'docx'   — arquivo do escritório, preenchido pelos campos {{...}} que tiver
export interface Modelo {
  id: number
  nome: string
  descricao: string
  tipo: 'nativo' | 'docx'
  chave: string
  temArquivo: boolean
  nomeOriginal: string
  usos: number
  createdAt: string
}

export interface CampoModelo {
  chave: string
  descricao: string
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

// Os tipos que existem independentemente da biblioteca de modelos. Os nomes dos
// relatórios entram por cima destes — ver useTiposServico() no fim do arquivo.
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

/**
 * Tipos de serviço para escolher numa vistoria.
 *
 * O tipo da vistoria e o nome do relatório dizem a mesma coisa — que trabalho é
 * este —, então a lista fixa é somada aos nomes dos modelos da biblioteca:
 * cadastrou um modelo novo, ele já aparece aqui como tipo. "Outro" fica sempre
 * por último, que é o lugar de um item pega-tudo.
 *
 * Devolve a lista fixa de imediato e acrescenta os modelos quando eles chegam —
 * assim quem usa `tipos[0]` como valor padrão nunca pega um array vazio.
 */
export function useTiposServico(): string[] {
  const [modelos, setModelos] = useState<string[]>([])

  useEffect(() => {
    api
      .get<{ data: { nome: string }[] }>('/modelos')
      .then((r) => setModelos(r.data.map((m) => m.nome)))
      .catch(() => {}) // sem a biblioteca, a lista fixa já resolve
  }, [])

  return useMemo(() => {
    const fixos = TIPOS_SERVICO.filter((t) => t !== 'Outro')
    const vistos = new Set(fixos.map(semAcento))
    const extras: string[] = []
    for (const nome of modelos) {
      const chave = semAcento(nome)
      if (!nome.trim() || vistos.has(chave)) continue // já está na lista fixa
      vistos.add(chave)
      extras.push(nome)
    }
    return [...fixos, ...extras, 'Outro']
  }, [modelos])
}

// Classe utilitária de <select> nativo no estilo dos inputs do shadcn.
export const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
