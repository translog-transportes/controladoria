import { pode } from './api.js';
import { h, fmt, tag, modal, anexos } from './ui.js';
import { telaRecurso } from './recurso.js';

// Telas de cadastro que seguem o padrão lista + formulário.

const simNao = (v) => (Number(v) ? tag('Ativo', 'ok') : tag('Inativo'));
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map((u) => [u, u]);

export const pessoas = telaRecurso({
  titulo: 'Clientes e fornecedores', singular: 'cadastro', rota: '/api/pessoas', editar: 'cadastros.editar',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: ['CLIENTE', 'FORNECEDOR', 'AMBOS'] }],
  colunas: [
    { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'Tipo', valor: (l) => fmt.rotulo(l.tipo) },
    { rotulo: 'CPF/CNPJ', campo: 'documento' }, { rotulo: 'Telefone', campo: 'telefone' },
    { rotulo: 'Cidade', valor: (l) => [l.cidade, l.uf].filter(Boolean).join('/') }, { rotulo: 'Situação', valor: (l) => simNao(l.ativo) },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Nome / Razão social', obrigatorio: true, largo: true, max: 150 },
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: ['CLIENTE', 'FORNECEDOR', 'AMBOS'], obrigatorio: true, padrao: 'FORNECEDOR' },
    { nome: 'documento', rotulo: 'CPF ou CNPJ', max: 18 },
    { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 160 }, { nome: 'telefone', rotulo: 'Telefone', max: 30 },
    { nome: 'cidade', rotulo: 'Cidade', max: 80 }, { nome: 'uf', rotulo: 'UF', tipo: 'select', opcoes: UFS },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: 1 },
  ],
});

const GRUPOS_DRE = [['RECEITA_BRUTA', 'Receita bruta'], ['DEDUCOES', 'Deduções e impostos'], ['CUSTO_DIRETO', 'Custo direto de obra'], ['DESPESA_OPERACIONAL', 'Despesa administrativa'], ['RESULTADO_FINANCEIRO', 'Resultado financeiro']];
export const categorias = telaRecurso({
  titulo: 'Plano de contas', singular: 'categoria', rota: '/api/categorias', editar: 'cadastros.editar',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: ['RECEITA', 'DESPESA'] }],
  classeLinha: (l) => (l.parent_id ? null : 'fase'),
  colunas: [
    { rotulo: 'Código', campo: 'codigo' }, { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'Tipo', valor: (l) => fmt.rotulo(l.tipo) },
    { rotulo: 'Grupo no DRE', valor: (l) => (GRUPOS_DRE.find((g) => g[0] === l.grupo_dre) || [])[1] }, { rotulo: 'Situação', valor: (l) => simNao(l.ativo) },
  ],
  campos: [
    { nome: 'codigo', rotulo: 'Código', obrigatorio: true, max: 20 }, { nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 120 },
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: ['RECEITA', 'DESPESA'], obrigatorio: true },
    { nome: 'grupo_dre', rotulo: 'Grupo no DRE', tipo: 'select', opcoes: GRUPOS_DRE, obrigatorio: true },
    { nome: 'parent_id', rotulo: 'Categoria pai', tipo: 'remoto', rota: '/api/categorias', texto: (c) => `${c.codigo} ${c.nome}`, filtro: (c) => !c.parent_id },
    { nome: 'ativo', rotulo: 'Ativa', tipo: 'bool', padrao: 1 },
  ],
});

export const centrosCusto = telaRecurso({
  titulo: 'Centros de custo', singular: 'centro de custo', rota: '/api/centros-custo', editar: 'cadastros.editar',
  ajuda: 'Cada contrato cria o seu centro de custo (obra) automaticamente.',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: ['OBRA', 'ADMINISTRATIVO', 'EQUIPAMENTO'] }],
  colunas: [{ rotulo: 'Código', campo: 'codigo' }, { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'Tipo', valor: (l) => fmt.rotulo(l.tipo) }, { rotulo: 'Situação', valor: (l) => simNao(l.ativo) }],
  campos: [
    { nome: 'codigo', rotulo: 'Código', obrigatorio: true, max: 20 }, { nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 120 },
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: ['OBRA', 'ADMINISTRATIVO', 'EQUIPAMENTO'], obrigatorio: true, padrao: 'OBRA' },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: 1 },
  ],
});

