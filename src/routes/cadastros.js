const crud = require('../utils/crud');

// Cadastros simples: todos seguem o mesmo padrão (GET, GET/:id, POST, PUT/:id, DELETE/:id).
const perm = { ver: 'cadastros.ver', editar: 'cadastros.editar' };

const pessoas = crud({
  ...perm,
  tabela: 'pessoas',
  ordem: 't.nome',
  busca: ['nome', 'documento'],
  campos: {
    tipo: { tipo: 'enum', valores: ['CLIENTE', 'FORNECEDOR', 'AMBOS'], obrigatorio: true },
    nome: { tipo: 'texto', obrigatorio: true, max: 150 },
    documento: { tipo: 'texto', somenteDigitos: true, max: 14 },
    email: { tipo: 'texto', max: 160 },
    telefone: { tipo: 'texto', max: 30 },
    cidade: { tipo: 'texto', max: 80 },
    uf: { tipo: 'texto', max: 2 },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

const categorias = crud({
  ...perm,
  tabela: 'categorias',
  ordem: 't.codigo',
  busca: ['codigo', 'nome'],
  campos: {
    parent_id: { tipo: 'inteiro' },
    codigo: { tipo: 'texto', obrigatorio: true, max: 20 },
    nome: { tipo: 'texto', obrigatorio: true, max: 120 },
    tipo: { tipo: 'enum', valores: ['RECEITA', 'DESPESA'], obrigatorio: true },
    grupo_dre: {
      tipo: 'enum',
      valores: ['RECEITA_BRUTA', 'DEDUCOES', 'CUSTO_DIRETO', 'DESPESA_OPERACIONAL', 'RESULTADO_FINANCEIRO'],
      obrigatorio: true,
    },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

const centrosCusto = crud({
  ...perm,
  tabela: 'centros_custo',
  ordem: 't.codigo',
  busca: ['codigo', 'nome'],
  campos: {
    codigo: { tipo: 'texto', obrigatorio: true, max: 20 },
    nome: { tipo: 'texto', obrigatorio: true, max: 120 },
    tipo: { tipo: 'enum', valores: ['OBRA', 'ADMINISTRATIVO', 'EQUIPAMENTO'], padrao: 'OBRA' },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

const contasBancarias = crud({
  ...perm,
  tabela: 'contas_bancarias',
  ordem: 't.nome',
  busca: ['nome', 'banco'],
  campos: {
    nome: { tipo: 'texto', obrigatorio: true, max: 80 },
    banco: { tipo: 'texto', max: 60 },
    agencia: { tipo: 'texto', max: 10 },
    conta: { tipo: 'texto', max: 20 },
    saldo_inicial: { tipo: 'decimal', permiteNegativo: true, padrao: '0.00' },
    ativo: { tipo: 'bool', padrao: 1 },
  },
});

module.exports = { pessoas, categorias, centrosCusto, contasBancarias };
