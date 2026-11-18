const express = require('express');
const { query } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { paraCentavos, deCentavos, dataValida } = require('../utils/validate');

const r = express.Router();
r.use(exigir('relatorios.ver'));
const cent = (v) => paraCentavos(String(v ?? '0')) || 0;

function periodo(q) {
  if (!dataValida(q.de) || !dataValida(q.ate)) throw new ErroApp(400, 'Informe de=AAAA-MM-DD e ate=AAAA-MM-DD');
  if (q.de > q.ate) throw new ErroApp(400, 'Período inválido: "de" é depois de "ate"');
  return { de: q.de, ate: q.ate };
}

// GET /api/relatorios/resumo
// Totais em aberto: vencido, vence hoje, próximos 7 dias.
r.get('/resumo', ah(async (req, res) => {
  const linhas = await query(
    `SELECT tipo,
            COALESCE(SUM(CASE WHEN data_vencimento < CURDATE() THEN valor - valor_baixado ELSE 0 END), 0) AS vencido,
            COALESCE(SUM(CASE WHEN data_vencimento = CURDATE() THEN valor - valor_baixado ELSE 0 END), 0) AS hoje,
            COALESCE(SUM(CASE WHEN data_vencimento > CURDATE()
                               AND data_vencimento <= CURDATE() + INTERVAL 7 DAY THEN valor - valor_baixado ELSE 0 END), 0) AS proximos_7_dias,
            COALESCE(SUM(valor - valor_baixado), 0) AS total_aberto
       FROM lancamentos
      WHERE empresa_id = ? AND status IN ('ABERTO','PARCIAL')
      GROUP BY tipo`,
    [req.empresaId]
  );
  const vazio = { vencido: '0.00', hoje: '0.00', proximos_7_dias: '0.00', total_aberto: '0.00' };
  const saida = { pagar: { ...vazio }, receber: { ...vazio } };
  for (const { tipo, ...valores } of linhas) saida[tipo.toLowerCase()] = valores;
  res.json(saida);
}));

// GET /api/relatorios/saldos
// Saldo de cada conta bancária = saldo inicial + recebimentos - pagamentos.
r.get('/saldos', ah(async (req, res) => {
  const contas = await query(
    `SELECT cb.id, cb.nome, cb.banco, cb.saldo_inicial,
            COALESCE(SUM(CASE WHEN l.tipo = 'RECEBER' THEN b.valor_movimento ELSE 0 END), 0) AS entradas,
            COALESCE(SUM(CASE WHEN l.tipo = 'PAGAR'   THEN b.valor_movimento ELSE 0 END), 0) AS saidas
       FROM contas_bancarias cb
       LEFT JOIN baixas b      ON b.conta_bancaria_id = cb.id AND b.empresa_id = cb.empresa_id
       LEFT JOIN lancamentos l ON l.id = b.lancamento_id
      WHERE cb.empresa_id = ? AND cb.ativo = 1
      GROUP BY cb.id, cb.nome, cb.banco, cb.saldo_inicial
      ORDER BY cb.nome`,
    [req.empresaId]
  );
  let total = 0;
  for (const c of contas) {
    const saldo = cent(c.saldo_inicial) + cent(c.entradas) - cent(c.saidas);
    c.saldo = deCentavos(saldo);
    total += saldo;
  }
  res.json({ contas, saldo_total: deCentavos(total) });
}));

