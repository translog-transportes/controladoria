const express = require('express');
const crypto = require('crypto');
const { query, transacao } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { validar, paginacao, paraCentavos, deCentavos, somarMeses, dataValida } = require('../utils/validate');

// Contas a pagar e a receber (tipo PAGAR | RECEBER) e suas baixas.
const r = express.Router();
r.use(exigir('financeiro.ver'));
const escrita = exigir('financeiro.editar');
const baixar = exigir('financeiro.baixar');

const campos = {
  tipo: { tipo: 'enum', valores: ['PAGAR', 'RECEBER'], obrigatorio: true },
  pessoa_id: { tipo: 'inteiro', obrigatorio: true },
  categoria_id: { tipo: 'inteiro', obrigatorio: true },
  centro_custo_id: { tipo: 'inteiro' },
  descricao: { tipo: 'texto', obrigatorio: true, max: 200 },
  documento: { tipo: 'texto', max: 40 },
  data_emissao: { tipo: 'data' },
  data_competencia: { tipo: 'data' },
  data_vencimento: { tipo: 'data', obrigatorio: true },
  valor: { tipo: 'decimal', obrigatorio: true, positivo: true },
  observacao: { tipo: 'texto', max: 5000 },
};

const SELECT = `
  SELECT l.*, (l.valor - l.valor_baixado) AS saldo,
         p.nome AS pessoa_nome, c.codigo AS categoria_codigo, c.nome AS categoria_nome,
         cc.codigo AS centro_custo_codigo, cc.nome AS centro_custo_nome,
         (SELECT GROUP_CONCAT(DISTINCT COALESCE(eq.placa, eq.nome) ORDER BY COALESCE(eq.placa, eq.nome) SEPARATOR ', ')
            FROM abastecimentos ab JOIN equipamentos eq ON eq.id = ab.equipamento_id
           WHERE ab.empresa_id = l.empresa_id AND ab.lancamento_id = l.id) AS placas
    FROM lancamentos l
    JOIN pessoas p     ON p.id = l.pessoa_id
    JOIN categorias c  ON c.id = l.categoria_id
    LEFT JOIN centros_custo cc ON cc.id = l.centro_custo_id`;

function statusPara(valorCent, baixadoCent) {
  if (baixadoCent <= 0) return 'ABERTO';
  return baixadoCent < valorCent ? 'PARCIAL' : 'QUITADO';
}

// Conta a pagar exige categoria de DESPESA; conta a receber, de RECEITA.
async function conferirCategoria(empresaId, categoriaId, tipo) {
  const [cat] = await query('SELECT tipo FROM categorias WHERE empresa_id = ? AND id = ?', [empresaId, categoriaId]);
  if (!cat) throw new ErroApp(422, 'Categoria não existe nesta empresa');
  const esperado = tipo === 'PAGAR' ? 'DESPESA' : 'RECEITA';
  if (cat.tipo !== esperado) throw new ErroApp(422, `Conta a ${tipo.toLowerCase()} exige categoria de ${esperado.toLowerCase()}`);
}

// ---------- abastecimentos pagos por uma conta a pagar (combustível) ----------

const SELECT_ABAST = `
  SELECT a.id, a.data, a.leitura, a.litros, a.valor_total, a.tanque_cheio, a.posto, a.operador, a.lancamento_id,
         eq.nome AS equipamento_nome, eq.placa, eq.tipo AS equipamento_tipo, cc.nome AS centro_custo_nome
    FROM abastecimentos a
    JOIN equipamentos eq ON eq.id = a.equipamento_id
    LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id`;

function lerIds(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 500) throw new ErroApp(422, 'Lista de abastecimentos inválida');
  const ids = v.map(Number);
  if (!ids.every((n) => Number.isInteger(n) && n > 0)) throw new ErroApp(422, 'Lista de abastecimentos inválida');
  return [...new Set(ids)];
}

