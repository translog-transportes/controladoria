const express = require('express');
const { query } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { validar, paginacao, dataValida } = require('./validate');

// Gera as rotas de um cadastro (listar, ver, criar, alterar, excluir), sempre filtrando
// por empresa e exigindo a permissão informada. "tabela", nomes de campos e trechos de
// junção vêm do código, nunca da requisição, então podem ser interpolados no SQL com segurança.
//
// opções:
//   ver / editar   permissões exigidas para leitura e gravação
//   juncao         { select: ', p.nome AS x', join: 'LEFT JOIN pessoas p ON ...' } (tabela principal = t)
//   campoData      habilita os filtros ?de=&ate= sobre esse campo
//   filtroExtra    (req, where, params) => void, para filtros específicos
//   aposCriar      (req, linha) => Promise, executado depois de incluir
//   semExcluir     não gera a rota DELETE
function crud({ tabela, campos, ver, editar, busca = [], ordem = 't.id', juncao = {}, campoData, filtroExtra, aposCriar, semExcluir }) {
  const r = express.Router();
  const SELECT = `SELECT t.*${juncao.select || ''} FROM ${tabela} t ${juncao.join || ''}`;
  const filtraveis = Object.entries(campos)
    .filter(([, regra]) => ['enum', 'inteiro', 'bool'].includes(regra.tipo))
    .map(([nome]) => nome);

  const umRegistro = async (empresaId, id) => {
    const [linha] = await query(`${SELECT} WHERE t.empresa_id = ? AND t.id = ?`, [empresaId, id]);
    if (!linha) throw new ErroApp(404, 'Registro não encontrado');
    return linha;
  };

  r.get('/', exigir(ver), ah(async (req, res) => {
    const where = ['t.empresa_id = ?'];
    const params = [req.empresaId];

    const filtros = {};
    for (const campo of filtraveis) {
      if (req.query[campo] !== undefined && req.query[campo] !== '') filtros[campo] = req.query[campo];
    }
    const limpos = validar(filtros, campos, { parcial: true });
    for (const [campo, valor] of Object.entries(limpos)) {
      where.push(`t.${campo} = ?`);
      params.push(valor);
    }
    if (campoData) {
      if (dataValida(req.query.de)) { where.push(`t.${campoData} >= ?`); params.push(req.query.de); }
      if (dataValida(req.query.ate)) { where.push(`t.${campoData} <= ?`); params.push(`${req.query.ate} 23:59:59`); }
    }
    if (typeof req.query.q === 'string' && req.query.q && busca.length) {
      where.push(`(${busca.map((c) => `t.${c} LIKE ?`).join(' OR ')})`);
      for (let i = 0; i < busca.length; i++) params.push(`%${req.query.q}%`);
    }
    if (filtroExtra) filtroExtra(req, where, params);

    const { pagina, porPagina, offset } = paginacao(req.query);
    const sqlWhere = where.join(' AND ');
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ${tabela} t WHERE ${sqlWhere}`, params);
    const dados = await query(`${SELECT} WHERE ${sqlWhere} ORDER BY ${ordem} LIMIT ? OFFSET ?`, [...params, porPagina, offset]);
    res.json({ dados, pagina, por_pagina: porPagina, total });
  }));

  r.get('/:id', exigir(ver), ah(async (req, res) => {
    res.json(await umRegistro(req.empresaId, req.params.id));
  }));

  r.post('/', exigir(editar), ah(async (req, res) => {
    const dados = validar(req.body, campos);
    const resultado = await query(`INSERT INTO ${tabela} SET ?`, [{ ...dados, empresa_id: req.empresaId }]);
    const linha = await umRegistro(req.empresaId, resultado.insertId);
    if (aposCriar) await aposCriar(req, linha);
    res.status(201).json(linha);
  }));

  r.put('/:id', exigir(editar), ah(async (req, res) => {
    const dados = validar(req.body, campos, { parcial: true });
    if (!Object.keys(dados).length) throw new ErroApp(400, 'Nenhum campo para alterar');
    const resultado = await query(`UPDATE ${tabela} SET ? WHERE empresa_id = ? AND id = ?`, [dados, req.empresaId, req.params.id]);
    if (!resultado.affectedRows) throw new ErroApp(404, 'Registro não encontrado');
    res.json(await umRegistro(req.empresaId, req.params.id));
  }));

  // Se o registro já foi usado, o banco recusa (FK) e a API responde 409.
  if (!semExcluir) {
    r.delete('/:id', exigir(editar), ah(async (req, res) => {
      const resultado = await query(`DELETE FROM ${tabela} WHERE empresa_id = ? AND id = ?`, [req.empresaId, req.params.id]);
      if (!resultado.affectedRows) throw new ErroApp(404, 'Registro não encontrado');
      res.status(204).end();
    }));
  }

  return r;
}

module.exports = crud;
