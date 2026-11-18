const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { ErroApp } = require('../middleware/errors');

const TAMANHO_MAXIMO = 20 * 1024 * 1024; // 20 MB

// Só entram tipos conhecidos, e o conteúdo precisa bater com a extensão
// (um .exe renomeado para .pdf é recusado).
const TIPOS = {
  pdf: { mime: 'application/pdf', assinatura: [0x25, 0x50, 0x44, 0x46] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', assinatura: [0x50, 0x4b, 0x03, 0x04] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', assinatura: [0x50, 0x4b, 0x03, 0x04] },
  png: { mime: 'image/png', assinatura: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', assinatura: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', assinatura: [0xff, 0xd8, 0xff] },
};

// O arquivo fica em memória só até ser validado; depois vai para o disco.
const receber = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO, files: 1, fields: 20 },
}).single('arquivo');

function validarArquivo(file, extensoes = Object.keys(TIPOS)) {
  if (!file) throw new ErroApp(400, 'Envie o arquivo no campo "arquivo"');
  // O multer entrega o nome em latin1; convertemos para manter os acentos.
  const nome = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8')).slice(0, 255);
  const ext = path.extname(nome).slice(1).toLowerCase();
  const tipo = TIPOS[ext];
  if (!tipo || !extensoes.includes(ext)) throw new ErroApp(415, `Tipo de arquivo não aceito. Use: ${extensoes.join(', ')}`);
  if (!tipo.assinatura.every((b, i) => file.buffer[i] === b)) {
    throw new ErroApp(415, 'O conteúdo do arquivo não corresponde à extensão');
  }
  return { nome, ext, mime: tipo.mime };
}

// Grava em storage/<empresa>/<nome aleatório>. O nome original nunca vira caminho em disco,
// o que elimina ataques por nome de arquivo (../../ etc.).
async function salvar(empresaId, buffer) {
  const pasta = path.join(config.storageDir, String(empresaId));
  await fs.promises.mkdir(pasta, { recursive: true });
  const caminho = `${empresaId}/${crypto.randomUUID()}`;
  await fs.promises.writeFile(path.join(config.storageDir, caminho), buffer, { flag: 'wx' });
  return { caminho, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function caminhoAbsoluto(caminho) {
  const abs = path.resolve(config.storageDir, caminho);
  if (!abs.startsWith(config.storageDir + path.sep)) throw new ErroApp(400, 'Caminho inválido');
  return abs;
}

async function apagar(caminho) {
  await fs.promises.unlink(caminhoAbsoluto(caminho)).catch(() => {});
}

module.exports = { receber, validarArquivo, salvar, caminhoAbsoluto, apagar };