// Um abastecimento só pode estar em uma conta a pagar: assim nenhum combustível é pago duas vezes.
async function vincularAbastecimentos(conn, empresaId, lancamentoId, ids) {
  if (!ids.length) return;
  const [linhas] = await conn.query('SELECT id, lancamento_id FROM abastecimentos WHERE empresa_id = ? AND id IN (?) FOR UPDATE', [empresaId, ids]);
  if (linhas.length !== ids.length) throw new ErroApp(404, 'Abastecimento não encontrado nesta empresa');
  const emOutra = linhas.find((a) => a.lancamento_id && Number(a.lancamento_id) !== Number(lancamentoId));
  if (emOutra) throw new ErroApp(409, `O abastecimento ${emOutra.id} já está vinculado a outra conta a pagar`);
  await conn.query('UPDATE abastecimentos SET lancamento_id = ? WHERE empresa_id = ? AND id IN (?)', [lancamentoId, empresaId, ids]);
}

async function buscar(empresaId, id) {
  const [l] = await query(`${SELECT} WHERE l.empresa_id = ? AND l.id = ?`, [empresaId, id]);
  if (!l) throw new ErroApp(404, 'Lançamento não encontrado');
  return l;
}

// GET /api/lancamentos?tipo=PAGAR&status=ABERTO&venc_de=&venc_ate=&vencidos=1&pessoa_id=&categoria_id=&centro_custo_id=&q=
r.get('/', ah(async (req, res) => {
  const q = req.query;
  const where = ['l.empresa_id = ?'];
  const params = [req.empresaId];

  const f = validar(
    Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')),
    {
      tipo: campos.tipo,
      status: { tipo: 'enum', valores: ['ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO'] },
      pessoa_id: { tipo: 'inteiro' },
      categoria_id: { tipo: 'inteiro' },
      centro_custo_id: { tipo: 'inteiro' },
      venc_de: { tipo: 'data' },
      venc_ate: { tipo: 'data' },
    },
    { parcial: true }
  );
  for (const campo of ['tipo', 'status', 'pessoa_id', 'categoria_id', 'centro_custo_id']) {
    if (f[campo] != null) { where.push(`l.${campo} = ?`); params.push(f[campo]); }
  }
  if (f.venc_de) { where.push('l.data_vencimento >= ?'); params.push(f.venc_de); }
  if (f.venc_ate) { where.push('l.data_vencimento <= ?'); params.push(f.venc_ate); }
  if (q.vencidos === '1') where.push("l.status IN ('ABERTO','PARCIAL') AND l.data_vencimento < CURDATE()");
  if (q.q) {
    // a busca também encontra a conta pela placa dos abastecimentos vinculados
    where.push(`(l.descricao LIKE ? OR l.documento LIKE ? OR p.nome LIKE ? OR EXISTS (
      SELECT 1 FROM abastecimentos ab JOIN equipamentos eq ON eq.id = ab.equipamento_id
       WHERE ab.empresa_id = l.empresa_id AND ab.lancamento_id = l.id AND (eq.placa LIKE ? OR eq.nome LIKE ?)))`);
    for (let i = 0; i < 5; i++) params.push(`%${q.q}%`);
  }

  const sqlWhere = where.join(' AND ');
  const { pagina, porPagina, offset } = paginacao(q);
  const [resumo] = await query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(l.valor), 0) AS valor_total,
            COALESCE(SUM(CASE WHEN l.status <> 'CANCELADO' THEN l.valor - l.valor_baixado ELSE 0 END), 0) AS saldo_total
       FROM lancamentos l JOIN pessoas p ON p.id = l.pessoa_id
      WHERE ${sqlWhere}`,
    params
  );
  const dados = await query(
    `${SELECT} WHERE ${sqlWhere} ORDER BY l.data_vencimento, l.id LIMIT ? OFFSET ?`,
    [...params, porPagina, offset]
  );
  res.json({ dados, pagina, por_pagina: porPagina, ...resumo });
}));

// GET /api/lancamentos/abastecimentos-pendentes?de=&ate=&q=
// Abastecimentos que ainda não estão em nenhuma conta a pagar (q busca placa, equipamento ou posto).
r.get('/abastecimentos-pendentes', ah(async (req, res) => {
  const where = ['a.empresa_id = ?', 'a.lancamento_id IS NULL'];
  const params = [req.empresaId];
  if (dataValida(req.query.de)) { where.push('a.data >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('a.data <= ?'); params.push(req.query.ate); }
  if (typeof req.query.q === 'string' && req.query.q) {
    where.push('(eq.placa LIKE ? OR eq.nome LIKE ? OR a.posto LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  res.json(await query(`${SELECT_ABAST} WHERE ${where.join(' AND ')} ORDER BY a.data, eq.nome LIMIT 500`, params));
}));

// GET /api/lancamentos/:id  (com as baixas e os abastecimentos vinculados)
r.get('/:id', ah(async (req, res) => {
  const l = await buscar(req.empresaId, req.params.id);
  l.baixas = await query(
    `SELECT b.*, cb.nome AS conta_bancaria_nome
       FROM baixas b JOIN contas_bancarias cb ON cb.id = b.conta_bancaria_id
      WHERE b.empresa_id = ? AND b.lancamento_id = ? ORDER BY b.data_baixa, b.id`,
    [req.empresaId, l.id]
  );
  l.abastecimentos = await query(`${SELECT_ABAST} WHERE a.empresa_id = ? AND a.lancamento_id = ? ORDER BY a.data, eq.nome`, [req.empresaId, l.id]);
  res.json(l);
}));

// POST /api/lancamentos
// Com "parcelas": N, divide o valor em N parcelas mensais a partir de data_vencimento
// (a diferença de centavos fica na última parcela).
r.post('/', escrita, ah(async (req, res) => {
  const d = validar(req.body, { ...campos, parcelas: { tipo: 'inteiro', max: 120, padrao: 1 } });
  const parcelas = d.parcelas || 1;
  delete d.parcelas;
  // "abastecimentos": [ids] liga a conta (ex.: nota do posto) aos abastecimentos que ela paga
  const abastIds = lerIds(req.body.abastecimentos);
  if (abastIds.length && d.tipo !== 'PAGAR') throw new ErroApp(422, 'Abastecimentos só podem ser vinculados a contas a pagar');
  await conferirCategoria(req.empresaId, d.categoria_id, d.tipo);

  const totalCent = paraCentavos(d.valor);
  const baseCent = Math.floor(totalCent / parcelas);
  if (baseCent <= 0) throw new ErroApp(422, 'Valor pequeno demais para esse número de parcelas');
  const grupo = parcelas > 1 ? crypto.randomUUID() : null;
  const competencia = d.data_competencia || d.data_emissao || d.data_vencimento;

  const ids = await transacao(async (conn) => {
    const criados = [];
    for (let i = 0; i < parcelas; i++) {
      const valorCent = i === parcelas - 1 ? totalCent - baseCent * (parcelas - 1) : baseCent;
      const [resultado] = await conn.query('INSERT INTO lancamentos SET ?', [{
        ...d,
        empresa_id: req.empresaId,
        data_competencia: competencia,
        data_vencimento: somarMeses(d.data_vencimento, i),
        valor: deCentavos(valorCent),
        parcela: i + 1,
        total_parcelas: parcelas,
        grupo_parcelas: grupo,
        criado_por: req.usuario.id,
      }]);
      criados.push(resultado.insertId);
    }
    // conta parcelada: os abastecimentos ficam ligados à 1ª parcela
    await vincularAbastecimentos(conn, req.empresaId, criados[0], abastIds);
    return criados;
  });

  const dados = await query(`${SELECT} WHERE l.empresa_id = ? AND l.id IN (?) ORDER BY l.parcela`, [req.empresaId, ids]);
  res.status(201).json(parcelas > 1 ? dados : dados[0]);
}));

// PUT /api/lancamentos/:id
// O tipo não muda; o valor só muda enquanto não houver baixa.
r.put('/:id', escrita, ah(async (req, res) => {
  const { tipo: _ignorado, ...editaveis } = campos;
  const d = validar(req.body, editaveis, { parcial: true });
  if (!Object.keys(d).length) throw new ErroApp(400, 'Nenhum campo para alterar');

  const atual = await buscar(req.empresaId, req.params.id);
  if (atual.status === 'CANCELADO') throw new ErroApp(409, 'Lançamento cancelado não pode ser alterado');
  if (d.valor !== undefined && paraCentavos(atual.valor_baixado) > 0) {
    throw new ErroApp(409, 'Não é possível mudar o valor de um lançamento que já tem baixa; estorne a baixa antes');
  }
  for (const obrig of ['pessoa_id', 'categoria_id', 'descricao', 'data_vencimento', 'valor', 'data_competencia']) {
    if (d[obrig] === null) throw new ErroApp(422, `${obrig} não pode ficar vazio`);
  }
  if (d.categoria_id) await conferirCategoria(req.empresaId, d.categoria_id, atual.tipo);

  await query('UPDATE lancamentos SET ? WHERE empresa_id = ? AND id = ?', [d, req.empresaId, atual.id]);
  res.json(await buscar(req.empresaId, atual.id));
}));

// POST /api/lancamentos/:id/cancelar  (só sem baixas; nada é apagado, fica o histórico)
r.post('/:id/cancelar', escrita, ah(async (req, res) => {
  const resultado = await transacao(async (conn) => {
    const [upd] = await conn.query(
      "UPDATE lancamentos SET status = 'CANCELADO' WHERE empresa_id = ? AND id = ? AND status = 'ABERTO'",
      [req.empresaId, req.params.id]
    );
    // os abastecimentos da conta cancelada voltam a ficar livres para outra conta
    if (upd.affectedRows) {
      await conn.query('UPDATE abastecimentos SET lancamento_id = NULL WHERE empresa_id = ? AND lancamento_id = ?', [req.empresaId, req.params.id]);
    }
    return upd;
  });
  if (!resultado.affectedRows) {
    await buscar(req.empresaId, req.params.id); // 404 se não existir
    throw new ErroApp(409, 'Só é possível cancelar lançamento em aberto e sem baixas');
  }
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/lancamentos/:id/reabrir  (desfaz o cancelamento)
r.post('/:id/reabrir', escrita, ah(async (req, res) => {
  const resultado = await query(
    "UPDATE lancamentos SET status = 'ABERTO' WHERE empresa_id = ? AND id = ? AND status = 'CANCELADO'",
    [req.empresaId, req.params.id]
  );
  if (!resultado.affectedRows) {
    await buscar(req.empresaId, req.params.id);
    throw new ErroApp(409, 'Lançamento não está cancelado');
  }
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/lancamentos/:id/baixas
// { conta_bancaria_id, data_baixa, valor?, juros?, multa?, desconto?, observacao? }
// Sem "valor", quita o saldo inteiro. Aceita baixa parcial.
r.post('/:id/baixas', baixar, ah(async (req, res) => {
  const d = validar(req.body, {
    conta_bancaria_id: { tipo: 'inteiro', obrigatorio: true },
    data_baixa: { tipo: 'data', obrigatorio: true },
    valor: { tipo: 'decimal', positivo: true },
    juros: { tipo: 'decimal', padrao: '0.00' },
    multa: { tipo: 'decimal', padrao: '0.00' },
    desconto: { tipo: 'decimal', padrao: '0.00' },
    observacao: { tipo: 'texto', max: 200 },
  });

  await transacao(async (conn) => {
    // FOR UPDATE trava a linha: duas baixas simultâneas não passam do saldo.
    const [[l]] = await conn.query(
      'SELECT id, valor, valor_baixado, status FROM lancamentos WHERE empresa_id = ? AND id = ? FOR UPDATE',
      [req.empresaId, req.params.id]
    );
    if (!l) throw new ErroApp(404, 'Lançamento não encontrado');
    if (l.status === 'CANCELADO') throw new ErroApp(409, 'Lançamento cancelado');
    if (l.status === 'QUITADO') throw new ErroApp(409, 'Lançamento já quitado');

    const valorCent = paraCentavos(l.valor);
    const baixadoCent = paraCentavos(l.valor_baixado);
    const saldoCent = valorCent - baixadoCent;
    const baixaCent = d.valor ? paraCentavos(d.valor) : saldoCent;
    if (baixaCent > saldoCent) throw new ErroApp(422, `Valor maior que o saldo em aberto (${deCentavos(saldoCent)})`);

    const movimento = baixaCent + paraCentavos(d.juros || '0') + paraCentavos(d.multa || '0') - paraCentavos(d.desconto || '0');
    if (movimento < 0) throw new ErroApp(422, 'Desconto maior que o valor da baixa');

    await conn.query('INSERT INTO baixas SET ?', [{
      empresa_id: req.empresaId,
      lancamento_id: l.id,
      conta_bancaria_id: d.conta_bancaria_id,
      data_baixa: d.data_baixa,
      valor: deCentavos(baixaCent),
      juros: d.juros || '0.00',
      multa: d.multa || '0.00',
      desconto: d.desconto || '0.00',
      observacao: d.observacao || null,
      criado_por: req.usuario.id,
    }]);
    const novoBaixado = baixadoCent + baixaCent;
    await conn.query('UPDATE lancamentos SET valor_baixado = ?, status = ? WHERE id = ?', [
      deCentavos(novoBaixado), statusPara(valorCent, novoBaixado), l.id,
    ]);
  });

  res.status(201).json(await buscar(req.empresaId, req.params.id));
}));

// DELETE /api/lancamentos/:id/baixas/:baixaId  (estorno)
r.delete('/:id/baixas/:baixaId', baixar, ah(async (req, res) => {
  await transacao(async (conn) => {
    const [[l]] = await conn.query(
      'SELECT id, valor FROM lancamentos WHERE empresa_id = ? AND id = ? FOR UPDATE',
      [req.empresaId, req.params.id]
    );
    if (!l) throw new ErroApp(404, 'Lançamento não encontrado');
    const [apagada] = await conn.query(
      'DELETE FROM baixas WHERE empresa_id = ? AND lancamento_id = ? AND id = ?',
      [req.empresaId, l.id, req.params.baixaId]
    );
    if (!apagada.affectedRows) throw new ErroApp(404, 'Baixa não encontrada');

    const [[{ baixado }]] = await conn.query(
      'SELECT COALESCE(SUM(valor), 0) AS baixado FROM baixas WHERE empresa_id = ? AND lancamento_id = ?',
      [req.empresaId, l.id]
    );
    const baixadoCent = paraCentavos(String(baixado));
    await conn.query('UPDATE lancamentos SET valor_baixado = ?, status = ? WHERE id = ?', [
      deCentavos(baixadoCent), statusPara(paraCentavos(l.valor), baixadoCent), l.id,
    ]);
  });
  res.json(await buscar(req.empresaId, req.params.id));
}));

// POST /api/lancamentos/:id/abastecimentos  { ids: [..] }  vincula abastecimentos a uma conta a pagar já lançada
r.post('/:id/abastecimentos', escrita, ah(async (req, res) => {
  const ids = lerIds(req.body.ids);
  if (!ids.length) throw new ErroApp(422, 'Selecione ao menos um abastecimento');
  await transacao(async (conn) => {
    const [[l]] = await conn.query('SELECT id, tipo, status FROM lancamentos WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.params.id]);
    if (!l) throw new ErroApp(404, 'Lançamento não encontrado');
    if (l.tipo !== 'PAGAR') throw new ErroApp(422, 'Abastecimentos só podem ser vinculados a contas a pagar');
    if (l.status === 'CANCELADO') throw new ErroApp(409, 'Conta cancelada');
    await vincularAbastecimentos(conn, req.empresaId, l.id, ids);
  });
  res.status(204).end();
}));

// DELETE /api/lancamentos/:id/abastecimentos/:abId  desvincula um abastecimento da conta
r.delete('/:id/abastecimentos/:abId', escrita, ah(async (req, res) => {
  const resultado = await query(
    'UPDATE abastecimentos SET lancamento_id = NULL WHERE empresa_id = ? AND lancamento_id = ? AND id = ?',
    [req.empresaId, req.params.id, req.params.abId]
  );
  if (!resultado.affectedRows) throw new ErroApp(404, 'Abastecimento não está vinculado a esta conta');
  res.status(204).end();
}));

module.exports = r;
