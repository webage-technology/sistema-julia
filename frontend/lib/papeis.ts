'use client'

// Papéis da equipe e o que cada um pode fazer na tela. A regra de verdade
// está no backend (permitir); aqui só se esconde o que não vai funcionar.
export type Papel = 'admin' | 'arquiteto' | 'estagiario' | 'financeiro' | string

export const PAPEL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  arquiteto: 'Arquiteto(a)',
  estagiario: 'Estagiário(a)',
  financeiro: 'Financeiro',
  user: 'Arquiteto(a)',
}

export const PAPEIS: { valor: Papel; label: string; descricao: string }[] = [
  { valor: 'admin', label: 'Administrador', descricao: 'Tudo: usuários, configurações, lixeira, auditoria e IA' },
  { valor: 'arquiteto', label: 'Arquiteto(a)', descricao: 'Processos, vistorias, laudos e exclusões; vê a verba das viagens' },
  { valor: 'estagiario', label: 'Estagiário(a)', descricao: 'Captura, conferência e cadastros — sem excluir nem emitir laudo' },
  { valor: 'financeiro', label: 'Financeiro', descricao: 'Verba das viagens, despesas e prestação de contas; consulta o resto' },
]

export const ehAdmin = (papel?: string | null) => papel === 'admin'
export const ehTecnico = (papel?: string | null) => papel === 'admin' || papel === 'arquiteto'
export const mexeDinheiro = (papel?: string | null) => papel === 'admin' || papel === 'financeiro' || papel === 'arquiteto'
export const podeExcluir = ehTecnico
export const podeEmitir = ehTecnico
