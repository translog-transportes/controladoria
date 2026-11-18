const express = require('express');
const { query, transacao } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { validar, paginacao, dataValida } = require('../utils/validate');
const { diasCorridos, calcularTotal, calcularExcedente } = require('../utils/locacao');
const { montarContrato, gerarDocx } = require('../utils/contratoLocacao');

// Data de hoje no fuso do servidor (AAAA-MM-DD).
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dataBR = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

// ==================== /api/locacoes ====================
const r = express.Router();
const ver = exigir('locacoes.ver', 'locacoes.editar');
const editar = exigir('locacoes.editar');

// Campos financeiros só mudam enquanto a locação está RESERVADA (antes de gerar a conta a receber).
const camposFinanceiros = {
  cliente_id: { tipo: 'inteiro', obrigatorio: true },
  equipamento_id: { tipo: 'inteiro', obrigatorio: true },
  data_inicio: { tipo: 'data', obrigatorio: true },
  data_fim: { tipo: 'data', obrigatorio: true },
  dias_cobrados: { tipo: 'inteiro', max: 3660 },
  valor_diaria: { tipo: 'decimal', obrigatorio: true },
  valor_deslocamento: { tipo: 'decimal', padrao: '0.00' },
  com_operador: { tipo: 'bool', padrao: 0 },
  valor_operador_dia: { tipo: 'decimal', padrao: '0.00' },
  franquia_horas_dia: { tipo: 'decimal', casas: 1 },
  valor_hora_excedente: { tipo: 'decimal' },
  combustivel: { tipo: 'enum', valores: ['LOCATARIO', 'INCLUSO', 'COBRADO'], padrao: 'LOCATARIO' },
  valor_combustivel: { tipo: 'decimal', padrao: '0.00' },
  caucao: { tipo: 'decimal', padrao: '0.00' },
  desconto: { tipo: 'decimal', padrao: '0.00' },
  data_vencimento: { tipo: 'data' },
};
// Estes podem ser corrigidos a qualquer momento (não mexem em valores).
const camposTexto = {
  endereco: { tipo: 'texto', obrigatorio: true, max: 200 },
  cidade: { tipo: 'texto', max: 80 },
  uf: { tipo: 'texto', max: 2 },
  cliente_endereco: { tipo: 'texto', max: 200 },
  responsavel: { tipo: 'texto', max: 120 },
  telefone: { tipo: 'texto', max: 30 },
  observacao: { tipo: 'texto', max: 2000 },
  leitura_inicio: { tipo: 'decimal', casas: 1 },
};

const SELECT = `
  SELECT l.*, p.nome AS cliente_nome, p.documento AS cliente_documento, p.cidade AS cliente_cidade, p.uf AS cliente_uf,
         p.telefone AS cliente_telefone, p.email AS cliente_email,
         eq.nome AS equipamento_nome, eq.placa AS equipamento_placa, eq.tipo AS equipamento_tipo,
         eq.marca AS equipamento_marca, eq.modelo AS equipamento_modelo, eq.ano AS equipamento_ano,
         lr.status AS recebimento_status, lx.status AS excedente_status
    FROM locacoes l
    JOIN pessoas p       ON p.id = l.cliente_id
    JOIN equipamentos eq ON eq.id = l.equipamento_id
    LEFT JOIN lancamentos lr ON lr.id = l.lancamento_id
    LEFT JOIN lancamentos lx ON lx.id = l.lancamento_excedente_id`;

async function buscar(empresaId, id, conn) {
  const exec = conn ? (sql, p) => conn.query(sql, p).then(([x]) => x) : query;
  const [l] = await exec(`${SELECT} WHERE l.empresa_id = ? AND l.id = ?`, [empresaId, id]);
  if (!l) throw new ErroApp(404, 'Locação não encontrada');
  return l;
}