export const contasBancarias = telaRecurso({
  titulo: 'Contas bancárias', singular: 'conta', rota: '/api/contas-bancarias', editar: 'cadastros.editar',
  colunas: [
    { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'Banco', campo: 'banco' }, { rotulo: 'Agência', campo: 'agencia' }, { rotulo: 'Conta', campo: 'conta' },
    { rotulo: 'Saldo inicial', classe: 'num', valor: (l) => fmt.dinheiro(l.saldo_inicial) }, { rotulo: 'Situação', valor: (l) => simNao(l.ativo) },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 80 }, { nome: 'banco', rotulo: 'Banco', max: 60 },
    { nome: 'agencia', rotulo: 'Agência', max: 10 }, { nome: 'conta', rotulo: 'Conta', max: 20 },
    { nome: 'saldo_inicial', rotulo: 'Saldo inicial', tipo: 'dinheiro', padrao: '0.00' }, { nome: 'ativo', rotulo: 'Ativa', tipo: 'bool', padrao: 1 },
  ],
});

// ---------- licitações ----------
const MODALIDADES = [['PREGAO_ELETRONICO', 'Pregão eletrônico'], ['PREGAO_PRESENCIAL', 'Pregão presencial'], ['CONCORRENCIA', 'Concorrência'], ['DISPENSA', 'Dispensa'], ['INEXIGIBILIDADE', 'Inexigibilidade'], ['OUTRA', 'Outra']];
const STATUS_LIC = [['PROSPECCAO', 'Prospecção'], ['ANALISE', 'Análise do edital'], ['PROPOSTA', 'Proposta'], ['DISPUTA', 'Disputa'], ['HABILITACAO', 'Habilitação'], ['HOMOLOGADA', 'Homologada'], ['CONTRATADA', 'Contratada'], ['PERDIDA', 'Perdida'], ['DESISTENCIA', 'Desistência']];
const corStatusLic = { HOMOLOGADA: 'ok', CONTRATADA: 'ok', PERDIDA: 'erro', DESISTENCIA: '', DISPUTA: 'alerta', HABILITACAO: 'alerta' };
const de = (lista, v) => (lista.find((x) => x[0] === v) || [v, v])[1];

const botaoAnexos = (entidade, permissao) => (l) => h('button', { class: 'mini', onclick: () => modal('Anexos', anexos(entidade, l.id, pode(permissao)), { largo: true }) }, 'Anexos');

export const licitacoes = telaRecurso({
  titulo: 'Licitações', singular: 'licitação', rota: '/api/licitacoes', editar: 'licitacoes.editar', textoNovo: '+ Nova licitação',
  filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: STATUS_LIC }, { nome: 'modalidade', rotulo: 'Modalidade', opcoes: MODALIDADES }],
  acoes: botaoAnexos('LICITACAO', 'licitacoes.editar'),
  colunas: [
    { rotulo: 'Abertura', valor: (l) => fmt.dataHora(l.data_abertura) }, { rotulo: 'Processo', campo: 'numero_processo' },
    { rotulo: 'Órgão', campo: 'orgao_nome' }, { rotulo: 'Objeto', valor: (l) => (l.objeto.length > 90 ? `${l.objeto.slice(0, 90)}…` : l.objeto) },
    { rotulo: 'Modalidade', valor: (l) => de(MODALIDADES, l.modalidade) },
    { rotulo: 'Estimado', classe: 'num', valor: (l) => fmt.dinheiro(l.valor_estimado) }, { rotulo: 'Proposta', classe: 'num', valor: (l) => fmt.dinheiro(l.valor_proposta) },
    { rotulo: 'Situação', valor: (l) => tag(de(STATUS_LIC, l.status), corStatusLic[l.status] || 'info') },
  ],
  campos: [
    { nome: 'numero_processo', rotulo: 'Nº do processo / edital', obrigatorio: true, max: 60 },
    { nome: 'modalidade', rotulo: 'Modalidade', tipo: 'select', opcoes: MODALIDADES, obrigatorio: true, padrao: 'PREGAO_ELETRONICO' },
    { nome: 'orgao_id', rotulo: 'Órgão licitante', tipo: 'remoto', rota: '/api/pessoas?ativo=1' },
    { nome: 'status', rotulo: 'Situação', tipo: 'select', opcoes: STATUS_LIC, obrigatorio: true, padrao: 'PROSPECCAO' },
    { nome: 'objeto', rotulo: 'Objeto', tipo: 'textarea', obrigatorio: true },
    { nome: 'data_abertura', rotulo: 'Data e hora da abertura', tipo: 'datahora' }, { nome: 'portal', rotulo: 'Portal', max: 120 },
    { nome: 'valor_estimado', rotulo: 'Valor estimado', tipo: 'dinheiro' }, { nome: 'valor_proposta', rotulo: 'Valor da proposta', tipo: 'dinheiro' },
    { nome: 'link', rotulo: 'Link do edital', largo: true, max: 500 }, { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' },
  ],
});

