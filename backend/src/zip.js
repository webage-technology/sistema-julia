'use strict'

// Leitura de um .zip — que é o que um .docx é por dentro (XMLs + mídia).
//
// O `archiver`, que já usamos, só ESCREVE zip. Para abrir o modelo enviado pela
// Julia e trocar os campos, é preciso LER. Em vez de mais uma dependência, o
// formato é lido aqui: o `zlib` do Node faz a descompactação e o resto é
// aritmética de deslocamento sobre o buffer.
//
// Não trata Zip64 (arquivos acima de 4 GB ou com mais de 65.535 entradas) nem
// entradas criptografadas — um modelo de documento Word não chega perto disso.
const zlib = require('node:zlib')

const FIM_CENTRAL = 0x06054b50 // End of Central Directory
const CENTRAL = 0x02014b50 // Central Directory File Header

// O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele.
function acharFimCentral(buf) {
  const limite = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === FIM_CENTRAL) return i
  }
  return -1
}

/** Abre o zip e devolve Map(nome do arquivo → Buffer já descompactado). */
function lerEntradas(buf) {
  const fim = acharFimCentral(buf)
  if (fim < 0) throw new Error('Arquivo não é um .docx válido (não parece um pacote Word)')
  const total = buf.readUInt16LE(fim + 10)
  let p = buf.readUInt32LE(fim + 16)

  const entradas = new Map()
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) {
      throw new Error('Arquivo .docx corrompido (índice interno inconsistente)')
    }
    const metodo = buf.readUInt16LE(p + 10)
    const tamanhoComprimido = buf.readUInt32LE(p + 20)
    const nomeLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const comentarioLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen)

    // O cabeçalho local repete nome e extra — e o `extra` costuma ter tamanho
    // DIFERENTE do que está no índice central. Os dados começam depois dele.
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const bruto = buf.subarray(inicio, inicio + tamanhoComprimido)
    if (!nome.endsWith('/')) {
      if (metodo === 0) entradas.set(nome, Buffer.from(bruto))
      else if (metodo === 8) entradas.set(nome, zlib.inflateRawSync(bruto))
      else throw new Error(`Compressão não suportada no .docx (método ${metodo})`)
    }
    p += 46 + nomeLen + extraLen + comentarioLen
  }
  return entradas
}

module.exports = { lerEntradas }
