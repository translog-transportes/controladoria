const { PERFIS_PADRAO } = require('../permissoes');

// Plano de contas inicial de uma construtora. Criado junto com cada empresa
// e pode ser alterado depois em Cadastros > Plano de contas.
const PLANO = [
  ['1', 'Receitas', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.1', 'Medições de obras', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.2', 'Locação de equipamentos', 'RECEITA', 'RECEITA_BRUTA'],
  ['1.3', 'Outras receitas', 'RECEITA', 'RECEITA_BRUTA'],
  ['2', 'Impostos e retenções sobre faturamento', 'DESPESA', 'DEDUCOES'],
  ['2.1', 'ISS', 'DESPESA', 'DEDUCOES'],
  ['2.2', 'PIS/COFINS', 'DESPESA', 'DEDUCOES'],
  ['2.3', 'INSS retido', 'DESPESA', 'DEDUCOES'],
  ['3', 'Custos de obra', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.1', 'Materiais', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.2', 'Mão de obra própria', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.3', 'Subempreiteiros', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.4', 'Combustível', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.5', 'Manutenção de máquinas e veículos', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.6', 'Aluguel de equipamentos', 'DESPESA', 'CUSTO_DIRETO'],
  ['3.7', 'Fretes e transportes', 'DESPESA', 'CUSTO_DIRETO'],
  ['4', 'Despesas administrativas', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['4.1', 'Salários e encargos administrativos', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['4.2', 'Aluguel e condomínio', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['4.3', 'Contabilidade e serviços', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['4.4', 'Licitações (taxas, certidões, garantias)', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['4.5', 'Outras despesas', 'DESPESA', 'DESPESA_OPERACIONAL'],
  ['5', 'Resultado financeiro', 'DESPESA', 'RESULTADO_FINANCEIRO'],
  ['5.1', 'Juros e tarifas bancárias', 'DESPESA', 'RESULTADO_FINANCEIRO'],
  ['5.2', 'Rendimentos financeiros', 'RECEITA', 'RESULTADO_FINANCEIRO'],
];

// Cria perfis padrão, plano de contas e o centro de custo administrativo de uma empresa nova.
// conn: conexão de uma transação já aberta. Devolve o id do perfil Administrador.
async function criarDadosIniciais(conn, empresaId) {
  let perfilAdminId = null;
  for (const p of PERFIS_PADRAO) {
    const [r] = await conn.query(
      'INSERT INTO perfis (empresa_id, nome, permissoes, sistema) VALUES (?, ?, ?, ?)',
      [empresaId, p.nome, JSON.stringify(p.permissoes), p.sistema ? 1 : 0]
    );
    if (p.sistema) perfilAdminId = r.insertId;
  }

  const ids = {};
  for (const [codigo, nome, tipo, grupo] of PLANO) {
    const pai = codigo.includes('.') ? ids[codigo.split('.').slice(0, -1).join('.')] : null;
    const [r] = await conn.query(
      'INSERT INTO categorias (empresa_id, parent_id, codigo, nome, tipo, grupo_dre) VALUES (?, ?, ?, ?, ?, ?)',
      [empresaId, pai, codigo, nome, tipo, grupo]
    );
    ids[codigo] = r.insertId;
  }
  await conn.query(
    "INSERT INTO centros_custo (empresa_id, codigo, nome, tipo) VALUES (?, 'ADM', 'Administrativo', 'ADMINISTRATIVO')",
    [empresaId]
  );
  return perfilAdminId;
}

module.exports = { criarDadosIniciais };