export function validade(l) {
  if (l.dias_para_vencer === null || l.dias_para_vencer === undefined) return tag('Sem validade');
  if (l.dias_para_vencer < 0) return tag(`Vencido há ${-l.dias_para_vencer} dia(s)`, 'erro');
  if (l.dias_para_vencer <= 30) return tag(`Vence em ${l.dias_para_vencer} dia(s)`, 'alerta');
  return tag('Em dia', 'ok');
}
const TIPOS_DOC = [['FISCAL', 'Regularidade fiscal'], ['TRABALHISTA', 'Trabalhista'], ['JURIDICA', 'Habilitação jurídica'], ['TECNICA', 'Qualificação técnica'], ['ECONOMICA', 'Econômico-financeira'], ['OUTRO', 'Outro']];
export const documentos = telaRecurso({
  titulo: 'Documentos de habilitação', singular: 'documento', rota: '/api/documentos', editar: 'licitacoes.editar',
  ajuda: 'Certidões e documentos usados nas licitações. O painel avisa o que vence nos próximos 30 dias.',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: TIPOS_DOC }],
  acoes: botaoAnexos('DOCUMENTO', 'licitacoes.editar'),
  colunas: [
    { rotulo: 'Documento', campo: 'nome' }, { rotulo: 'Tipo', valor: (l) => de(TIPOS_DOC, l.tipo) }, { rotulo: 'Número', campo: 'numero' },
    { rotulo: 'Emissão', valor: (l) => fmt.data(l.data_emissao) }, { rotulo: 'Validade', valor: (l) => fmt.data(l.data_validade) }, { rotulo: 'Situação', valor: validade },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Documento', obrigatorio: true, largo: true, max: 120 },
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_DOC, obrigatorio: true, padrao: 'FISCAL' }, { nome: 'numero', rotulo: 'Número', max: 60 },
    { nome: 'data_emissao', rotulo: 'Emissão', tipo: 'data' }, { nome: 'data_validade', rotulo: 'Validade', tipo: 'data' },
    { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' },
  ],
});

// ---------- frota ----------
const COMBUSTIVEIS = [['DIESEL', 'Diesel'], ['DIESEL_S10', 'Diesel S10'], ['GASOLINA', 'Gasolina'], ['ETANOL', 'Etanol'], ['FLEX', 'Flex'], ['GNV', 'GNV']];
const TIPOS_EQ = [['VEICULO', 'Veículo (km)'], ['MAQUINA', 'Máquina (horas)']];
export const un = (tipo) => (tipo === 'VEICULO' ? 'km' : 'h');
const textoEquip = (e) => `${e.nome}${e.placa ? ` (${e.placa})` : ''}`;

