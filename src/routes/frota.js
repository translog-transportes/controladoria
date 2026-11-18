const express = require('express');
const crud = require('../utils/crud');
const { query, transacao } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { exigir } = require('../middleware/auth');
const { validar, paginacao, dataValida, paraCentavos, deCentavos } = require('../utils/validate');
const { calcularConsumo } = require('../utils/consumo');
const { resumirEquipamento } = require('../utils/ociosidade');

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const perm = { ver: 'frota.ver', editar: 'frota.editar' };

// ---------- /api/equipamentos ----------
const equipamentos = crud({
  ...perm,
  tabela: 'equipamentos',
  ordem: 't.nome',
  busca: ['nome', 'placa', 'modelo'],
  juncao: { select: ', cc.nome AS centro_custo_nome', join: 'LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id' },
  campos: {
    tipo: { tipo: 'enum', valores: ['VEICULO', 'MAQUINA'], obrigatorio: true },
    nome: { tipo: 'texto', obrigatorio: true, max: 100 },
    placa: { tipo: 'texto', max: 10 },
    marca: { tipo: 'texto', max: 60 },
    modelo: { tipo: 'texto', max: 60 },
    ano: { tipo: 'inteiro', min: 1950, max: 2100 },
    combustivel: { tipo: 'enum', valores: ['DIESEL', 'DIESEL_S10', 'GASOLINA', 'ETANOL', 'FLEX', 'GNV'], padrao: 'DIESEL' },
    leitura_atual: { tipo: 'decimal', casas: 1, padrao: '0.0' },
    centro_custo_id: { tipo: 'inteiro' },
    receita_dia: { tipo: 'decimal' },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

// ---------- /api/planos-manutencao ----------
const planos = crud({
  ...perm,
  tabela: 'planos_manutencao',
  ordem: 'eq.nome, t.descricao',
  busca: ['descricao'],
  juncao: { select: ', eq.nome AS equipamento_nome, eq.tipo AS equipamento_tipo', join: 'JOIN equipamentos eq ON eq.id = t.equipamento_id' },
  campos: {
    equipamento_id: { tipo: 'inteiro', obrigatorio: true },
    descricao: { tipo: 'texto', obrigatorio: true, max: 120 },
    intervalo_leitura: { tipo: 'decimal', casas: 1 },
    intervalo_dias: { tipo: 'inteiro' },
    ultima_leitura: { tipo: 'decimal', casas: 1 },
    ultima_data: { tipo: 'data' },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

// ---------- /api/manutencoes ----------
// Ao registrar uma manutenção ligada a um plano, o plano passa a contar a partir dela.
const manutencoes = crud({
  ...perm,
  tabela: 'manutencoes',
  ordem: 't.data DESC, t.id DESC',
  busca: ['descricao', 'oficina'],
  campoData: 'data',
  juncao: { select: ', eq.nome AS equipamento_nome', join: 'JOIN equipamentos eq ON eq.id = t.equipamento_id' },
  campos: {
    equipamento_id: { tipo: 'inteiro', obrigatorio: true },
    plano_id: { tipo: 'inteiro' },
    tipo: { tipo: 'enum', valores: ['PREVENTIVA', 'CORRETIVA'], obrigatorio: true },
    descricao: { tipo: 'texto', obrigatorio: true, max: 200 },
    data: { tipo: 'data', obrigatorio: true },
    leitura: { tipo: 'decimal', casas: 1 },
    valor: { tipo: 'decimal', padrao: '0.00' },
    oficina: { tipo: 'texto', max: 100 },
    observacao: { tipo: 'texto', max: 300 },
  },
  aposCriar: async (req, m) => {
    if (m.plano_id) {
      await query(
        'UPDATE planos_manutencao SET ultima_data = ?, ultima_leitura = COALESCE(?, ultima_leitura) WHERE empresa_id = ? AND id = ? AND equipamento_id = ?',
        [m.data, m.leitura, req.empresaId, m.plano_id, m.equipamento_id]
      );
    }
    if (m.leitura !== null) {
      await query('UPDATE equipamentos SET leitura_atual = GREATEST(leitura_atual, ?) WHERE empresa_id = ? AND id = ?', [m.leitura, req.empresaId, m.equipamento_id]);
    }
  },
});

// ---------- /api/abastecimentos ----------
const abastecimentos = express.Router();

abastecimentos.get('/', exigir('frota.ver'), ah(async (req, res) => {
  const where = ['a.empresa_id = ?'];
  const params = [req.empresaId];
  if (req.query.equipamento_id) { where.push('a.equipamento_id = ?'); params.push(Number(req.query.equipamento_id)); }
  if (dataValida(req.query.de)) { where.push('a.data >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('a.data <= ?'); params.push(req.query.ate); }
  if (req.query.sem_conta === '1') where.push('a.lancamento_id IS NULL');
  const { pagina, porPagina, offset } = paginacao(req.query);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM abastecimentos a WHERE ${where.join(' AND ')}`, params);
  const dados = await query(
    `SELECT a.*, eq.nome AS equipamento_nome, eq.tipo AS equipamento_tipo, cc.nome AS centro_custo_nome,
            l.documento AS conta_documento, l.descricao AS conta_descricao, l.status AS conta_status
       FROM abastecimentos a
       JOIN equipamentos eq ON eq.id = a.equipamento_id
       LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id
       LEFT JOIN lancamentos l ON l.id = a.lancamento_id
      WHERE ${where.join(' AND ')} ORDER BY a.data DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, porPagina, offset]
  );
  res.json({ dados, pagina, por_pagina: porPagina, total });
}));

// POST /api/abastecimentos
// A leitura (km ou horas) precisa ser coerente com os abastecimentos vizinhos:
// maior que a do abastecimento anterior e menor que a do seguinte.
abastecimentos.post('/', exigir('abastecimentos.lancar', 'frota.editar'), ah(async (req, res) => {
  const d = validar(req.body, {
    equipamento_id: { tipo: 'inteiro', obrigatorio: true },
    data: { tipo: 'data', obrigatorio: true },
    leitura: { tipo: 'decimal', casas: 1, obrigatorio: true },
    litros: { tipo: 'decimal', casas: 3, obrigatorio: true, positivo: true },
    valor_total: { tipo: 'decimal', obrigatorio: true },
    tanque_cheio: { tipo: 'bool', padrao: 1 },
    posto: { tipo: 'texto', max: 100 },
    operador: { tipo: 'texto', max: 100 },
    centro_custo_id: { tipo: 'inteiro' },
    observacao: { tipo: 'texto', max: 300 },
  });

  const id = await transacao(async (conn) => {
    const [[eq]] = await conn.query('SELECT id, tipo FROM equipamentos WHERE empresa_id = ? AND id = ? FOR UPDATE', [req.empresaId, d.equipamento_id]);
    if (!eq) throw new ErroApp(404, 'Equipamento não encontrado');
    const un = eq.tipo === 'VEICULO' ? 'km' : 'h';

    const [[antes]] = await conn.query('SELECT MAX(leitura) AS leitura FROM abastecimentos WHERE empresa_id = ? AND equipamento_id = ? AND data < ?', [req.empresaId, eq.id, d.data]);
    const [[depois]] = await conn.query('SELECT MIN(leitura) AS leitura FROM abastecimentos WHERE empresa_id = ? AND equipamento_id = ? AND data > ?', [req.empresaId, eq.id, d.data]);
    const leitura = Number(d.leitura);
    if (antes.leitura !== null && leitura <= Number(antes.leitura)) {
      throw new ErroApp(422, `Leitura deve ser maior que a do abastecimento anterior (${antes.leitura} ${un})`);
    }
    if (depois.leitura !== null && leitura >= Number(depois.leitura)) {
      throw new ErroApp(422, `Leitura deve ser menor que a do abastecimento seguinte (${depois.leitura} ${un})`);
    }

    const [ins] = await conn.query('INSERT INTO abastecimentos SET ?', [{ ...d, empresa_id: req.empresaId, criado_por: req.usuario.id }]);
    await conn.query('UPDATE equipamentos SET leitura_atual = GREATEST(leitura_atual, ?) WHERE id = ?', [d.leitura, eq.id]);
    return ins.insertId;
  });
  res.status(201).json({ id });
}));

abastecimentos.delete('/:id', exigir('frota.editar'), ah(async (req, res) => {
  const [ab] = await query('SELECT lancamento_id FROM abastecimentos WHERE empresa_id = ? AND id = ?', [req.empresaId, req.params.id]);
  if (!ab) throw new ErroApp(404, 'Abastecimento não encontrado');
  if (ab.lancamento_id) throw new ErroApp(409, 'Abastecimento já está em uma conta a pagar; desvincule-o na conta antes de excluir');
  await query('DELETE FROM abastecimentos WHERE empresa_id = ? AND id = ? AND lancamento_id IS NULL', [req.empresaId, req.params.id]);
  res.status(204).end();
}));

// ---------- /api/frota (relatórios) ----------
const frota = express.Router();
frota.use(exigir('frota.ver'));

// GET /api/frota/consumo?de=&ate=&equipamento_id=
// Média de consumo (km/L ou L/h) e custo por km ou por hora de cada equipamento no período.
frota.get('/consumo', ah(async (req, res) => {
  const where = ['a.empresa_id = ?'];
  const params = [req.empresaId];
  if (req.query.equipamento_id) { where.push('a.equipamento_id = ?'); params.push(Number(req.query.equipamento_id)); }
  if (dataValida(req.query.de)) { where.push('a.data >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('a.data <= ?'); params.push(req.query.ate); }

  const linhas = await query(
    `SELECT a.equipamento_id, a.leitura, a.litros, a.valor_total, a.tanque_cheio, eq.nome, eq.placa, eq.tipo
       FROM abastecimentos a JOIN equipamentos eq ON eq.id = a.equipamento_id
      WHERE ${where.join(' AND ')} ORDER BY eq.nome, a.leitura`,
    params
  );
  const grupos = new Map();
  for (const l of linhas) {
    if (!grupos.has(l.equipamento_id)) grupos.set(l.equipamento_id, { equipamento_id: l.equipamento_id, nome: l.nome, placa: l.placa, tipo: l.tipo, itens: [] });
    grupos.get(l.equipamento_id).itens.push(l);
  }
  const detalhar = !!req.query.equipamento_id;
  res.json([...grupos.values()].map(({ itens, ...eq }) => {
    const { trechos, ...resumo } = calcularConsumo(eq.tipo, itens);
    return detalhar ? { ...eq, ...resumo, trechos } : { ...eq, ...resumo };
  }));
}));

// GET /api/frota/alertas
// Planos de manutenção vencidos ou perto de vencer (faltando 10% do intervalo ou 15 dias).
frota.get('/alertas', ah(async (req, res) => {
  const planosAtivos = await query(
    `SELECT pm.*, eq.nome AS equipamento_nome, eq.tipo, eq.leitura_atual,
            DATEDIFF(pm.ultima_data + INTERVAL pm.intervalo_dias DAY, CURDATE()) AS dias_restantes
       FROM planos_manutencao pm JOIN equipamentos eq ON eq.id = pm.equipamento_id AND eq.ativo = 1
      WHERE pm.empresa_id = ? AND pm.ativo = 1`,
    [req.empresaId]
  );
  const alertas = [];
  for (const p of planosAtivos) {
    const un = p.tipo === 'VEICULO' ? 'km' : 'h';
    let restante = null;
    if (p.intervalo_leitura !== null && p.ultima_leitura !== null) {
      restante = Number(p.ultima_leitura) + Number(p.intervalo_leitura) - Number(p.leitura_atual);
    }
    const porLeitura = restante !== null && restante <= Number(p.intervalo_leitura) * 0.1;
    const porData = p.dias_restantes !== null && p.dias_restantes <= 15;
    if (!porLeitura && !porData) continue;
    alertas.push({
      plano_id: p.id,
      equipamento_id: p.equipamento_id,
      equipamento_nome: p.equipamento_nome,
      descricao: p.descricao,
      vencido: (restante !== null && restante <= 0) || (p.dias_restantes !== null && p.dias_restantes <= 0),
      leitura_restante: restante === null ? null : Math.round(restante * 10) / 10,
      unidade: un,
      dias_restantes: p.dias_restantes,
    });
  }
  alertas.sort((a, b) => Number(b.vencido) - Number(a.vencido));
  res.json(alertas);
}));

// GET /api/frota/ociosidade?de=&ate=&sabado=1
// Por equipamento: dias locados, em obra própria, parados, em manutenção, utilização e receita perdida
// (dias parados x receita potencial por dia). Dias depois de hoje não contam.
frota.get('/ociosidade', ah(async (req, res) => {
  const hoje = hojeLocal();
  const de = dataValida(req.query.de) ? req.query.de : `${hoje.slice(0, 8)}01`;
  const ate = dataValida(req.query.ate) ? req.query.ate : hoje;
  if (ate < de) throw new ErroApp(422, 'Período inválido');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86400000) throw new ErroApp(422, 'Período máximo de 400 dias');
  const sabado = req.query.sabado === '1';

  const [equipamentos, locacoes, apontamentos] = await Promise.all([
    query('SELECT id, nome, placa, tipo, receita_dia FROM equipamentos WHERE empresa_id = ? AND ativo = 1 ORDER BY tipo DESC, nome', [req.empresaId]),
    query("SELECT equipamento_id, data_inicio, data_fim FROM locacoes WHERE empresa_id = ? AND status <> 'CANCELADA' AND data_inicio <= ? AND data_fim >= ?", [req.empresaId, ate, de]),
    query('SELECT equipamento_id, data, situacao FROM apontamentos WHERE empresa_id = ? AND data BETWEEN ? AND ?', [req.empresaId, de, ate]),
  ]);
  const linhas = equipamentos.map((eq) => ({
    equipamento_id: eq.id, nome: eq.nome, placa: eq.placa, tipo: eq.tipo, receita_dia: eq.receita_dia,
    ...resumirEquipamento(eq, locacoes.filter((l) => l.equipamento_id === eq.id), apontamentos.filter((a) => a.equipamento_id === eq.id), { de, ate, hoje, sabado }),
  }));
  const soma = (campo) => linhas.reduce((s, l) => s + (paraCentavos(String(l[campo] ?? '0')) || 0), 0);
  res.json({
    de, ate, hoje, sabado,
    totais: { perda_parado: deCentavos(soma('perda_parado')), perda_manutencao: deCentavos(soma('perda_manutencao')), sem_receita_dia: linhas.filter((l) => l.receita_dia === null).length },
    equipamentos: linhas,
  });
}));

module.exports = { equipamentos, planos, manutencoes, abastecimentos, frota };