// Confere datas, dias cobrados e choque com outra locação do mesmo equipamento.
// Trava a linha do equipamento: duas reservas simultâneas não conseguem ocupar os mesmos dias.
async function conferir(conn, empresaId, d, ignorarId = 0) {
  if (d.data_fim < d.data_inicio) throw new ErroApp(422, 'A data final deve ser igual ou posterior à inicial', { data_fim: 'antes do início' });
  const corridos = diasCorridos(d.data_inicio, d.data_fim);
  if (!d.dias_cobrados) d.dias_cobrados = corridos;
  if (d.dias_cobrados > corridos) throw new ErroApp(422, `Dias cobrados não podem passar dos ${corridos} dias do período`, { dias_cobrados: `máximo ${corridos}` });

  const [[eq]] = await conn.query('SELECT id, ativo FROM equipamentos WHERE empresa_id = ? AND id = ? FOR UPDATE', [empresaId, d.equipamento_id]);
  if (!eq) throw new ErroApp(404, 'Equipamento não encontrado');
  const [[cli]] = await conn.query('SELECT id FROM pessoas WHERE empresa_id = ? AND id = ?', [empresaId, d.cliente_id]);
  if (!cli) throw new ErroApp(404, 'Cliente não encontrado');

  const [choque] = await conn.query(
    `SELECT l.numero, l.data_inicio, l.data_fim, p.nome FROM locacoes l JOIN pessoas p ON p.id = l.cliente_id
      WHERE l.empresa_id = ? AND l.equipamento_id = ? AND l.id <> ? AND l.status <> 'CANCELADA'
        AND l.data_inicio <= ? AND l.data_fim >= ? LIMIT 1`,
    [empresaId, d.equipamento_id, ignorarId, d.data_fim, d.data_inicio]
  );
  if (choque.length) {
    const c = choque[0];
    throw new ErroApp(409, `Equipamento já locado de ${dataBR(c.data_inicio)} a ${dataBR(c.data_fim)} para ${c.nome} (locação nº ${c.numero})`);
  }
  d.valor_total = calcularTotal(d).total;
}