export const equipamentos = telaRecurso({
  titulo: 'Veículos e máquinas', singular: 'equipamento', rota: '/api/equipamentos', editar: 'frota.editar',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: TIPOS_EQ }],
  colunas: [
    { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'Tipo', valor: (l) => de(TIPOS_EQ, l.tipo) }, { rotulo: 'Placa / nº frota', campo: 'placa' },
    { rotulo: 'Marca / modelo', valor: (l) => [l.marca, l.modelo, l.ano].filter(Boolean).join(' ') }, { rotulo: 'Combustível', valor: (l) => de(COMBUSTIVEIS, l.combustivel) },
    { rotulo: 'Leitura atual', classe: 'num', valor: (l) => `${fmt.numero(l.leitura_atual, 1)} ${un(l.tipo)}` },
    { rotulo: 'Receita/dia', classe: 'num', valor: (l) => (l.receita_dia ? fmt.dinheiro(l.receita_dia) : '—') }, { rotulo: 'Situação', valor: (l) => simNao(l.ativo) },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 100 }, { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_EQ, obrigatorio: true },
    { nome: 'placa', rotulo: 'Placa ou nº de frota', max: 10 }, { nome: 'combustivel', rotulo: 'Combustível', tipo: 'select', opcoes: COMBUSTIVEIS, obrigatorio: true, padrao: 'DIESEL' },
    { nome: 'marca', rotulo: 'Marca', max: 60 }, { nome: 'modelo', rotulo: 'Modelo', max: 60 }, { nome: 'ano', rotulo: 'Ano', tipo: 'inteiro' },
    { nome: 'leitura_atual', rotulo: 'Leitura atual (km ou horas)', tipo: 'numero', casas: 1, padrao: '0' },
    { nome: 'centro_custo_id', rotulo: 'Centro de custo', tipo: 'remoto', rota: '/api/centros-custo?ativo=1', texto: (c) => `${c.codigo} - ${c.nome}` },
    { nome: 'receita_dia', rotulo: 'Receita que pode gerar por dia (diária de referência)', tipo: 'dinheiro' },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: 1 },
  ],
});

const campoEquip = { nome: 'equipamento_id', rotulo: 'Veículo / máquina', tipo: 'remoto', rota: '/api/equipamentos?ativo=1', texto: textoEquip, obrigatorio: true };

export const abastecimentos = telaRecurso({
  titulo: 'Abastecimentos', singular: 'abastecimento', rota: '/api/abastecimentos', editar: 'abastecimentos.lancar', busca: false, semEditar: true,
  excluir: 'frota.editar', textoNovo: '+ Lançar abastecimento',
  ajuda: 'Marque "tanque cheio" sempre que completar o tanque: é entre dois tanques cheios que o sistema calcula a média. Ao lançar a nota do posto em Contas a pagar, vincule os abastecimentos que ela paga.',
  filtros: [{ nome: 'de', rotulo: 'De', tipo: 'data' }, { nome: 'ate', rotulo: 'Até', tipo: 'data' }, { nome: 'sem_conta', rotulo: 'Conta a pagar', opcoes: [['1', 'Sem conta a pagar']] }],
  colunas: [
    { rotulo: 'Data', valor: (l) => fmt.data(l.data) }, { rotulo: 'Equipamento', campo: 'equipamento_nome' },
    { rotulo: 'Leitura', classe: 'num', valor: (l) => `${fmt.numero(l.leitura, 1)} ${un(l.equipamento_tipo)}` },
    { rotulo: 'Litros', classe: 'num', valor: (l) => fmt.numero(l.litros, 3) }, { rotulo: 'Valor', classe: 'num', valor: (l) => fmt.dinheiro(l.valor_total) },
    { rotulo: 'R$/L', classe: 'num', valor: (l) => fmt.numero(Number(l.valor_total) / Number(l.litros), 3) },
    { rotulo: 'Tanque', valor: (l) => (Number(l.tanque_cheio) ? tag('Cheio', 'ok') : tag('Parcial')) },
    { rotulo: 'Obra', campo: 'centro_custo_nome' }, { rotulo: 'Operador', campo: 'operador' },
    { rotulo: 'Conta a pagar', valor: (l) => (l.lancamento_id ? tag(l.conta_documento || `Conta nº ${l.lancamento_id}`, 'ok') : tag('Pendente', 'alerta')) },
  ],
  campos: [
    campoEquip, { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true },
    { nome: 'leitura', rotulo: 'Leitura (km ou horímetro)', tipo: 'numero', casas: 1, obrigatorio: true },
    { nome: 'litros', rotulo: 'Litros', tipo: 'numero', casas: 3, obrigatorio: true },
    { nome: 'valor_total', rotulo: 'Valor total', tipo: 'dinheiro', obrigatorio: true }, { nome: 'tanque_cheio', rotulo: 'Completou o tanque (tanque cheio)', tipo: 'bool', padrao: 1 },
    { nome: 'posto', rotulo: 'Posto', max: 100 }, { nome: 'operador', rotulo: 'Operador / motorista', max: 100 },
    { nome: 'centro_custo_id', rotulo: 'Obra / centro de custo', tipo: 'remoto', rota: '/api/centros-custo?ativo=1', texto: (c) => `${c.codigo} - ${c.nome}` },
    { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' },
  ],
});

export const planos = telaRecurso({
  titulo: 'Planos de manutenção', singular: 'plano', rota: '/api/planos-manutencao', editar: 'frota.editar',
  ajuda: 'Defina de quanto em quanto tempo cada serviço deve ser feito (por km/horas, por dias ou ambos). O painel avisa quando estiver perto de vencer.',
  colunas: [
    { rotulo: 'Equipamento', campo: 'equipamento_nome' }, { rotulo: 'Serviço', campo: 'descricao' },
    { rotulo: 'A cada', valor: (l) => [l.intervalo_leitura ? `${fmt.numero(l.intervalo_leitura, 1)} ${un(l.equipamento_tipo)}` : null, l.intervalo_dias ? `${l.intervalo_dias} dias` : null].filter(Boolean).join(' ou ') },
    { rotulo: 'Última vez', valor: (l) => [fmt.data(l.ultima_data), l.ultima_leitura ? `${fmt.numero(l.ultima_leitura, 1)} ${un(l.equipamento_tipo)}` : null].filter(Boolean).join(' · ') },
    { rotulo: 'Situação', valor: (l) => simNao(l.ativo) },
  ],
  campos: [
    campoEquip, { nome: 'descricao', rotulo: 'Serviço (ex.: troca de óleo)', obrigatorio: true, max: 120 },
    { nome: 'intervalo_leitura', rotulo: 'A cada quantos km / horas', tipo: 'numero', casas: 1 }, { nome: 'intervalo_dias', rotulo: 'A cada quantos dias', tipo: 'inteiro' },
    { nome: 'ultima_leitura', rotulo: 'Leitura na última vez', tipo: 'numero', casas: 1 }, { nome: 'ultima_data', rotulo: 'Data da última vez', tipo: 'data' },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'bool', padrao: 1 },
  ],
});

