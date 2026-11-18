const express = require('express');
const { query, transacao } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { validar, paginacao, paraCentavos, deCentavos, escalar, desescalar, qtdVezesPreco } = require('../utils/validate');
const arq = require('../utils/arquivos');
const planilha = require('../utils/planilha');

// Contratos, planilha de execução, execuções, custos por item, notas fiscais e evolução da obra.
const r = express.Router();
r.use(exigir('contratos.ver'));
const editar = exigir('contratos.editar');

const cent = (v) => paraCentavos(String(v ?? '0')) || 0;
const q4 = (v) => escalar(String(v ?? '0'), 4) ?? 0n;

const camposContrato = {
  numero: { tipo: 'texto', obrigatorio: true, max: 40 },
  cliente_id: { tipo: 'inteiro', obrigatorio: true },
  licitacao_id: { tipo: 'inteiro' },
  objeto: { tipo: 'texto', max: 5000 },
  data_assinatura: { tipo: 'data' },
  data_inicio: { tipo: 'data' },
  data_fim: { tipo: 'data' },
  valor_total: { tipo: 'decimal', padrao: '0.00' },
  status: { tipo: 'enum', valores: ['ATIVO', 'SUSPENSO', 'CONCLUIDO', 'RESCINDIDO'], padrao: 'ATIVO' },
};

const SELECT_CONTRATO = `
  SELECT c.*, p.nome AS cliente_nome,
         (SELECT COALESCE(SUM(i.valor_total), 0) FROM contrato_itens i WHERE i.contrato_id = c.id AND i.fase = 0) AS valor_planilha,
         (SELECT COALESCE(SUM(e.valor), 0) FROM execucoes e WHERE e.contrato_id = c.id) AS valor_executado
    FROM contratos c JOIN pessoas p ON p.id = c.cliente_id`;

async function contratoOu404(empresaId, id) {
  const [c] = await query(`${SELECT_CONTRATO} WHERE c.empresa_id = ? AND c.id = ?`, [empresaId, id]);
  if (!c) throw new ErroApp(404, 'Contrato não encontrado');
  return c;
}

// Carrega o contrato em toda rota /:id/... e garante que ele é da empresa selecionada.
r.param('id', (req, res, next, id) => {
  contratoOu404(req.empresaId, id).then((c) => { req.contrato = c; next(); }).catch(next);
});

// ---------- contratos ----------

