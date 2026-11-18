// Testes das regras de cálculo (não precisam de banco). Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/utils/validate');
const { calcularConsumo } = require('../src/utils/consumo');
const planilha = require('../src/utils/planilha');
const { PERFIS_PADRAO, permissoesValidas } = require('../src/permissoes');

test('dinheiro em centavos, sem erro de ponto flutuante', () => {
  assert.strictEqual(v.paraCentavos('1234.56'), 123456);
  assert.strictEqual(v.paraCentavos(0.1 + 0.2), 30);
  assert.strictEqual(v.paraCentavos('1,5'), null);
  assert.strictEqual(v.deCentavos(5), '0.05');
  assert.strictEqual(v.deCentavos(-320), '-3.20');
});

test('quantidade x preço com 4 casas e arredondamento', () => {
  assert.strictEqual(v.qtdVezesPreco('100.0000', '12.3456'), 123456);
  assert.strictEqual(v.qtdVezesPreco('0.3333', '10.0000'), 333);
  assert.strictEqual(v.qtdVezesPreco('1.0000', '0.0050'), 1); // meio centavo sobe
  assert.strictEqual(v.qtdVezesPreco('123456789.1234', '9999.9999'), 123456787888832); // 1.234.567.878.888,32
  assert.strictEqual(v.desescalar(v.escalar('12.5', 4), 4), '12.5000');
  assert.strictEqual(v.escalar('1.23456', 4), null);
});

test('execuções parciais fecham com o total do item', () => {
  // 3 execuções de 1/3 de um item de 10 un a R$ 33,33 => total 333,30
  const preco = '33.3300';
  const marcos = ['0.0000', '3.3333', '6.6666', '10.0000'];
  let soma = 0;
  for (let i = 1; i < marcos.length; i++) soma += v.qtdVezesPreco(marcos[i], preco) - v.qtdVezesPreco(marcos[i - 1], preco);
  assert.strictEqual(soma, 33330);
});

