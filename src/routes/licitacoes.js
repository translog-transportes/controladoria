const express = require('express');
const fs = require('fs');
const crud = require('../utils/crud');
const { query } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { tem } = require('../middleware/auth');
const { validar } = require('../utils/validate');
const arq = require('../utils/arquivos');

// ---------- /api/licitacoes ----------
const licitacoes = crud({
  ver: 'licitacoes.ver',
  editar: 'licitacoes.editar',
  tabela: 'licitacoes',
  ordem: 't.data_abertura IS NULL, t.data_abertura DESC, t.id DESC',
  busca: ['numero_processo', 'objeto'],
  campoData: 'data_abertura',
  juncao: { select: ', p.nome AS orgao_nome', join: 'LEFT JOIN pessoas p ON p.id = t.orgao_id' },
  campos: {
    orgao_id: { tipo: 'inteiro' },
    numero_processo: { tipo: 'texto', obrigatorio: true, max: 60 },
    modalidade: { tipo: 'enum', obrigatorio: true, valores: ['PREGAO_ELETRONICO', 'PREGAO_PRESENCIAL', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE', 'OUTRA'] },
    objeto: { tipo: 'texto', obrigatorio: true, max: 5000 },
    portal: { tipo: 'texto', max: 120 },
    link: { tipo: 'texto', max: 500 },
    data_abertura: { tipo: 'datahora' },
    valor_estimado: { tipo: 'decimal' },
    valor_proposta: { tipo: 'decimal' },
    status: { tipo: 'enum', padrao: 'PROSPECCAO', valores: ['PROSPECCAO', 'ANALISE', 'PROPOSTA', 'DISPUTA', 'HABILITACAO', 'HOMOLOGADA', 'CONTRATADA', 'PERDIDA', 'DESISTENCIA'] },
    observacao: { tipo: 'texto', max: 5000 },
  },
});

// ---------- /api/documentos (certidões e habilitação) ----------
// ?vencendo_em=30 lista o que vence nos próximos 30 dias (inclui o que já venceu).
const documentos = crud({
  ver: 'licitacoes.ver',
  editar: 'licitacoes.editar',
  tabela: 'documentos_habilitacao',
  ordem: 't.data_validade IS NULL, t.data_validade',
  busca: ['nome', 'numero'],
  juncao: { select: ', DATEDIFF(t.data_validade, CURDATE()) AS dias_para_vencer' },
  filtroExtra: (req, where, params) => {
    const dias = Number(req.query.vencendo_em);
    if (Number.isInteger(dias) && dias >= 0) {
      where.push('t.data_validade <= CURDATE() + INTERVAL ? DAY');
      params.push(dias);
    }
  },
  campos: {
    nome: { tipo: 'texto', obrigatorio: true, max: 120 },
    tipo: { tipo: 'enum', padrao: 'FISCAL', valores: ['FISCAL', 'TRABALHISTA', 'JURIDICA', 'TECNICA', 'ECONOMICA', 'OUTRO'] },
    numero: { tipo: 'texto', max: 60 },
    data_emissao: { tipo: 'data' },
    data_validade: { tipo: 'data' },
    observacao: { tipo: 'texto', max: 300 },
  },
});

// ---------- /api/arquivos (anexos: edital, certidões, contrato, nota) ----------
const arquivos = express.Router();

// A permissão do anexo acompanha a do registro ao qual ele pertence.
const ENTIDADES = {
  LICITACAO: { tabela: 'licitacoes', ver: 'licitacoes.ver', editar: 'licitacoes.editar' },
  DOCUMENTO: { tabela: 'documentos_habilitacao', ver: 'licitacoes.ver', editar: 'licitacoes.editar' },
  CONTRATO: { tabela: 'contratos', ver: 'contratos.ver', editar: 'contratos.editar' },
  NOTA: { tabela: 'notas_fiscais', ver: 'contratos.ver', editar: 'notas.editar' },
};

async function conferirEntidade(req, entidade, entidadeId, acao) {
  if (typeof entidade !== 'string' || !Object.hasOwn(ENTIDADES, entidade)) throw new ErroApp(422, 'Entidade inválida');
  const cfg = ENTIDADES[entidade];
  if (!tem(req, cfg[acao])) throw new ErroApp(403, 'Seu perfil não permite esta operação');
  const [existe] = await query(`SELECT id FROM ${cfg.tabela} WHERE empresa_id = ? AND id = ?`, [req.empresaId, entidadeId]);
  if (!existe) throw new ErroApp(404, 'Registro não encontrado');
}

async function arquivoOu404(req, acao) {
  const [a] = await query('SELECT * FROM arquivos WHERE empresa_id = ? AND id = ?', [req.empresaId, req.params.id]);
  if (!a) throw new ErroApp(404, 'Arquivo não encontrado');
  if (!tem(req, ENTIDADES[a.entidade][acao])) throw new ErroApp(403, 'Seu perfil não permite esta operação');
  return a;
}

// GET /api/arquivos?entidade=CONTRATO&entidade_id=1
arquivos.get('/', ah(async (req, res) => {
  const id = Number(req.query.entidade_id);
  await conferirEntidade(req, req.query.entidade, id, 'ver');
  res.json(await query(
    `SELECT a.id, a.nome_original, a.mime, a.tamanho, a.criado_em, u.nome AS criado_por_nome
       FROM arquivos a LEFT JOIN usuarios u ON u.id = a.criado_por
      WHERE a.empresa_id = ? AND a.entidade = ? AND a.entidade_id = ? ORDER BY a.id`,
    [req.empresaId, req.query.entidade, id]
  ));
}));

// POST /api/arquivos  (multipart: arquivo, entidade, entidade_id)
arquivos.post('/', arq.receber, ah(async (req, res) => {
  const d = validar(req.body, {
    entidade: { tipo: 'enum', valores: Object.keys(ENTIDADES), obrigatorio: true },
    entidade_id: { tipo: 'inteiro', obrigatorio: true },
  });
  await conferirEntidade(req, d.entidade, d.entidade_id, 'editar');
  const info = arq.validarArquivo(req.file);
  const { caminho, sha256 } = await arq.salvar(req.empresaId, req.file.buffer);
  const r = await query('INSERT INTO arquivos SET ?', [{
    empresa_id: req.empresaId,
    entidade: d.entidade,
    entidade_id: d.entidade_id,
    nome_original: info.nome,
    caminho,
    mime: info.mime,
    tamanho: req.file.size,
    sha256,
    criado_por: req.usuario.id,
  }]);
  res.status(201).json({ id: r.insertId, nome_original: info.nome, tamanho: req.file.size });
}));

// GET /api/arquivos/:id/download  (sempre como download, nunca aberto dentro do sistema)
arquivos.get('/:id/download', ah(async (req, res) => {
  const a = await arquivoOu404(req, 'ver');
  const abs = arq.caminhoAbsoluto(a.caminho);
  if (!fs.existsSync(abs)) throw new ErroApp(404, 'Arquivo não está mais no servidor');
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Length', a.tamanho);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  fs.createReadStream(abs).pipe(res);
}));

arquivos.delete('/:id', ah(async (req, res) => {
  const a = await arquivoOu404(req, 'editar');
  await query('DELETE FROM arquivos WHERE id = ?', [a.id]);
  await arq.apagar(a.caminho);
  res.status(204).end();
}));

module.exports = { licitacoes, documentos, arquivos };