// GET /api/relatorios/fluxo-caixa?de=&ate=&agrupar=dia|mes
// Realizado = baixas pela data da baixa. Previsto = saldo em aberto pela data de vencimento.
r.get('/fluxo-caixa', ah(async (req, res) => {
  const { de, ate } = periodo(req.query);
  const formato = req.query.agrupar === 'mes' ? '%Y-%m' : '%Y-%m-%d';

  const realizado = await query(
    `SELECT DATE_FORMAT(b.data_baixa, ?) AS periodo,
            SUM(CASE WHEN l.tipo = 'RECEBER' THEN b.valor_movimento ELSE 0 END) AS entradas,
            SUM(CASE WHEN l.tipo = 'PAGAR'   THEN b.valor_movimento ELSE 0 END) AS saidas
       FROM baixas b JOIN lancamentos l ON l.id = b.lancamento_id
      WHERE b.empresa_id = ? AND b.data_baixa BETWEEN ? AND ?
      GROUP BY periodo`,
    [formato, req.empresaId, de, ate]
  );
  const previsto = await query(
    `SELECT DATE_FORMAT(data_vencimento, ?) AS periodo,
            SUM(CASE WHEN tipo = 'RECEBER' THEN valor - valor_baixado ELSE 0 END) AS entradas,
            SUM(CASE WHEN tipo = 'PAGAR'   THEN valor - valor_baixado ELSE 0 END) AS saidas
       FROM lancamentos
      WHERE empresa_id = ? AND status IN ('ABERTO','PARCIAL') AND data_vencimento BETWEEN ? AND ?
      GROUP BY periodo`,
    [formato, req.empresaId, de, ate]
  );

  // Saldo no início do período: saldos iniciais das contas + tudo que foi baixado antes de "de".
  const [{ inicial }] = await query('SELECT COALESCE(SUM(saldo_inicial), 0) AS inicial FROM contas_bancarias WHERE empresa_id = ?', [req.empresaId]);
  const [{ anterior }] = await query(
    `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'RECEBER' THEN b.valor_movimento ELSE -b.valor_movimento END), 0) AS anterior
       FROM baixas b JOIN lancamentos l ON l.id = b.lancamento_id
      WHERE b.empresa_id = ? AND b.data_baixa < ?`,
    [req.empresaId, de]
  );
  const saldoInicial = cent(inicial) + cent(anterior);

  const mapa = new Map();
  const linha = (p) => {
    if (!mapa.has(p)) mapa.set(p, { periodo: p, entradas: 0, saidas: 0, entradas_previstas: 0, saidas_previstas: 0 });
    return mapa.get(p);
  };
  for (const x of realizado) { const l = linha(x.periodo); l.entradas = cent(x.entradas); l.saidas = cent(x.saidas); }
  for (const x of previsto) { const l = linha(x.periodo); l.entradas_previstas = cent(x.entradas); l.saidas_previstas = cent(x.saidas); }

  // saldo = só o realizado; saldo_projetado = realizado + previsto em aberto
  let saldo = saldoInicial;
  let projetado = saldoInicial;
  const periodos = [...mapa.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map((l) => {
    saldo += l.entradas - l.saidas;
    projetado += l.entradas - l.saidas + l.entradas_previstas - l.saidas_previstas;
    return {
      periodo: l.periodo,
      entradas: deCentavos(l.entradas),
      saidas: deCentavos(l.saidas),
      entradas_previstas: deCentavos(l.entradas_previstas),
      saidas_previstas: deCentavos(l.saidas_previstas),
      saldo: deCentavos(saldo),
      saldo_projetado: deCentavos(projetado),
    };
  });
  res.json({ de, ate, saldo_inicial: deCentavos(saldoInicial), periodos });
}));

// GET /api/relatorios/dre?de=&ate=&centro_custo_id=
// Por competência (não por pagamento). Com centro_custo_id, vira o resultado de uma obra.
r.get('/dre', ah(async (req, res) => {
  const { de, ate } = periodo(req.query);
  const params = [req.empresaId, de, ate];
  let filtroCC = '';
  if (req.query.centro_custo_id) {
    filtroCC = 'AND l.centro_custo_id = ?';
    params.push(Number(req.query.centro_custo_id));
  }
  const linhas = await query(
    `SELECT c.grupo_dre, c.codigo, c.nome, c.tipo, SUM(l.valor) AS valor
       FROM lancamentos l JOIN categorias c ON c.id = l.categoria_id
      WHERE l.empresa_id = ? AND l.status <> 'CANCELADO'
        AND l.data_competencia BETWEEN ? AND ? ${filtroCC}
      GROUP BY c.grupo_dre, c.codigo, c.nome, c.tipo
      ORDER BY c.codigo`,
    params
  );

  const grupos = {};
  for (const g of ['RECEITA_BRUTA', 'DEDUCOES', 'CUSTO_DIRETO', 'DESPESA_OPERACIONAL', 'RESULTADO_FINANCEIRO']) {
    grupos[g] = { total: 0, categorias: [] };
  }
  for (const l of linhas) {
    const v = cent(l.valor);
    grupos[l.grupo_dre].total += l.tipo === 'RECEITA' ? v : -v; // receita soma, despesa subtrai
    grupos[l.grupo_dre].categorias.push({ codigo: l.codigo, nome: l.nome, tipo: l.tipo, valor: deCentavos(v) });
  }

  const receitaBruta = grupos.RECEITA_BRUTA.total;
  const receitaLiquida = receitaBruta + grupos.DEDUCOES.total;
  const lucroBruto = receitaLiquida + grupos.CUSTO_DIRETO.total;
  const resultadoOperacional = lucroBruto + grupos.DESPESA_OPERACIONAL.total;
  const resultado = resultadoOperacional + grupos.RESULTADO_FINANCEIRO.total;

  for (const g of Object.values(grupos)) g.total = deCentavos(g.total);
  res.json({
    de, ate,
    centro_custo_id: req.query.centro_custo_id ? Number(req.query.centro_custo_id) : null,
    receita_bruta: deCentavos(receitaBruta),
    receita_liquida: deCentavos(receitaLiquida),
    lucro_bruto: deCentavos(lucroBruto),
    resultado_operacional: deCentavos(resultadoOperacional),
    resultado: deCentavos(resultado),
    grupos,
  });
}));

module.exports = r;