test('parcelas mensais e datas', () => {
  assert.strictEqual(v.somarMeses('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(v.somarMeses('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(v.somarMeses('2026-12-10', 1), '2027-01-10');
  assert.ok(!v.dataValida('2026-02-30'));
});

test('validação: tipos, padrão e campos fora do esquema', () => {
  const esquema = {
    nome: { tipo: 'texto', obrigatorio: true, max: 5 },
    valor: { tipo: 'decimal', obrigatorio: true, positivo: true },
    status: { tipo: 'enum', valores: ['A', 'B'], padrao: 'A' },
    quando: { tipo: 'datahora' },
  };
  assert.deepStrictEqual(
    v.validar({ nome: ' ab ', valor: 10, status: '', quando: '2026-11-14T09:30', empresa_id: 99, super_admin: 1 }, esquema),
    { nome: 'ab', valor: '10.00', status: 'A', quando: '2026-11-14 09:30:00' }
  );
  assert.deepStrictEqual(v.validar({ status: null }, esquema, { parcial: true }), {});
  assert.throws(() => v.validar({ nome: 'abcdef', valor: 0 }, esquema), (e) => e.status === 422 && !!e.detalhes.nome && !!e.detalhes.valor);
  assert.throws(() => v.validar({ nome: 'a', valor: 1, quando: '2026-02-30T10:00' }, esquema), (e) => !!e.detalhes.quando);
});

test('senha forte', () => {
  assert.ok(v.senhaForte('obra2026x'));
  assert.ok(!v.senhaForte('curta1'));
  assert.ok(!v.senhaForte('somenteletras'));
  assert.ok(!v.senhaForte('1234567890'));
});

test('consumo de veículo em km/L pelo tanque cheio', () => {
  const r = calcularConsumo('VEICULO', [
    { leitura: '1000.0', litros: '40.000', valor_total: '240.00', tanque_cheio: 1 },
    { leitura: '1250.0', litros: '20.000', valor_total: '120.00', tanque_cheio: 0 }, // parcial
    { leitura: '1500.0', litros: '30.000', valor_total: '180.00', tanque_cheio: 1 },
  ]);
  assert.strictEqual(r.unidade, 'km/L');
  assert.strictEqual(r.percorrido, 500);
  assert.strictEqual(r.media, 10); // 500 km com 50 L (o 1º abastecimento não conta)
  assert.strictEqual(r.custo_por_unidade, 0.6);
  assert.strictEqual(r.estimado, false);
});

test('consumo de máquina em L/h', () => {
  const r = calcularConsumo('MAQUINA', [
    { leitura: '2000.0', litros: '100.000', valor_total: '600.00', tanque_cheio: 1 },
    { leitura: '2010.0', litros: '85.000', valor_total: '510.00', tanque_cheio: 1 },
    { leitura: '2020.0', litros: '95.000', valor_total: '570.00', tanque_cheio: 1 },
  ]);
  assert.strictEqual(r.unidade, 'L/h');
  assert.strictEqual(r.media, 9); // 180 L em 20 h
  assert.strictEqual(r.custo_por_unidade, 54);
  assert.strictEqual(r.trechos.length, 2);
});

test('consumo sem dois tanques cheios é marcado como estimado', () => {
  const r = calcularConsumo('VEICULO', [
    { leitura: '100.0', litros: '10.000', valor_total: '60.00', tanque_cheio: 0 },
    { leitura: '200.0', litros: '10.000', valor_total: '60.00', tanque_cheio: 0 },
  ]);
  assert.strictEqual(r.estimado, true);
  assert.strictEqual(r.media, 10);
  assert.strictEqual(calcularConsumo('VEICULO', []).media, null);
});

test('planilha: detecta o cabeçalho e monta fases e itens', () => {
  const linhas = [
    ['PREFEITURA MUNICIPAL', '', '', '', '', ''],
    ['PLANILHA ORÇAMENTÁRIA'],
    [],
    ['ITEM', 'DESCRIÇÃO DOS SERVIÇOS', 'UNID.', 'QUANT.', 'PREÇO UNIT.', 'PREÇO TOTAL'],
    [1, 'SERVIÇOS PRELIMINARES', '', '', '', 1500],
    [1.1, 'Placa de obra', 'm²', 6, '250,00', 1500],
    ['2', 'PAVIMENTAÇÃO', '', '', '', ''],
    ['2.1', 'Escavação mecânica', 'm³', '1.200,50', 12.5, ''],
    ['', 'TOTAL GERAL', '', '', '', 16506.25],
  ];
  const d = planilha.detectar(linhas);
  assert.strictEqual(d.linhaCabecalho, 4);
  assert.deepStrictEqual(d.mapeamento, { codigo: 0, descricao: 1, unidade: 2, quantidade: 3, preco_unitario: 4, valor_total: 5 });

  const r = planilha.montarItens(linhas, d.linhaCabecalho, planilha.validarMapeamento(d.mapeamento));
  assert.strictEqual(r.itens.length, 4);
  assert.strictEqual(r.ignoradas, 1);
  assert.deepStrictEqual(r.itens.map((i) => [i.codigo, i.fase]), [['1', 1], ['1.1', 0], ['2', 1], ['2.1', 0]]);
  assert.strictEqual(r.itens[1].valor_total, '1500.00');
  assert.strictEqual(r.itens[3].quantidade, '1200.5000');
  assert.strictEqual(r.itens[3].valor_total, '15006.25'); // sem total na planilha: quantidade x preço
});

test('planilha: código 1.10 que o Excel transformou em 1.1', () => {
  const linhas = [['Item', 'Descrição', 'Un', 'Qtd', 'Unitário'], [1.1, 'A', 'un', 1, 1], [1.2, 'B', 'un', 1, 1], [1.1, 'C', 'un', 1, 1]];
  const r = planilha.montarItens(linhas, 1, { codigo: 0, descricao: 1, unidade: 2, quantidade: 3, preco_unitario: 4 });
  assert.deepStrictEqual(r.itens.map((i) => i.codigo), ['1.1', '1.2', '1.10']);
  assert.strictEqual(r.avisos.length, 1);
});

const loc = require('../src/utils/locacao');
const ocio = require('../src/utils/ociosidade');
const { montarContrato } = require('../src/utils/contratoLocacao');

test('locação: dias corridos e composição do total (caução fora do total)', () => {
  assert.strictEqual(loc.diasCorridos('2026-11-10', '2026-11-10'), 1);
  assert.strictEqual(loc.diasCorridos('2026-02-25', '2026-03-03'), 7);
  const t = loc.calcularTotal({
    dias_cobrados: 5, valor_diaria: '1200.00', com_operador: 1, valor_operador_dia: '350.00',
    valor_deslocamento: '800.00', combustivel: 'COBRADO', valor_combustivel: '640.50', caucao: '5000.00', desconto: '300.00',
  });
  assert.deepStrictEqual([t.diarias, t.operador, t.deslocamento, t.combustivel, t.total], ['6000.00', '1750.00', '800.00', '640.50', '8890.50']);
  // sem operador e com combustível por conta do locatário, esses valores não entram
  const s = loc.calcularTotal({ dias_cobrados: 2, valor_diaria: '100.00', com_operador: 0, valor_operador_dia: '999.00', combustivel: 'LOCATARIO', valor_combustivel: '999.00' });
  assert.strictEqual(s.total, '200.00');
});

test('locação: horas excedentes pela franquia de horas por dia', () => {
  const l = { dias_cobrados: 5, franquia_horas_dia: '8.0', valor_hora_excedente: '150.00' };
  assert.deepStrictEqual(loc.calcularExcedente(l, '1000.0', '1046.5'), { horas: '6.5', valor: '975.00' }); // 46,5 h usadas, franquia 40 h
  assert.deepStrictEqual(loc.calcularExcedente(l, '1000.0', '1030.0'), { horas: '0.0', valor: '0.00' });
  assert.deepStrictEqual(loc.calcularExcedente({ dias_cobrados: 5, franquia_horas_dia: null }, '0', '100'), { horas: null, valor: null });
});

test('ociosidade: locação > apontamento > dia útil sem apontamento conta como parado', () => {
  // novembro/2026: dia 2 é segunda-feira
  const r = ocio.resumirEquipamento(
    { receita_dia: '1500.00' },
    [{ data_inicio: '2026-11-02', data_fim: '2026-11-04' }], // seg a qua locado
    [
      { data: '2026-11-03', situacao: 'TRABALHANDO' }, // ignorado: a locação manda
      { data: '2026-11-05', situacao: 'TRABALHANDO' }, // qui em obra própria
      { data: '2026-11-06', situacao: 'MANUTENCAO' }, // sex em manutenção
      { data: '2026-11-07', situacao: 'TRABALHANDO' }, // sábado trabalhado conta
      { data: '2026-11-10', situacao: 'FOLGA' }, // feriado não conta
      { data: '2026-11-11', situacao: 'PARADO' },
    ],
    { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-12', sabado: false }
  );
  assert.strictEqual(r.dias_locados, 3);
  assert.strictEqual(r.dias_obra, 2);
  assert.strictEqual(r.dias_manutencao, 1);
  assert.strictEqual(r.dias_folga, 1);
  assert.strictEqual(r.dias_sem_apontamento, 2); // seg 9 e qui 12
  assert.strictEqual(r.dias_parados, 3); // os 2 sem apontamento + o PARADO do dia 11
  assert.strictEqual(r.perda_parado, '4500.00');
  assert.strictEqual(r.perda_manutencao, '1500.00');
  assert.strictEqual(r.utilizacao, 55.6); // 5 usados de 9 considerados
  assert.strictEqual(ocio.resumirEquipamento({ receita_dia: null }, [], [], { de: '2026-11-02', ate: '2026-11-02', hoje: '2026-11-30' }).perda_parado, null);
});

test('contrato de locação: partes, valores e cláusulas conforme as opções', () => {
  const m = montarContrato({
    numero: 7, data_inicio: '2026-11-20', data_fim: '2026-11-24', dias_cobrados: 5, valor_diaria: '1000.00',
    com_operador: 0, valor_operador_dia: '0', valor_deslocamento: '500.00', combustivel: 'LOCATARIO', valor_combustivel: '0',
    caucao: '0', desconto: '0', franquia_horas_dia: null, valor_hora_excedente: null, endereco: 'Rua A, 10', cidade: 'Curitiba', uf: 'PR',
    cliente_nome: 'João da Silva', cliente_documento: '12345678909', equipamento_nome: 'Retroescavadeira', equipamento_tipo: 'MAQUINA',
    equipamento_placa: 'RET-03', observacao: null, data_vencimento: '2026-11-30',
  }, { razao_social: 'Construtora X Ltda', cnpj: '00000000000191' }, '2026-11-16');
  assert.strictEqual(m.numero, 'Nº 0007/2026');
  assert.match(m.partes[1].texto, /CPF 123\.456\.789-09/);
  assert.strictEqual(m.valores.linhas.length, 2); // diárias + deslocamento
  assert.match(m.valores.total, /5\.500,00/);
  assert.ok(!m.clausulas.some((c) => c.titulo.includes('CAUÇÃO')));
  assert.match(m.localData, /16 de novembro de 2026/);
});

test('perfis padrão só usam permissões existentes e só o Administrador tem acesso total', () => {
  for (const p of PERFIS_PADRAO) {
    if (p.sistema) assert.deepStrictEqual(p.permissoes, ['*']);
    else assert.ok(permissoesValidas(p.permissoes), p.nome);
  }
  assert.ok(!permissoesValidas(['*'])); // ninguém consegue criar um perfil com acesso total
});
