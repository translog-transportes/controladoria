// Lista única de permissões do sistema. Cada rota da API exige uma delas,
// e cada empresa monta seus perfis escolhendo itens desta lista.
const PERMISSOES = {
  'cadastros.ver': 'Cadastros: consultar',
  'cadastros.editar': 'Cadastros: incluir e alterar',
  'financeiro.ver': 'Financeiro: consultar contas a pagar e a receber',
  'financeiro.editar': 'Financeiro: incluir, alterar e cancelar contas',
  'financeiro.baixar': 'Financeiro: registrar e estornar pagamentos e recebimentos',
  'relatorios.ver': 'Relatórios financeiros: fluxo de caixa, saldos e DRE',
  'licitacoes.ver': 'Licitações e documentos: consultar',
  'licitacoes.editar': 'Licitações e documentos: incluir e alterar',
  'contratos.ver': 'Contratos e obras: consultar planilha, evolução e notas',
  'contratos.editar': 'Contratos: incluir, importar planilha e vincular custos',
  'execucao.lancar': 'Obras: marcar itens executados',
  'notas.editar': 'Notas fiscais: registrar e cancelar',
  'frota.ver': 'Frota: consultar equipamentos, consumo e manutenções',
  'frota.editar': 'Frota: cadastrar equipamentos, planos e manutenções',
  'abastecimentos.lancar': 'Frota: lançar abastecimentos e apontar o uso diário dos equipamentos',
  'locacoes.ver': 'Locação de equipamentos: consultar locações e contratos',
  'locacoes.editar': 'Locação de equipamentos: reservar, confirmar, concluir e cancelar',
  'usuarios.gerenciar': 'Administração: usuários e perfis',
  'empresa.gerenciar': 'Administração: dados da empresa',
  'auditoria.ver': 'Administração: consultar a auditoria',
};

const todas = Object.keys(PERMISSOES);
const consulta = todas.filter((p) => p.endsWith('.ver') && p !== 'auditoria.ver');

// Perfis criados junto com cada empresa. O Administrador é fixo; os demais podem ser editados.
const PERFIS_PADRAO = [
  { nome: 'Administrador', sistema: 1, permissoes: ['*'] },
  { nome: 'Financeiro', permissoes: ['cadastros.ver', 'cadastros.editar', 'financeiro.ver', 'financeiro.editar', 'financeiro.baixar', 'relatorios.ver', 'contratos.ver', 'notas.editar', 'frota.ver', 'locacoes.ver', 'locacoes.editar'] },
  { nome: 'Licitações', permissoes: ['cadastros.ver', 'cadastros.editar', 'licitacoes.ver', 'licitacoes.editar', 'contratos.ver'] },
  { nome: 'Engenharia', permissoes: ['cadastros.ver', 'licitacoes.ver', 'contratos.ver', 'contratos.editar', 'execucao.lancar', 'financeiro.ver', 'frota.ver'] },
  { nome: 'Operador de frota', permissoes: ['cadastros.ver', 'frota.ver', 'abastecimentos.lancar'] },
  { nome: 'Consulta', permissoes: consulta },
];

function permissoesValidas(lista) {
  return Array.isArray(lista) && lista.every((p) => typeof p === 'string' && Object.hasOwn(PERMISSOES, p));
}

module.exports = { PERMISSOES, PERFIS_PADRAO, permissoesValidas };