// GET /api/locacoes?status=&equipamento_id=&cliente_id=&de=&ate=&q=
r.get('/', ver, ah(async (req, res) => {
  const where = ['l.empresa_id = ?'];
  const params = [req.empresaId];
  const f = validar(req.query, { status: { tipo: 'enum', valores: ['RESERVADA', 'CONFIRMADA', 'CONCLUIDA', 'CANCELADA'] }, equipamento_id: { tipo: 'inteiro' }, cliente_id: { tipo: 'inteiro' } }, { parcial: true });
  if (f.status) { where.push('l.status = ?'); params.push(f.status); }
  if (f.equipamento_id) { where.push('l.equipamento_id = ?'); params.push(f.equipamento_id); }
  if (f.cliente_id) { where.push('l.cliente_id = ?'); params.push(f.cliente_id); }
  if (dataValida(req.query.de)) { where.push('l.data_fim >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('l.data_inicio <= ?'); params.push(req.query.ate); }
  if (typeof req.query.q === 'string' && req.query.q) {
    where.push('(p.nome LIKE ? OR l.endereco LIKE ? OR eq.nome LIKE ? OR eq.placa LIKE ? OR l.numero = ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, Number(req.query.q) || 0);
  }
  const { pagina, porPagina, offset } = paginacao(req.query);
  const sqlWhere = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM locacoes l JOIN pessoas p ON p.id = l.cliente_id JOIN equipamentos eq ON eq.id = l.equipamento_id WHERE ${sqlWhere}`, params);
  const dados = await query(`${SELECT} WHERE ${sqlWhere} ORDER BY l.data_inicio DESC, l.id DESC LIMIT ? OFFSET ?`, [...params, porPagina, offset]);
  res.json({ dados, pagina, por_pagina: porPagina, total });
}));

// GET /api/locacoes/calendario?de=&ate=
// Equipamentos ativos, locações e apontamentos do período, para montar o calendário da frota.
r.get('/calendario', exigir('frota.ver', 'locacoes.ver', 'locacoes.editar'), ah(async (req, res) => {
  if (!dataValida(req.query.de) || !dataValida(req.query.ate)) throw new ErroApp(422, 'Informe o período (de e ate, AAAA-MM-DD)');
  if (diasCorridos(req.query.de, req.query.ate) > 93) throw new ErroApp(422, 'Período máximo de 93 dias');
  const [equipamentos, locacoes, apontamentos] = await Promise.all([
    query('SELECT id, nome, placa, tipo, receita_dia FROM equipamentos WHERE empresa_id = ? AND ativo = 1 ORDER BY tipo DESC, nome', [req.empresaId]),
    query(
      `SELECT l.id, l.numero, l.equipamento_id, l.data_inicio, l.data_fim, l.status, l.endereco, l.cidade, p.nome AS cliente_nome
         FROM locacoes l JOIN pessoas p ON p.id = l.cliente_id
        WHERE l.empresa_id = ? AND l.status <> 'CANCELADA' AND l.data_inicio <= ? AND l.data_fim >= ?`,
      [req.empresaId, req.query.ate, req.query.de]
    ),
    query(
      `SELECT a.id, a.equipamento_id, a.data, a.situacao, a.horas, a.observacao, a.centro_custo_id, cc.nome AS centro_custo_nome
         FROM apontamentos a LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id
        WHERE a.empresa_id = ? AND a.data BETWEEN ? AND ?`,
      [req.empresaId, req.query.de, req.query.ate]
    ),
  ]);
  res.json({ hoje: hojeLocal(), equipamentos, locacoes, apontamentos });
}));

r.get('/:id', ver, ah(async (req, res) => {
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/locacoes  -> nasce RESERVADA (ocupa o calendário, ainda sem conta a receber)
r.post('/', editar, ah(async (req, res) => {
  const d = { ...validar(req.body, camposFinanceiros), ...validar(req.body, camposTexto) };
  const id = await transacao(async (conn) => {
    await conferir(conn, req.empresaId, d);
    const [[{ proximo }]] = await conn.query('SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM locacoes WHERE empresa_id = ? FOR UPDATE', [req.empresaId]);
    const [ins] = await conn.query('INSERT INTO locacoes SET ?', [{ ...d, empresa_id: req.empresaId, numero: proximo, criado_por: req.usuario.id }]);
    return ins.insertId;
  });
  res.status(201).json(await buscar(req.empresaId, id));
}));

// PUT /api/locacoes/:id
// RESERVADA: tudo pode mudar. Depois de confirmada, só endereço, contatos, observação e leitura de entrega.
r.put('/:id', editar, ah(async (req, res) => {
  const id = await transacao(async (conn) => {
    const atual = await buscar(req.empresaId, req.params.id, conn);
    if (atual.status === 'CANCELADA') throw new ErroApp(409, 'Locação cancelada não pode ser alterada');
    const texto = validar(req.body, camposTexto, { parcial: true });
    let fin = {};
    if (atual.status === 'RESERVADA') {
      fin = validar(req.body, camposFinanceiros, { parcial: true });
      if (Object.keys(fin).length) {
        const juntos = { ...atual, ...fin };
        if (fin.data_inicio || fin.data_fim) { if (fin.dias_cobrados === undefined) juntos.dias_cobrados = null; }
        await conferir(conn, req.empresaId, juntos, atual.id);
        for (const k of Object.keys(camposFinanceiros)) fin[k] = juntos[k];
        fin.valor_total = juntos.valor_total;
      }
    }
    // confirmada ou concluída: valores, datas e equipamento enviados são ignorados (a conta a receber já existe)
    const dados = { ...fin, ...texto };
    if (!Object.keys(dados).length) throw new ErroApp(400, 'Nenhum campo para alterar');
    await conn.query('UPDATE locacoes SET ? WHERE empresa_id = ? AND id = ?', [dados, req.empresaId, atual.id]);
    return atual.id;
  });
  res.json(await buscar(req.empresaId, id));
}));

// Categoria de receita para a cobrança: a informada ou a primeira de receita com "loca" no nome.
async function categoriaReceita(conn, empresaId, categoriaId) {
  if (categoriaId) {
    const [[c]] = await conn.query("SELECT id FROM categorias WHERE empresa_id = ? AND id = ? AND tipo = 'RECEITA'", [empresaId, categoriaId]);
    if (!c) throw new ErroApp(422, 'Categoria de receita inválida');
    return c.id;
  }
  const [[c]] = await conn.query(
    `SELECT id FROM categorias WHERE empresa_id = ? AND tipo = 'RECEITA' AND parent_id IS NOT NULL AND ativo = 1
      ORDER BY (nome LIKE '%loca%') DESC, codigo LIMIT 1`,
    [empresaId]
  );
  if (!c) throw new ErroApp(422, 'Cadastre uma categoria de receita (ex.: Locação de equipamentos) no plano de contas');
  return c.id;
}

async function criarContaReceber(conn, req, l, { valor, vencimento, categoriaId, descricao, documento }) {
  const [[eq]] = await conn.query('SELECT centro_custo_id FROM equipamentos WHERE empresa_id = ? AND id = ?', [req.empresaId, l.equipamento_id]);
  const [ins] = await conn.query('INSERT INTO lancamentos SET ?', [{
    empresa_id: req.empresaId, tipo: 'RECEBER', pessoa_id: l.cliente_id,
    categoria_id: await categoriaReceita(conn, req.empresaId, categoriaId),
    centro_custo_id: eq.centro_custo_id || null,
    descricao, documento, data_emissao: hojeLocal(), data_competencia: l.data_inicio,
    data_vencimento: vencimento, valor, parcela: 1, total_parcelas: 1, criado_por: req.usuario.id,
  }]);
  return ins.insertId;
}

// POST /api/locacoes/:id/confirmar  { data_vencimento, categoria_id? }
// Fecha a locação e gera a conta a receber do valor total.
r.post('/:id/confirmar', editar, ah(async (req, res) => {
  const d = validar(req.body, { data_vencimento: { tipo: 'data', obrigatorio: true }, categoria_id: { tipo: 'inteiro' } });
  await transacao(async (conn) => {
    const [[trava]] = await conn.query('SELECT id FROM locacoes WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.params.id]);
    if (!trava) throw new ErroApp(404, 'Locação não encontrada');
    const l = await buscar(req.empresaId, req.params.id, conn);
    if (l.status !== 'RESERVADA') throw new ErroApp(409, 'Só uma locação reservada pode ser confirmada');
    if (Number(l.valor_total) <= 0) throw new ErroApp(422, 'Locação sem valor: informe a diária antes de confirmar');
    const eq = l.equipamento_placa ? `${l.equipamento_nome} (${l.equipamento_placa})` : l.equipamento_nome;
    const lancamentoId = await criarContaReceber(conn, req, l, {
      valor: l.valor_total, vencimento: d.data_vencimento, categoriaId: d.categoria_id,
      descricao: `Locação nº ${l.numero} - ${eq} - ${dataBR(l.data_inicio)} a ${dataBR(l.data_fim)}`.slice(0, 200),
      documento: `LOC ${l.numero}`,
    });
    await conn.query("UPDATE locacoes SET status = 'CONFIRMADA', data_vencimento = ?, lancamento_id = ? WHERE id = ?", [d.data_vencimento, lancamentoId, l.id]);
  });
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/locacoes/:id/concluir  { leitura_inicio?, leitura_fim?, data_vencimento_excedente?, categoria_id? }
// Registra a devolução. Com franquia de horas e as duas leituras, cobra as horas excedentes.
r.post('/:id/concluir', editar, ah(async (req, res) => {
  const d = validar(req.body, {
    leitura_inicio: { tipo: 'decimal', casas: 1 },
    leitura_fim: { tipo: 'decimal', casas: 1 },
    data_vencimento_excedente: { tipo: 'data' },
    categoria_id: { tipo: 'inteiro' },
  });
  await transacao(async (conn) => {
    const [[trava]] = await conn.query('SELECT id FROM locacoes WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.params.id]);
    if (!trava) throw new ErroApp(404, 'Locação não encontrada');
    const l = await buscar(req.empresaId, req.params.id, conn);
    if (l.status !== 'CONFIRMADA') throw new ErroApp(409, 'Só uma locação confirmada pode ser concluída');
    const inicio = d.leitura_inicio ?? l.leitura_inicio;
    const fim = d.leitura_fim;
    const mudancas = { status: 'CONCLUIDA', leitura_inicio: inicio ?? null, leitura_fim: fim ?? null };
    if (inicio !== null && inicio !== undefined && fim !== null && fim !== undefined) {
      if (Number(fim) < Number(inicio)) throw new ErroApp(422, 'A leitura da devolução não pode ser menor que a da entrega', { leitura_fim: 'menor que a entrega' });
      const ex = calcularExcedente(l, inicio, fim);
      mudancas.horas_excedentes = ex.horas;
      mudancas.valor_excedente = ex.valor;
      if (ex.valor && Number(ex.valor) > 0) {
        if (!d.data_vencimento_excedente) throw new ErroApp(422, `Há ${ex.horas} h excedentes (${ex.valor}); informe o vencimento da cobrança`, { data_vencimento_excedente: 'obrigatório' });
        mudancas.lancamento_excedente_id = await criarContaReceber(conn, req, l, {
          valor: ex.valor, vencimento: d.data_vencimento_excedente, categoriaId: d.categoria_id,
          descricao: `Locação nº ${l.numero} - ${ex.horas} h excedentes`, documento: `LOC ${l.numero}-EX`,
        });
      }
      await conn.query('UPDATE equipamentos SET leitura_atual = GREATEST(leitura_atual, ?) WHERE empresa_id = ? AND id = ?', [fim, req.empresaId, l.equipamento_id]);
    }
    await conn.query('UPDATE locacoes SET ? WHERE id = ?', [mudancas, l.id]);
  });
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/locacoes/:id/cancelar
// Libera o calendário. Se já havia conta a receber sem recebimento, ela é cancelada junto.
r.post('/:id/cancelar', editar, ah(async (req, res) => {
  await transacao(async (conn) => {
    const [[l]] = await conn.query('SELECT id, status, lancamento_id FROM locacoes WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.params.id]);
    if (!l) throw new ErroApp(404, 'Locação não encontrada');
    if (l.status === 'CANCELADA') throw new ErroApp(409, 'Locação já cancelada');
    if (l.status === 'CONCLUIDA') throw new ErroApp(409, 'Locação concluída não pode ser cancelada');
    if (l.lancamento_id) {
      const [[c]] = await conn.query('SELECT status FROM lancamentos WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, l.lancamento_id]);
      if (c && c.status !== 'ABERTO' && c.status !== 'CANCELADO') {
        throw new ErroApp(409, 'A conta a receber desta locação já tem recebimento; estorne o recebimento antes de cancelar');
      }
      await conn.query("UPDATE lancamentos SET status = 'CANCELADO' WHERE empresa_id = ? AND id = ? AND status = 'ABERTO'", [req.empresaId, l.lancamento_id]);
    }
    await conn.query("UPDATE locacoes SET status = 'CANCELADA' WHERE id = ?", [l.id]);
  });
  res.json(await buscar(req.empresaId, req.params.id));
}));

async function dadosContrato(req) {
  const l = await buscar(req.empresaId, req.params.id);
  if (l.status === 'CANCELADA') throw new ErroApp(409, 'Locação cancelada não gera contrato');
  const [empresa] = await query('SELECT razao_social, nome_fantasia, cnpj FROM empresas WHERE id = ?', [req.empresaId]);
  return { l, modelo: montarContrato(l, empresa, hojeLocal()) };
}

// GET /api/locacoes/:id/contrato       -> o contrato montado (a tela imprime)
// GET /api/locacoes/:id/contrato.docx  -> o mesmo contrato em Word
r.get('/:id/contrato', ver, ah(async (req, res) => {
  res.json((await dadosContrato(req)).modelo);
}));
r.get('/:id/contrato.docx', ver, ah(async (req, res) => {
  const { l, modelo } = await dadosContrato(req);
  const arquivo = await gerarDocx(modelo);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.set('Content-Disposition', `attachment; filename="contrato-locacao-${String(l.numero).padStart(4, '0')}.docx"`);
  res.send(arquivo);
}));

// ==================== /api/apontamentos ====================
// O que cada equipamento fez em cada dia. Dia locado não aceita apontamento (a locação manda).
const apontamentos = express.Router();
const lancar = exigir('abastecimentos.lancar', 'frota.editar');

const camposApontamento = {
  equipamento_id: { tipo: 'inteiro', obrigatorio: true },
  data: { tipo: 'data', obrigatorio: true },
  situacao: { tipo: 'enum', valores: ['TRABALHANDO', 'PARADO', 'MANUTENCAO', 'FOLGA'], obrigatorio: true },
  centro_custo_id: { tipo: 'inteiro' },
  horas: { tipo: 'decimal', casas: 1 },
  observacao: { tipo: 'texto', max: 200 },
};

async function gravarApontamento(conn, req, a) {
  if (a.horas !== undefined && a.horas !== null && Number(a.horas) > 24) throw new ErroApp(422, 'Horas do dia: no máximo 24', { horas: 'máximo 24' });
  const [[eq]] = await conn.query('SELECT id FROM equipamentos WHERE empresa_id = ? AND id = ?', [req.empresaId, a.equipamento_id]);
  if (!eq) throw new ErroApp(404, 'Equipamento não encontrado');
  const [loc] = await conn.query(
    `SELECT l.numero, p.nome FROM locacoes l JOIN pessoas p ON p.id = l.cliente_id
      WHERE l.empresa_id = ? AND l.equipamento_id = ? AND l.status <> 'CANCELADA' AND ? BETWEEN l.data_inicio AND l.data_fim LIMIT 1`,
    [req.empresaId, a.equipamento_id, a.data]
  );
  if (loc.length) throw new ErroApp(409, `Neste dia o equipamento está locado para ${loc[0].nome} (locação nº ${loc[0].numero})`);
  const linha = {
    empresa_id: req.empresaId, equipamento_id: a.equipamento_id, data: a.data, situacao: a.situacao,
    centro_custo_id: a.situacao === 'TRABALHANDO' ? a.centro_custo_id || null : null,
    horas: a.horas ?? null, observacao: a.observacao ?? null, criado_por: req.usuario.id,
  };
  await conn.query(
    `INSERT INTO apontamentos SET ?
     ON DUPLICATE KEY UPDATE situacao = VALUES(situacao), centro_custo_id = VALUES(centro_custo_id), horas = VALUES(horas),
                             observacao = VALUES(observacao), criado_por = VALUES(criado_por)`,
    [linha]
  );
}

apontamentos.get('/', exigir('frota.ver'), ah(async (req, res) => {
  const where = ['a.empresa_id = ?'];
  const params = [req.empresaId];
  if (req.query.equipamento_id) { where.push('a.equipamento_id = ?'); params.push(Number(req.query.equipamento_id)); }
  if (dataValida(req.query.de)) { where.push('a.data >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('a.data <= ?'); params.push(req.query.ate); }
  res.json(await query(
    `SELECT a.*, eq.nome AS equipamento_nome, cc.nome AS centro_custo_nome FROM apontamentos a
       JOIN equipamentos eq ON eq.id = a.equipamento_id LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id
      WHERE ${where.join(' AND ')} ORDER BY a.data DESC, eq.nome LIMIT 2000`,
    params
  ));
}));

// PUT /api/apontamentos  -> grava (ou substitui) o apontamento de um equipamento em um dia
apontamentos.put('/', lancar, ah(async (req, res) => {
  const a = validar(req.body, camposApontamento);
  await transacao((conn) => gravarApontamento(conn, req, a));
  res.json({ ok: true });
}));

// POST /api/apontamentos/lote  { data, itens: [{ equipamento_id, situacao|null, centro_custo_id, horas }] }
// Aponta o dia de vários equipamentos de uma vez. situacao vazia apaga o apontamento do dia.
apontamentos.post('/lote', lancar, ah(async (req, res) => {
  const { data } = validar(req.body, { data: { tipo: 'data', obrigatorio: true } });
  const itens = req.body.itens;
  if (!Array.isArray(itens) || !itens.length || itens.length > 500) throw new ErroApp(422, 'Lista de equipamentos inválida');
  let gravados = 0;
  await transacao(async (conn) => {
    for (const bruto of itens) {
      if (bruto && (bruto.situacao === null || bruto.situacao === '')) {
        const eqId = Number(bruto.equipamento_id);
        if (!Number.isInteger(eqId) || eqId <= 0) throw new ErroApp(422, 'Equipamento inválido');
        await conn.query('DELETE FROM apontamentos WHERE empresa_id = ? AND equipamento_id = ? AND data = ?', [req.empresaId, eqId, data]);
        continue;
      }
      await gravarApontamento(conn, req, validar({ ...bruto, data }, camposApontamento));
      gravados += 1;
    }
  });
  res.json({ gravados });
}));

apontamentos.delete('/:id', lancar, ah(async (req, res) => {
  const resultado = await query('DELETE FROM apontamentos WHERE empresa_id = ? AND id = ?', [req.empresaId, req.params.id]);
  if (!resultado.affectedRows) throw new ErroApp(404, 'Apontamento não encontrado');
  res.status(204).end();
}));

module.exports = { locacoes: r, apontamentos, hojeLocal };