export const manutencoes = telaRecurso({
  titulo: 'Manutenções', singular: 'manutenção', rota: '/api/manutencoes', editar: 'frota.editar', textoNovo: '+ Registrar manutenção',
  filtros: [{ nome: 'tipo', rotulo: 'Tipo', opcoes: ['PREVENTIVA', 'CORRETIVA'] }, { nome: 'de', rotulo: 'De', tipo: 'data' }, { nome: 'ate', rotulo: 'Até', tipo: 'data' }],
  colunas: [
    { rotulo: 'Data', valor: (l) => fmt.data(l.data) }, { rotulo: 'Equipamento', campo: 'equipamento_nome' }, { rotulo: 'Tipo', valor: (l) => fmt.rotulo(l.tipo) },
    { rotulo: 'Serviço', campo: 'descricao' }, { rotulo: 'Leitura', classe: 'num', valor: (l) => fmt.numero(l.leitura, 1) },
    { rotulo: 'Valor', classe: 'num', valor: (l) => fmt.dinheiro(l.valor) }, { rotulo: 'Oficina', campo: 'oficina' },
  ],
  campos: [
    campoEquip, { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: ['PREVENTIVA', 'CORRETIVA'], obrigatorio: true, padrao: 'PREVENTIVA' },
    { nome: 'descricao', rotulo: 'Serviço realizado', obrigatorio: true, largo: true, max: 200 },
    { nome: 'plano_id', rotulo: 'Plano de manutenção atendido', tipo: 'remoto', rota: '/api/planos-manutencao?ativo=1', texto: (p) => `${p.equipamento_nome} - ${p.descricao}` },
    { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true }, { nome: 'leitura', rotulo: 'Leitura (km ou horas)', tipo: 'numero', casas: 1 },
    { nome: 'valor', rotulo: 'Valor', tipo: 'dinheiro', padrao: '0.00' }, { nome: 'oficina', rotulo: 'Oficina', max: 100 },
    { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' },
  ],
});