r.get('/', ah(async (req, res) => {
  const where = ['c.empresa_id = ?'];
  const params = [req.empresaId];
  const f = validar(req.query, { status: camposContrato.status }, { parcial: true });
  if (f.status) { where.push('c.status = ?'); params.push(f.status); }
  if (typeof req.query.q === 'string' && req.query.q) {
    where.push('(c.numero LIKE ? OR c.objeto LIKE ? OR p.nome LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  const { pagina, porPagina, offset } = paginacao(req.query);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM contratos c JOIN pessoas p ON p.id = c.cliente_id WHERE ${where.join(' AND ')}`, params);
  const dados = await query(`${SELECT_CONTRATO} WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...params, porPagina, offset]);
  res.json({ dados, pagina, por_pagina: porPagina, total });
}));

r.get('/:id', (req, res) => res.json(req.contrato));

// Cria o contrato e, junto, o centro de custo da obra. Se veio de uma licitação, marca-a como CONTRATADA.
r.post('/', editar, ah(async (req, res) => {
  const d = validar(req.body, camposContrato);
  const id = await transacao(async (conn) => {
    const [cc] = await conn.query("INSERT INTO centros_custo (empresa_id, codigo, nome, tipo) VALUES (?, ?, ?, 'OBRA')", [
      req.empresaId, `CT-${d.numero}`.slice(0, 20), `Contrato ${d.numero}`.slice(0, 120),
    ]);
    const [c] = await conn.query('INSERT INTO contratos SET ?', [{ ...d, empresa_id: req.empresaId, centro_custo_id: cc.insertId }]);
    if (d.licitacao_id) {
      await conn.query("UPDATE licitacoes SET status = 'CONTRATADA' WHERE empresa_id = ? AND id = ?", [req.empresaId, d.licitacao_id]);
    }
    return c.insertId;
  });
  res.status(201).json(await contratoOu404(req.empresaId, id));
}));

r.put('/:id', editar, ah(async (req, res) => {
  const d = validar(req.body, camposContrato, { parcial: true });
  if (!Object.keys(d).length) throw new ErroApp(400, 'Nenhum campo para alterar');
  await query('UPDATE contratos SET ? WHERE empresa_id = ? AND id = ?', [d, req.empresaId, req.contrato.id]);
  res.json(await contratoOu404(req.empresaId, req.contrato.id));
}));

// ---------- evolução da obra ----------
// Para cada item e fase: previsto, executado (físico), faturado (notas) e custo (contas a pagar vinculadas).
// As fases somam os filhos. Devolve também a curva mensal acumulada.
r.get('/:id/evolucao', ah(async (req, res) => {
  const e = req.empresaId;
  const c = req.contrato.id;
  const itens = await query(
    `SELECT i.*,
            COALESCE(x.qtd, 0) AS executado_qtd, COALESCE(x.valor, 0) AS exec_valor,
            COALESCE(f.valor, 0) AS fat_valor, COALESCE(k.valor, 0) AS custo_valor
       FROM contrato_itens i
       LEFT JOIN (SELECT contrato_item_id, SUM(quantidade) AS qtd, SUM(valor) AS valor
                    FROM execucoes WHERE empresa_id = ? AND contrato_id = ? GROUP BY contrato_item_id) x ON x.contrato_item_id = i.id
       LEFT JOIN (SELECT ex.contrato_item_id, SUM(ni.valor) AS valor
                    FROM nota_fiscal_itens ni
                    JOIN notas_fiscais n ON n.id = ni.nota_id AND n.status = 'EMITIDA'
                    JOIN execucoes ex    ON ex.id = ni.execucao_id
                   WHERE n.empresa_id = ? AND n.contrato_id = ? GROUP BY ex.contrato_item_id) f ON f.contrato_item_id = i.id
       LEFT JOIN (SELECT contrato_item_id, SUM(valor) AS valor
                    FROM item_custos WHERE empresa_id = ? AND contrato_id = ? GROUP BY contrato_item_id) k ON k.contrato_item_id = i.id
      WHERE i.empresa_id = ? AND i.contrato_id = ?
      ORDER BY i.ordem, i.id`,
    [e, c, e, c, e, c, e, c]
  );

  const porId = new Map();
  for (const i of itens) {
    porId.set(i.id, i);
    i.filhos = [];
    i.t = { previsto: i.fase ? 0 : cent(i.valor_total), executado: cent(i.exec_valor), faturado: cent(i.fat_valor), custo: cent(i.custo_valor) };
  }
  const raizes = [];
  for (const i of itens) {
    const pai = i.parent_id && porId.get(i.parent_id);
    (pai ? pai.filhos : raizes).push(i);
  }
  const somar = (no, nivel) => {
    no.nivel = nivel;
    for (const f of no.filhos) {
      somar(f, nivel + 1);
      for (const k of Object.keys(no.t)) no.t[k] += f.t[k];
    }
  };
  raizes.forEach((n) => somar(n, 0));

  const pct = (parte, todo) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : 0);
  const total = { previsto: 0, executado: 0, faturado: 0, custo: 0 };
  for (const n of raizes) for (const k of Object.keys(total)) total[k] += n.t[k];

  const saida = itens.map((i) => ({
    id: i.id, parent_id: i.parent_id, nivel: i.nivel, fase: i.fase, codigo: i.codigo, descricao: i.descricao,
    unidade: i.unidade, quantidade: i.quantidade, preco_unitario: i.preco_unitario,
    executado_qtd: i.fase ? null : desescalar(q4(i.executado_qtd), 4),
    valor_previsto: deCentavos(i.t.previsto),
    valor_executado: deCentavos(i.t.executado),
    valor_faturado: deCentavos(i.t.faturado),
    custo: deCentavos(i.t.custo),
    percentual: pct(i.t.executado, i.t.previsto),
  }));

  const meses = await query(
    `SELECT DATE_FORMAT(data, '%Y-%m') AS mes, SUM(valor) AS valor
       FROM execucoes WHERE empresa_id = ? AND contrato_id = ? GROUP BY mes ORDER BY mes`,
    [e, c]
  );
  let acumulado = 0;
  const curva = meses.map((m) => {
    acumulado += cent(m.valor);
    return { mes: m.mes, valor: deCentavos(cent(m.valor)), acumulado: deCentavos(acumulado), percentual: pct(acumulado, total.previsto) };
  });

  res.json({
    contrato: req.contrato,
    totais: {
      valor_previsto: deCentavos(total.previsto),
      valor_executado: deCentavos(total.executado),
      valor_faturado: deCentavos(total.faturado),
      custo: deCentavos(total.custo),
      a_faturar: deCentavos(total.executado - total.faturado),
      resultado: deCentavos(total.executado - total.custo),
      percentual_fisico: pct(total.executado, total.previsto),
      percentual_faturado: pct(total.faturado, total.previsto),
    },
    itens: saida,
    curva,
  });
}));

// ---------- itens da planilha (inclusão manual e ajustes) ----------

const camposItem = {
  codigo: { tipo: 'texto', obrigatorio: true, max: 30 },
  descricao: { tipo: 'texto', obrigatorio: true, max: 500 },
  unidade: { tipo: 'texto', max: 15 },
  quantidade: { tipo: 'decimal', casas: 4 },
  preco_unitario: { tipo: 'decimal', casas: 4 },
};
const CODIGO_OK = /^\d+(\.\d+)*$/;
const codigoPai = (codigo) => (codigo.includes('.') ? codigo.split('.').slice(0, -1).join('.') : null);

// Sem quantidade e preço, a linha é uma fase. O pai é encontrado pelo código (1.2.3 -> 1.2).
r.post('/:id/itens', editar, ah(async (req, res) => {
  const d = validar(req.body, camposItem);
  if (!CODIGO_OK.test(d.codigo)) throw new ErroApp(422, 'Código deve ser numérico, como 1, 1.2 ou 1.2.3');
  const fase = !(d.quantidade && d.preco_unitario && q4(d.quantidade) > 0n);
  const c = req.contrato.id;

  const id = await transacao(async (conn) => {
    let parentId = null;
    const pai = codigoPai(d.codigo);
    if (pai) {
      const [[p]] = await conn.query('SELECT id, fase FROM contrato_itens WHERE empresa_id = ? AND contrato_id = ? AND codigo = ?', [req.empresaId, c, pai]);
      if (p && !p.fase) throw new ErroApp(422, `O item ${pai} tem quantidade; só uma fase pode ter subitens`);
      parentId = p ? p.id : null;
    }
    const [[{ ordem }]] = await conn.query('SELECT COALESCE(MAX(ordem), 0) + 1 AS ordem FROM contrato_itens WHERE contrato_id = ?', [c]);
    const [ins] = await conn.query('INSERT INTO contrato_itens SET ?', [{
      empresa_id: req.empresaId, contrato_id: c, parent_id: parentId, ordem,
      codigo: d.codigo, descricao: d.descricao,
      unidade: fase ? null : d.unidade || null,
      quantidade: fase ? null : d.quantidade,
      preco_unitario: fase ? null : d.preco_unitario,
      valor_total: fase ? '0.00' : deCentavos(qtdVezesPreco(d.quantidade, d.preco_unitario)),
      fase: fase ? 1 : 0,
    }]);
    return ins.insertId;
  });
  res.status(201).json({ id });
}));

// Altera descrição, unidade, quantidade ou preço (aditivo). A quantidade não pode ficar abaixo do já executado.
r.put('/:id/itens/:itemId', editar, ah(async (req, res) => {
  const { codigo: _c, ...editaveis } = camposItem;
  const d = validar(req.body, editaveis, { parcial: true });
  if (!Object.keys(d).length) throw new ErroApp(400, 'Nenhum campo para alterar');

  await transacao(async (conn) => {
    const [[item]] = await conn.query('SELECT * FROM contrato_itens WHERE empresa_id = ? AND contrato_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.contrato.id, req.params.itemId]);
    if (!item) throw new ErroApp(404, 'Item não encontrado');
    const novo = { ...d };
    if (item.fase) {
      delete novo.quantidade; delete novo.preco_unitario; delete novo.unidade;
    } else if (d.quantidade !== undefined || d.preco_unitario !== undefined) {
      const qtd = d.quantidade ?? item.quantidade;
      const preco = d.preco_unitario ?? item.preco_unitario;
      if (!qtd || !preco || q4(qtd) <= 0n) throw new ErroApp(422, 'Quantidade e preço são obrigatórios em um item');
      const [[{ feito }]] = await conn.query('SELECT COALESCE(SUM(quantidade), 0) AS feito FROM execucoes WHERE contrato_item_id = ?', [item.id]);
      if (q4(qtd) < q4(feito)) throw new ErroApp(422, `Quantidade menor que o já executado (${feito})`);
      novo.valor_total = deCentavos(qtdVezesPreco(qtd, preco));
    }
    if (!Object.keys(novo).length) throw new ErroApp(400, 'Uma fase só permite alterar a descrição');
    if (novo.descricao === null) throw new ErroApp(422, 'Descrição é obrigatória');
    await conn.query('UPDATE contrato_itens SET ? WHERE id = ?', [novo, item.id]);
  });
  res.json({ id: Number(req.params.itemId) });
}));

// Exclui o item (e os subitens). O banco recusa se houver execução ou custo vinculado.
r.delete('/:id/itens/:itemId', editar, ah(async (req, res) => {
  const resultado = await query('DELETE FROM contrato_itens WHERE empresa_id = ? AND contrato_id = ? AND id = ?', [req.empresaId, req.contrato.id, req.params.itemId]);
  if (!resultado.affectedRows) throw new ErroApp(404, 'Item não encontrado');
  res.status(204).end();
}));

// ---------- importação da planilha de execução (.xlsx) ----------
// multipart: arquivo, e opcionalmente previa=1, mapeamento (JSON), linha_cabecalho, substituir=1.
// Com previa=1 nada é gravado: devolve as primeiras linhas, as colunas detectadas e o que seria importado.
r.post('/:id/planilha', editar, arq.receber, ah(async (req, res) => {
  arq.validarArquivo(req.file, ['xlsx']);
  const linhas = await planilha.lerPlanilha(req.file.buffer);
  const detectado = planilha.detectar(linhas);

  let mapeamento = detectado.mapeamento;
  if (req.body.mapeamento) {
    try { mapeamento = JSON.parse(req.body.mapeamento); } catch { throw new ErroApp(422, 'Mapeamento de colunas inválido'); }
  }
  const linhaCabecalho = Number(req.body.linha_cabecalho) || detectado.linhaCabecalho;
  if (!Number.isInteger(linhaCabecalho) || linhaCabecalho < 1 || linhaCabecalho > linhas.length) throw new ErroApp(422, 'Linha de cabeçalho inválida');

  if (req.body.previa === '1') {
    let resultado = null;
    let erro = null;
    try {
      resultado = planilha.montarItens(linhas, linhaCabecalho, planilha.validarMapeamento(mapeamento));
    } catch (e2) {
      if (!(e2 instanceof ErroApp)) throw e2;
      erro = e2.message;
    }
    return res.json({
      linha_cabecalho: linhaCabecalho,
      mapeamento,
      cabecalho: (linhas[linhaCabecalho - 1] || []).map((c) => String(c ?? '')),
      amostra: linhas.slice(0, Math.min(linhas.length, linhaCabecalho + 15)).map((l) => l.map((c) => String(c ?? ''))),
      erro,
      itens_encontrados: resultado ? resultado.itens.length : 0,
      fases: resultado ? resultado.itens.filter((i) => i.fase).length : 0,
      linhas_ignoradas: resultado ? resultado.ignoradas : 0,
      avisos: resultado ? resultado.avisos : [],
      valor_total: resultado ? deCentavos(resultado.itens.reduce((s, i) => s + (i.fase ? 0 : cent(i.valor_total)), 0)) : '0.00',
    });
  }

  const { itens, avisos, ignoradas } = planilha.montarItens(linhas, linhaCabecalho, planilha.validarMapeamento(mapeamento));
  const c = req.contrato.id;

  await transacao(async (conn) => {
    const [[{ existentes }]] = await conn.query('SELECT COUNT(*) AS existentes FROM contrato_itens WHERE contrato_id = ?', [c]);
    if (existentes) {
      if (req.body.substituir !== '1') throw new ErroApp(409, 'O contrato já tem planilha. Marque "substituir" para importar de novo.');
      const [[{ usados }]] = await conn.query(
        `SELECT (SELECT COUNT(*) FROM execucoes WHERE contrato_id = ?) + (SELECT COUNT(*) FROM item_custos WHERE contrato_id = ?) AS usados`,
        [c, c]
      );
      if (usados) throw new ErroApp(409, 'Já existem execuções ou custos lançados; a planilha não pode mais ser substituída. Ajuste os itens um a um.');
      await conn.query('DELETE FROM contrato_itens WHERE contrato_id = ? ORDER BY id DESC', [c]);
    }

    const ids = {};
    let ordem = 0;
    for (const item of itens) {
      const pai = codigoPai(item.codigo);
      ordem += 1;
      const [ins] = await conn.query('INSERT INTO contrato_itens SET ?', [{
        empresa_id: req.empresaId, contrato_id: c, parent_id: (pai && ids[pai]) || null, ordem,
        codigo: item.codigo, descricao: item.descricao, unidade: item.unidade,
        quantidade: item.quantidade, preco_unitario: item.preco_unitario,
        valor_total: item.valor_total || '0.00', fase: item.fase,
      }]);
      if (item.fase) ids[item.codigo] = ins.insertId; // só fase pode ser pai
    }
    // Guarda o arquivo original como anexo do contrato.
    const info = arq.validarArquivo(req.file, ['xlsx']);
    const { caminho, sha256 } = await arq.salvar(req.empresaId, req.file.buffer);
    await conn.query('INSERT INTO arquivos SET ?', [{
      empresa_id: req.empresaId, entidade: 'CONTRATO', entidade_id: c, nome_original: info.nome,
      caminho, mime: info.mime, tamanho: req.file.size, sha256, criado_por: req.usuario.id,
    }]);
  });

  res.status(201).json({ itens_importados: itens.length, linhas_ignoradas: ignoradas, avisos });
}));

// ---------- execuções ----------

// GET /:id/execucoes?item_id=&pendentes=1   (pendentes = ainda com saldo a faturar)
r.get('/:id/execucoes', ah(async (req, res) => {
  const where = ['e.empresa_id = ?', 'e.contrato_id = ?'];
  const params = [req.empresaId, req.empresaId, req.contrato.id];
  if (req.query.item_id) { where.push('e.contrato_item_id = ?'); params.push(Number(req.query.item_id)); }
  if (req.query.pendentes === '1') where.push('COALESCE(f.qtd, 0) < e.quantidade');
  res.json(await query(
    `SELECT e.*, i.codigo, i.descricao, i.unidade, i.preco_unitario, u.nome AS criado_por_nome,
            COALESCE(f.qtd, 0) AS faturado_qtd, COALESCE(f.valor, 0) AS faturado_valor
       FROM execucoes e
       JOIN contrato_itens i ON i.id = e.contrato_item_id
       LEFT JOIN usuarios u ON u.id = e.criado_por
       LEFT JOIN (SELECT ni.execucao_id, SUM(ni.quantidade) AS qtd, SUM(ni.valor) AS valor
                    FROM nota_fiscal_itens ni JOIN notas_fiscais n ON n.id = ni.nota_id AND n.status = 'EMITIDA'
                   WHERE ni.empresa_id = ? GROUP BY ni.execucao_id) f ON f.execucao_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY e.data, e.id`,
    params
  ));
}));

// POST /:id/execucoes  { contrato_item_id, data, quantidade, observacao }
// Marca o que foi executado de um item (pode ser parcial). Não deixa passar da quantidade contratada.
r.post('/:id/execucoes', exigir('execucao.lancar'), ah(async (req, res) => {
  const d = validar(req.body, {
    contrato_item_id: { tipo: 'inteiro', obrigatorio: true },
    data: { tipo: 'data', obrigatorio: true },
    quantidade: { tipo: 'decimal', casas: 4, obrigatorio: true, positivo: true },
    observacao: { tipo: 'texto', max: 300 },
  });

  const id = await transacao(async (conn) => {
    // FOR UPDATE: dois lançamentos simultâneos do mesmo item não ultrapassam o saldo.
    const [[item]] = await conn.query(
      'SELECT * FROM contrato_itens WHERE empresa_id = ? AND contrato_id = ? AND id = ? FOR UPDATE',
      [req.empresaId, req.contrato.id, d.contrato_item_id]
    );
    if (!item) throw new ErroApp(404, 'Item não encontrado neste contrato');
    if (item.fase) throw new ErroApp(422, 'Escolha um item da fase; a fase em si não tem quantidade');

    const [[feito]] = await conn.query('SELECT COALESCE(SUM(quantidade), 0) AS qtd, COALESCE(SUM(valor), 0) AS valor FROM execucoes WHERE contrato_item_id = ?', [item.id]);
    const antes = q4(feito.qtd);
    const depois = antes + q4(d.quantidade);
    const contratado = q4(item.quantidade);
    if (depois > contratado) {
      throw new ErroApp(422, `Quantidade maior que o saldo do item (${desescalar(contratado - antes, 4)} ${item.unidade || ''})`.trim());
    }
    // O valor é a diferença entre o acumulado depois e antes: a soma das parciais sempre
    // fecha, centavo por centavo, com o valor total do item.
    let valor = depois === contratado
      ? cent(item.valor_total) - cent(feito.valor)
      : qtdVezesPreco(desescalar(depois, 4), item.preco_unitario) - qtdVezesPreco(desescalar(antes, 4), item.preco_unitario);
    if (valor < 0) valor = 0;

    const [ins] = await conn.query('INSERT INTO execucoes SET ?', [{
      empresa_id: req.empresaId, contrato_id: req.contrato.id, contrato_item_id: item.id,
      data: d.data, quantidade: d.quantidade, valor: deCentavos(valor),
      observacao: d.observacao || null, criado_por: req.usuario.id,
    }]);
    return ins.insertId;
  });
  res.status(201).json({ id });
}));

// Só é possível excluir execução que não entrou em nota fiscal (o banco recusa as demais).
r.delete('/:id/execucoes/:execId', exigir('execucao.lancar'), ah(async (req, res) => {
  const resultado = await query('DELETE FROM execucoes WHERE empresa_id = ? AND contrato_id = ? AND id = ?', [req.empresaId, req.contrato.id, req.params.execId]);
  if (!resultado.affectedRows) throw new ErroApp(404, 'Execução não encontrada');
  res.status(204).end();
}));

// ---------- custos: contas a pagar vinculadas a um item ou fase ----------

r.get('/:id/custos', ah(async (req, res) => {
  const where = ['k.empresa_id = ?', 'k.contrato_id = ?'];
  const params = [req.empresaId, req.contrato.id];
  if (req.query.item_id) { where.push('k.contrato_item_id = ?'); params.push(Number(req.query.item_id)); }
  res.json(await query(
    `SELECT k.id, k.contrato_item_id, k.lancamento_id, k.valor, i.codigo, i.descricao AS item_descricao,
            l.descricao, l.documento, l.data_vencimento, l.valor AS lancamento_valor, l.status, p.nome AS pessoa_nome
       FROM item_custos k
       JOIN contrato_itens i ON i.id = k.contrato_item_id
       JOIN lancamentos l    ON l.id = k.lancamento_id
       JOIN pessoas p        ON p.id = l.pessoa_id
      WHERE ${where.join(' AND ')} ORDER BY i.ordem, l.data_vencimento`,
    params
  ));
}));

// Contas a pagar que ainda têm valor não apropriado a nenhum item (?q= busca por texto).
r.get('/:id/custos/disponiveis', ah(async (req, res) => {
  const params = [req.empresaId, req.empresaId];
  let busca = '';
  if (typeof req.query.q === 'string' && req.query.q) {
    busca = 'AND (l.descricao LIKE ? OR l.documento LIKE ? OR p.nome LIKE ?)';
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  res.json(await query(
    `SELECT l.id, l.descricao, l.documento, l.data_vencimento, l.valor, p.nome AS pessoa_nome,
            (l.valor - COALESCE(a.usado, 0)) AS disponivel
       FROM lancamentos l
       JOIN pessoas p ON p.id = l.pessoa_id
       LEFT JOIN (SELECT lancamento_id, SUM(valor) AS usado FROM item_custos WHERE empresa_id = ? GROUP BY lancamento_id) a ON a.lancamento_id = l.id
      WHERE l.empresa_id = ? AND l.tipo = 'PAGAR' AND l.status <> 'CANCELADO'
        AND l.valor - COALESCE(a.usado, 0) > 0 ${busca}
      ORDER BY l.data_vencimento DESC LIMIT 200`,
    params
  ));
}));

// POST /:id/custos  { contrato_item_id, lancamento_id, valor? }
// Sem "valor", apropria tudo o que ainda está livre naquela conta a pagar.
r.post('/:id/custos', editar, ah(async (req, res) => {
  const d = validar(req.body, {
    contrato_item_id: { tipo: 'inteiro', obrigatorio: true },
    lancamento_id: { tipo: 'inteiro', obrigatorio: true },
    valor: { tipo: 'decimal', positivo: true },
  });
  const id = await transacao(async (conn) => {
    const [[item]] = await conn.query('SELECT id FROM contrato_itens WHERE empresa_id = ? AND contrato_id = ? AND id = ?', [req.empresaId, req.contrato.id, d.contrato_item_id]);
    if (!item) throw new ErroApp(404, 'Item não encontrado neste contrato');
    const [[l]] = await conn.query('SELECT id, tipo, status, valor FROM lancamentos WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, d.lancamento_id]);
    if (!l) throw new ErroApp(404, 'Conta a pagar não encontrada');
    if (l.tipo !== 'PAGAR') throw new ErroApp(422, 'Só contas a pagar podem ser vinculadas como custo');
    if (l.status === 'CANCELADO') throw new ErroApp(422, 'Conta a pagar cancelada');

    const [[{ usado }]] = await conn.query('SELECT COALESCE(SUM(valor), 0) AS usado FROM item_custos WHERE empresa_id = ? AND lancamento_id = ?', [req.empresaId, l.id]);
    const livre = cent(l.valor) - cent(usado);
    const valor = d.valor ? cent(d.valor) : livre;
    if (valor <= 0 || valor > livre) throw new ErroApp(422, `Valor maior que o disponível nesta conta (${deCentavos(livre)})`);

    const [ins] = await conn.query('INSERT INTO item_custos SET ?', [{
      empresa_id: req.empresaId, contrato_id: req.contrato.id, contrato_item_id: item.id,
      lancamento_id: l.id, valor: deCentavos(valor), criado_por: req.usuario.id,
    }]);
    return ins.insertId;
  });
  res.status(201).json({ id });
}));

r.delete('/:id/custos/:custoId', editar, ah(async (req, res) => {
  const resultado = await query('DELETE FROM item_custos WHERE empresa_id = ? AND contrato_id = ? AND id = ?', [req.empresaId, req.contrato.id, req.params.custoId]);
  if (!resultado.affectedRows) throw new ErroApp(404, 'Vínculo não encontrado');
  res.status(204).end();
}));

// ---------- notas fiscais ----------

r.get('/:id/notas', ah(async (req, res) => {
  res.json(await query(
    `SELECT n.*, l.status AS recebimento_status, l.data_vencimento,
            (SELECT COUNT(*) FROM nota_fiscal_itens ni WHERE ni.nota_id = n.id) AS itens
       FROM notas_fiscais n LEFT JOIN lancamentos l ON l.id = n.lancamento_id
      WHERE n.empresa_id = ? AND n.contrato_id = ? ORDER BY n.data_emissao DESC, n.id DESC`,
    [req.empresaId, req.contrato.id]
  ));
}));

r.get('/:id/notas/:notaId', ah(async (req, res) => {
  const [nota] = await query('SELECT * FROM notas_fiscais WHERE empresa_id = ? AND contrato_id = ? AND id = ?', [req.empresaId, req.contrato.id, req.params.notaId]);
  if (!nota) throw new ErroApp(404, 'Nota não encontrada');
  nota.itens = await query(
    `SELECT ni.quantidade, ni.valor, e.data AS data_execucao, i.codigo, i.descricao, i.unidade
       FROM nota_fiscal_itens ni JOIN execucoes e ON e.id = ni.execucao_id JOIN contrato_itens i ON i.id = e.contrato_item_id
      WHERE ni.nota_id = ? ORDER BY i.ordem`,
    [nota.id]
  );
  res.json(nota);
}));

// POST /:id/notas
// { numero, serie, data_emissao, data_vencimento, iss, inss, irrf, outras_retencoes, categoria_id?, observacao,
//   itens: [{ execucao_id, quantidade? }] }
// Registra a nota emitida fora do sistema com os itens executados que ela cobre e gera a conta a receber
// pelo valor líquido. Não deixa faturar mais do que foi executado.
r.post('/:id/notas', exigir('notas.editar'), ah(async (req, res) => {
  const d = validar(req.body, {
    numero: { tipo: 'texto', obrigatorio: true, max: 20 },
    serie: { tipo: 'texto', max: 5 },
    data_emissao: { tipo: 'data', obrigatorio: true },
    data_vencimento: { tipo: 'data', obrigatorio: true },
    iss: { tipo: 'decimal', padrao: '0.00' },
    inss: { tipo: 'decimal', padrao: '0.00' },
    irrf: { tipo: 'decimal', padrao: '0.00' },
    outras_retencoes: { tipo: 'decimal', padrao: '0.00' },
    categoria_id: { tipo: 'inteiro' },
    observacao: { tipo: 'texto', max: 300 },
  });
  if (!Array.isArray(req.body.itens) || !req.body.itens.length || req.body.itens.length > 500) {
    throw new ErroApp(422, 'Selecione ao menos um item executado para a nota');
  }
  const pedidos = req.body.itens.map((it) => validar(it, {
    execucao_id: { tipo: 'inteiro', obrigatorio: true },
    quantidade: { tipo: 'decimal', casas: 4, positivo: true },
  }));
  if (new Set(pedidos.map((p) => p.execucao_id)).size !== pedidos.length) throw new ErroApp(422, 'Execução repetida na nota');
  const contrato = req.contrato;

  const id = await transacao(async (conn) => {
    const linhasNota = [];
    let bruto = 0;
    for (const p of pedidos) {
      const [[ex]] = await conn.query(
        `SELECT e.id, e.quantidade, e.valor, i.preco_unitario, i.codigo
           FROM execucoes e JOIN contrato_itens i ON i.id = e.contrato_item_id
          WHERE e.empresa_id = ? AND e.contrato_id = ? AND e.id = ? FOR UPDATE`,
        [req.empresaId, contrato.id, p.execucao_id]
      );
      if (!ex) throw new ErroApp(404, `Execução ${p.execucao_id} não encontrada neste contrato`);
      const [[fat]] = await conn.query(
        `SELECT COALESCE(SUM(ni.quantidade), 0) AS qtd, COALESCE(SUM(ni.valor), 0) AS valor
           FROM nota_fiscal_itens ni JOIN notas_fiscais n ON n.id = ni.nota_id AND n.status = 'EMITIDA'
          WHERE ni.execucao_id = ?`,
        [ex.id]
      );
      const restante = q4(ex.quantidade) - q4(fat.qtd);
      const qtd = p.quantidade ? q4(p.quantidade) : restante;
      if (qtd <= 0n || qtd > restante) {
        throw new ErroApp(422, `Item ${ex.codigo}: quantidade maior que o saldo a faturar (${desescalar(restante, 4)})`);
      }
      const valor = qtd === restante ? cent(ex.valor) - cent(fat.valor) : qtdVezesPreco(desescalar(qtd, 4), ex.preco_unitario);
      bruto += valor;
      linhasNota.push({ execucao_id: ex.id, quantidade: desescalar(qtd, 4), valor: deCentavos(valor) });
    }

    const retencoes = cent(d.iss) + cent(d.inss) + cent(d.irrf) + cent(d.outras_retencoes);
    const liquido = bruto - retencoes;
    if (liquido <= 0) throw new ErroApp(422, 'As retenções não podem ser iguais ou maiores que o valor da nota');

    // Categoria da receita: a informada ou "Medições de obras" (1.1) do plano padrão.
    const [[cat]] = d.categoria_id
      ? await conn.query("SELECT id FROM categorias WHERE empresa_id = ? AND id = ? AND tipo = 'RECEITA'", [req.empresaId, d.categoria_id])
      : await conn.query("SELECT id FROM categorias WHERE empresa_id = ? AND tipo = 'RECEITA' AND ativo = 1 ORDER BY (codigo = '1.1') DESC, codigo LIMIT 1", [req.empresaId]);
    if (!cat) throw new ErroApp(422, 'Informe uma categoria de receita para a conta a receber');

    const [lanc] = await conn.query('INSERT INTO lancamentos SET ?', [{
      empresa_id: req.empresaId, tipo: 'RECEBER', pessoa_id: contrato.cliente_id, categoria_id: cat.id,
      centro_custo_id: contrato.centro_custo_id,
      descricao: `NF ${d.numero} - Contrato ${contrato.numero}`.slice(0, 200), documento: `NF ${d.numero}`.slice(0, 40),
      data_emissao: d.data_emissao, data_competencia: d.data_emissao, data_vencimento: d.data_vencimento,
      valor: deCentavos(liquido), criado_por: req.usuario.id,
    }]);
    const [nota] = await conn.query('INSERT INTO notas_fiscais SET ?', [{
      empresa_id: req.empresaId, contrato_id: contrato.id, numero: d.numero, serie: d.serie || '',
      data_emissao: d.data_emissao, valor_bruto: deCentavos(bruto),
      iss: d.iss || '0.00', inss: d.inss || '0.00', irrf: d.irrf || '0.00', outras_retencoes: d.outras_retencoes || '0.00',
      valor_liquido: deCentavos(liquido), lancamento_id: lanc.insertId,
      observacao: d.observacao || null, criado_por: req.usuario.id,
    }]);
    for (const l of linhasNota) {
      await conn.query('INSERT INTO nota_fiscal_itens SET ?', [{ ...l, empresa_id: req.empresaId, nota_id: nota.insertId }]);
    }
    return nota.insertId;
  });
  res.status(201).json({ id });
}));

// Cancela a nota e a conta a receber dela. Se já houve recebimento, é preciso estornar antes.
// Os itens voltam a ficar disponíveis para outra nota.
r.post('/:id/notas/:notaId/cancelar', exigir('notas.editar'), ah(async (req, res) => {
  await transacao(async (conn) => {
    const [[nota]] = await conn.query('SELECT * FROM notas_fiscais WHERE empresa_id = ? AND contrato_id = ? AND id = ? FOR UPDATE', [req.empresaId, req.contrato.id, req.params.notaId]);
    if (!nota) throw new ErroApp(404, 'Nota não encontrada');
    if (nota.status === 'CANCELADA') throw new ErroApp(409, 'Nota já cancelada');
    if (nota.lancamento_id) {
      const [upd] = await conn.query("UPDATE lancamentos SET status = 'CANCELADO' WHERE id = ? AND status = 'ABERTO'", [nota.lancamento_id]);
      if (!upd.affectedRows) throw new ErroApp(409, 'A conta a receber desta nota já tem recebimento; estorne-o antes de cancelar a nota');
    }
    await conn.query("UPDATE notas_fiscais SET status = 'CANCELADA' WHERE id = ?", [nota.id]);
  });
  res.status(204).end();
}));

module.exports = r;
