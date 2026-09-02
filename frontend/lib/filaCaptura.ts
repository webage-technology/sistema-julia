// Fila persistente da captura (IndexedDB, nativo do navegador — sem dependências).
// Cada foto capturada é gravada no APARELHO antes de entrar na fila de envio e
// só sai daqui depois que o servidor confirma o upload. Fechar a aba, travar o
// navegador ou reiniciar o celular não perde fotos: ao reabrir a tela de
// captura da mesma vistoria, os pendentes são recuperados e o envio continua.

export interface ItemPersistido {
  key: number // autoIncrement do IndexedDB
  vistoriaId: number
  ambienteId: number | null
  capturadaEm: string
  claquete: boolean
  destaque: boolean
  blob: Blob
  criadaEm: string
}

const DB_NOME = 'sistema-julia-captura'
const STORE = 'fila'

let dbPromise: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true })
          st.createIndex('vistoria', 'vistoriaId')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error)
      }
    })
  }
  return dbPromise
}

function tx<T>(modo: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, modo)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

// Grava a foto no aparelho; devolve a chave para remoção pós-upload.
export async function salvarNaFila(item: Omit<ItemPersistido, 'key'>): Promise<number> {
  return (await tx('readwrite', (st) => st.add(item))) as number
}

export function atualizarNaFila(item: ItemPersistido): Promise<unknown> {
  return tx('readwrite', (st) => st.put(item))
}

export function removerDaFila(key: number): Promise<unknown> {
  return tx('readwrite', (st) => st.delete(key))
}

// Fotos que ficaram para trás em sessões anteriores desta vistoria.
export async function pendentesDaVistoria(vistoriaId: number): Promise<ItemPersistido[]> {
  const todos = (await tx('readonly', (st) => st.index('vistoria').getAll(vistoriaId))) as ItemPersistido[]
  return todos.sort((a, b) => a.key - b.key)
}
