// Popula a primeira empresa com dados de demonstração (cadastros, financeiro, licitações,
// obras e frota), usando a própria API, para que todas as regras do sistema sejam aplicadas.
// Uso: com o sistema rodando, "npm run demo" (ou: node scripts/demo.js http://localhost:3000)
// Usa ADMIN_EMAIL e ADMIN_SENHA do .env. Não roda duas vezes na mesma empresa.
require('dotenv').config();

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3000}`;
let token = null;
let empresaId = null;

// O sistema aceita até 600 requisições por minuto por IP; ao atingir o limite, espera e tenta de novo.
async function api(metodo, rota, corpo, tentativa = 1) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Empresa-Id': String(empresaId) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 429 && tentativa <= 12) {
    if (tentativa === 1) console.log('  (limite de requisições do sistema atingido; aguardando...)');
    await new Promise((ok) => setTimeout(ok, 10000));
    return api(metodo, rota, corpo, tentativa + 1);
  }
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status}: ${texto}`);
  return dados;
}

// ---------- datas relativas a hoje ----------
const HOJE = new Date();
HOJE.setHours(12, 0, 0, 0);
const iso = (d) => d.toISOString().slice(0, 10);
const dias = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return iso(d); };
const dinheiro = (n) => n.toFixed(2);

// gerador pseudoaleatório fixo: a demonstração sai igual em toda execução
let semente = 42;
const aleat = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };
const entre = (a, b) => a + aleat() * (b - a);

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, senha: process.env.ADMIN_SENHA }),
  });
  const sessao = await login.json();
  if (!login.ok) throw new Error(`Login falhou: ${JSON.stringify(sessao)}`);
  token = sessao.token;
  empresaId = sessao.empresas[0].id;
  console.log(`Empresa: ${sessao.empresas[0].razao_social} (id ${empresaId})`);

  const existentes = await api('GET', '/api/contratos?por_pagina=5');
  if (existentes.total > 0) throw new Error('Esta empresa já tem contratos; a demonstração não foi aplicada de novo.');

  // ---------- cadastros ----------
  const cats = (await api('GET', '/api/categorias?por_pagina=500')).dados;
  const cat = (codigo) => cats.find((c) => c.codigo === codigo).id;
  const ccAdm = (await api('GET', '/api/centros-custo?por_pagina=50')).dados.find((c) => c.codigo === 'ADM').id;

  const pessoa = async (nome, tipo, documento, cidade, uf, telefone) =>
    (await api('POST', '/api/pessoas', { nome, tipo, documento, cidade, uf, telefone, email: null })).id;

  const pref = {
    curitiba: await pessoa('Prefeitura Municipal de Curitiba', 'CLIENTE', '76417005000186', 'Curitiba', 'PR', '(41) 3350-8000'),
    pontaGrossa: await pessoa('Prefeitura Municipal de Ponta Grossa', 'CLIENTE', '76175884000187', 'Ponta Grossa', 'PR', '(42) 3220-1000'),
    der: await pessoa('DER-PR Departamento de Estradas de Rodagem', 'CLIENTE', '76669324000189', 'Curitiba', 'PR', '(41) 3304-8000'),
    sanepar: await pessoa('Companhia de Saneamento do Paraná', 'CLIENTE', '76484013000145', 'Curitiba', 'PR', '(41) 3330-3000'),
    londrina: await pessoa('Prefeitura Municipal de Londrina', 'CLIENTE', '75771377000136', 'Londrina', 'PR', '(43) 3372-4000'),
  };
  const forn = {
    cimento: await pessoa('Votoran Cimentos Distribuidora Ltda', 'FORNECEDOR', '10656452000180', 'Curitiba', 'PR', '(41) 3021-4400'),
    aco: await pessoa('Gerdau Aços Longos (revenda Paraná)', 'FORNECEDOR', '07358761000169', 'Araucária', 'PR', '(41) 3641-2000'),
    areia: await pessoa('Areal Rio Iguaçu Ltda', 'FORNECEDOR', '12345678000195', 'São José dos Pinhais', 'PR', '(41) 3282-1100'),
    asfalto: await pessoa('Betunel Asfaltos do Sul', 'FORNECEDOR', '23456789000106', 'Araucária', 'PR', '(41) 3643-7700'),
    posto: await pessoa('Auto Posto Rodovia BR-277 Ltda', 'FORNECEDOR', '34567890000117', 'Campo Largo', 'PR', '(41) 3292-5500'),
    oficina: await pessoa('Diesel Center Oficina Mecânica', 'FORNECEDOR', '45678901000128', 'Curitiba', 'PR', '(41) 3346-9090'),
    terraplenagem: await pessoa('Terra Forte Terraplenagem (subempreiteiro)', 'FORNECEDOR', '56789012000139', 'Curitiba', 'PR', '(41) 99123-4567'),
    contador: await pessoa('Contabilidade Precisão S/S', 'FORNECEDOR', '67890123000140', 'Curitiba', 'PR', '(41) 3233-1212'),
    imobiliaria: await pessoa('Imobiliária Centro Cívico (aluguel escritório)', 'FORNECEDOR', '78901234000151', 'Curitiba', 'PR', '(41) 3254-3030'),
    locadora: await pessoa('LocaMáquinas Equipamentos Ltda', 'AMBOS', '89012345000162', 'Pinhais', 'PR', '(41) 3668-4444'),
    tubos: await pessoa('Tigre Tubos e Conexões (distribuidor)', 'FORNECEDOR', '90123456000173', 'Curitiba', 'PR', '(41) 3015-6060'),
  };
  console.log('Clientes e fornecedores criados');

  const banco = {
    itau: (await api('POST', '/api/contas-bancarias', { nome: 'Itaú - Conta movimento', banco: 'Itaú', agencia: '0912', conta: '45871-2', saldo_inicial: '720000.00' })).id,
    bb: (await api('POST', '/api/contas-bancarias', { nome: 'Banco do Brasil - Obras públicas', banco: 'Banco do Brasil', agencia: '3418-5', conta: '102938-7', saldo_inicial: '310000.00' })).id,
    caixa: (await api('POST', '/api/contas-bancarias', { nome: 'Caixa pequeno', banco: '', saldo_inicial: '3500.00' })).id,
  };
  console.log('Contas bancárias criadas');

  // ---------- licitações e documentos ----------
  const lic = async (d) => (await api('POST', '/api/licitacoes', d)).id;
  const licPavimentacao = await lic({
    orgao_id: pref.curitiba, numero_processo: 'CC 012/2026', modalidade: 'CONCORRENCIA', status: 'HOMOLOGADA',
    objeto: 'Pavimentação asfáltica e drenagem pluvial de vias no bairro Cajuru, com 3,2 km de extensão.',
    portal: 'Compras Curitiba', link: 'https://www.curitiba.pr.gov.br/licitacoes', data_abertura: `${dias(-170)}T09:00`,
    valor_estimado: '2480000.00', valor_proposta: '2265400.00',
  });
  const licEscola = await lic({
    orgao_id: pref.pontaGrossa, numero_processo: 'PE 045/2026', modalidade: 'PREGAO_ELETRONICO', status: 'HOMOLOGADA',
    objeto: 'Reforma e ampliação da Escola Municipal Professora Zilda Arns: cobertura, salas de aula e acessibilidade.',
    portal: 'Licitações-e (BB)', data_abertura: `${dias(-120)}T10:00`, valor_estimado: '980000.00', valor_proposta: '912350.00',
  });
  const licRede = await lic({
    orgao_id: pref.sanepar, numero_processo: 'LI 230/2026', modalidade: 'CONCORRENCIA', status: 'HOMOLOGADA',
    objeto: 'Implantação de rede coletora de esgoto, 4,8 km, com ligações domiciliares no município de Campo Largo.',
    portal: 'Portal de Compras Sanepar', data_abertura: `${dias(-95)}T09:30`, valor_estimado: '1650000.00', valor_proposta: '1528900.00',
  });
  await lic({ orgao_id: pref.der, numero_processo: 'CP 118/2026', modalidade: 'CONCORRENCIA', status: 'DISPUTA', objeto: 'Restauração do pavimento da PR-423, trecho Campo Largo - Araucária, 18 km.', portal: 'Compras Paraná', data_abertura: `${dias(6)}T09:00`, valor_estimado: '7850000.00', valor_proposta: '7310000.00' });
  await lic({ orgao_id: pref.londrina, numero_processo: 'PE 301/2026', modalidade: 'PREGAO_ELETRONICO', status: 'PROPOSTA', objeto: 'Construção de Unidade Básica de Saúde porte II no Jardim Paraíso.', portal: 'Compras.gov.br', data_abertura: `${dias(12)}T14:00`, valor_estimado: '2120000.00' });
  await lic({ orgao_id: pref.curitiba, numero_processo: 'CC 027/2026', modalidade: 'CONCORRENCIA', status: 'ANALISE', objeto: 'Execução de ciclovia e calçadas acessíveis na Av. Comendador Franco, 5,5 km.', portal: 'Compras Curitiba', data_abertura: `${dias(21)}T09:00`, valor_estimado: '3400000.00' });
  await lic({ orgao_id: pref.pontaGrossa, numero_processo: 'TP 009/2026', modalidade: 'CONCORRENCIA', status: 'PROSPECCAO', objeto: 'Construção de centro de educação infantil (CMEI) padrão FNDE tipo 1.', data_abertura: `${dias(35)}T10:00`, valor_estimado: '3950000.00' });
  await lic({ orgao_id: pref.der, numero_processo: 'CP 077/2026', modalidade: 'CONCORRENCIA', status: 'PERDIDA', objeto: 'Conservação rodoviária da PR-092, lote 3.', data_abertura: `${dias(-60)}T09:00`, valor_estimado: '4200000.00', valor_proposta: '3985000.00', observacao: 'Vencedora: proposta 6% abaixo da nossa.' });
  await lic({ orgao_id: pref.londrina, numero_processo: 'PE 188/2026', modalidade: 'PREGAO_ELETRONICO', status: 'DESISTENCIA', objeto: 'Manutenção predial de próprios municipais (registro de preços).', data_abertura: `${dias(-40)}T14:00`, valor_estimado: '650000.00', observacao: 'Exigência de atestado fora do nosso porte.' });
  console.log('Licitações criadas');

  const docs = [
    ['CND Federal (Receita/PGFN)', 'FISCAL', '7F3A.92C1.0D44.1B2E', -150, 30],
    ['CND Estadual - Paraná', 'FISCAL', '026547891-23', -170, 12],
    ['CND Municipal - Curitiba', 'FISCAL', '2026/0081234', -100, -5],
    ['Certificado de Regularidade do FGTS', 'TRABALHISTA', '2026091512345678', -20, 10],
    ['CNDT - Débitos Trabalhistas', 'TRABALHISTA', '41258963/2026', -60, 120],
    ['Contrato social consolidado', 'JURIDICA', '41205678901', -400, null],
    ['Certidão de acervo técnico (CAT) - pavimentação', 'TECNICA', 'CAT 1720250012345', -300, null],
    ['Registro no CREA-PR', 'TECNICA', 'PR-58234', -200, 165],
    ['Balanço patrimonial 2025', 'ECONOMICA', 'Exercício 2025', -230, 140],
    ['Certidão negativa de falência', 'ECONOMICA', '0004587-12.2026', -25, 65],
  ];
  for (const [nome, tipo, numero, emis, val] of docs) {
    await api('POST', '/api/documentos', { nome, tipo, numero, data_emissao: dias(emis), data_validade: val === null ? null : dias(val) });
  }
  console.log('Documentos de habilitação criados');

  // ---------- contratos, planilhas e execuções ----------
  async function contrato(d, itens) {
    const c = await api('POST', '/api/contratos', d);
    const ids = {};
    for (const [codigo, descricao, unidade, quantidade, preco] of itens) {
      const corpo = { codigo, descricao };
      if (quantidade) Object.assign(corpo, { unidade, quantidade: String(quantidade), preco_unitario: String(preco) });
      ids[codigo] = (await api('POST', `/api/contratos/${c.id}/itens`, corpo)).id;
    }
    // o valor do contrato passa a ser o total da planilha
    const atualizado = await api('GET', `/api/contratos/${c.id}`);
    await api('PUT', `/api/contratos/${c.id}`, { valor_total: atualizado.valor_planilha });
    return { ...c, itens: ids };
  }

  const cPav = await contrato({
    numero: '012-2026', cliente_id: pref.curitiba, licitacao_id: licPavimentacao, status: 'ATIVO',
    objeto: 'Pavimentação asfáltica e drenagem pluvial de vias no bairro Cajuru.',
    data_assinatura: dias(-150), data_inicio: dias(-140), data_fim: dias(220), valor_total: '2265400.00',
  }, [
    ['1', 'SERVIÇOS PRELIMINARES'],
    ['1.1', 'Mobilização e desmobilização de equipamentos', 'vb', 1, 38500],
    ['1.2', 'Placa de obra em chapa galvanizada', 'm2', 12, 485.5],
    ['1.3', 'Locação topográfica da obra', 'km', 3.2, 4850],
    ['2', 'TERRAPLENAGEM'],
    ['2.1', 'Escavação e carga de material de 1ª categoria', 'm3', 9600, 14.8],
    ['2.2', 'Transporte de material escavado (DMT 5 km)', 'm3xkm', 48000, 1.95],
    ['2.3', 'Regularização e compactação do subleito', 'm2', 25600, 3.65],
    ['3', 'PAVIMENTAÇÃO'],
    ['3.1', 'Sub-base de macadame seco, e=15 cm', 'm3', 3840, 128.4],
    ['3.2', 'Base de brita graduada simples, e=15 cm', 'm3', 3840, 156.9],
    ['3.3', 'Imprimação com asfalto diluído CM-30', 'm2', 25600, 6.85],
    ['3.4', 'Concreto betuminoso usinado a quente (CBUQ), e=5 cm', 't', 3072, 248.6],
    ['4', 'DRENAGEM'],
    ['4.1', 'Tubo de concreto armado DN 600 mm', 'm', 1450, 312.4],
    ['4.2', 'Boca de lobo dupla', 'un', 64, 2850],
    ['4.3', 'Poço de visita em alvenaria', 'un', 28, 4620],
    ['5', 'SINALIZAÇÃO'],
    ['5.1', 'Pintura de faixas com tinta acrílica', 'm2', 2100, 28.9],
    ['5.2', 'Placas de sinalização vertical', 'un', 85, 410],
  ]);

  const cEscola = await contrato({
    numero: '045-2026', cliente_id: pref.pontaGrossa, licitacao_id: licEscola, status: 'ATIVO',
    objeto: 'Reforma e ampliação da Escola Municipal Professora Zilda Arns.',
    data_assinatura: dias(-100), data_inicio: dias(-90), data_fim: dias(90), valor_total: '912350.00',
  }, [
    ['1', 'DEMOLIÇÕES E RETIRADAS'],
    ['1.1', 'Demolição de cobertura existente (telha e madeiramento)', 'm2', 860, 22.4],
    ['1.2', 'Retirada de esquadrias', 'un', 48, 65],
    ['2', 'COBERTURA'],
    ['2.1', 'Estrutura metálica para cobertura', 'kg', 9200, 18.6],
    ['2.2', 'Telha termoacústica e=30 mm', 'm2', 920, 142.8],
    ['2.3', 'Calhas e rufos em aço galvanizado', 'm', 310, 96.5],
    ['3', 'AMPLIAÇÃO - 2 SALAS DE AULA'],
    ['3.1', 'Fundação em estaca e bloco de concreto', 'm3', 38, 1450],
    ['3.2', 'Alvenaria de blocos cerâmicos', 'm2', 420, 98.7],
    ['3.3', 'Contrapiso e piso cerâmico', 'm2', 140, 168.4],
    ['3.4', 'Instalações elétricas das salas', 'vb', 1, 42800],
    ['4', 'ACESSIBILIDADE'],
    ['4.1', 'Rampa de acesso em concreto com guarda-corpo', 'm', 36, 1280],
    ['4.2', 'Adaptação de banheiros PNE', 'un', 2, 18900],
    ['4.3', 'Piso tátil direcional e de alerta', 'm2', 95, 112],
  ]);

  const cRede = await contrato({
    numero: 'SAN-230-2026', cliente_id: pref.sanepar, licitacao_id: licRede, status: 'ATIVO',
    objeto: 'Implantação de rede coletora de esgoto, 4,8 km, em Campo Largo.',
    data_assinatura: dias(-75), data_inicio: dias(-60), data_fim: dias(300), valor_total: '1528900.00',
  }, [
    ['1', 'REDE COLETORA'],
    ['1.1', 'Escavação mecânica de vala', 'm3', 7200, 24.5],
    ['1.2', 'Tubo PVC ocre DN 150 mm, assentado', 'm', 4800, 86.4],
    ['1.3', 'Reaterro compactado de vala', 'm3', 6500, 19.8],
    ['1.4', 'Poço de visita pré-moldado', 'un', 96, 3150],
    ['2', 'LIGAÇÕES DOMICILIARES'],
    ['2.1', 'Ligação predial de esgoto completa', 'un', 620, 685],
    ['3', 'REPOSIÇÃO DE PAVIMENTO'],
    ['3.1', 'Recomposição de pavimento asfáltico', 'm2', 3800, 92.3],
  ]);
  console.log('Contratos e planilhas criados');

  // execuções mês a mês: [contrato, item, dias atrás, fração da quantidade]
  const qtdItem = {};
  const guardarQtd = (c, itens) => { for (const [codigo, , , q] of itens) if (q) qtdItem[`${c.id}:${codigo}`] = q; };
  // reconstrói as quantidades a partir das planilhas acima
  for (const c of [cPav, cEscola, cRede]) {
    const ev = await api('GET', `/api/contratos/${c.id}/evolucao`);
    guardarQtd(c, ev.itens.filter((i) => !i.fase).map((i) => [i.codigo, null, null, Number(i.quantidade)]));
  }
  const execucoes = [];
  const executar = async (c, codigo, diasAtras, fracao, observacao) => {
    const q = qtdItem[`${c.id}:${codigo}`];
    const quantidade = Math.round(q * fracao * 10000) / 10000;
    const r = await api('POST', `/api/contratos/${c.id}/execucoes`, { contrato_item_id: c.itens[codigo], data: dias(-diasAtras), quantidade: quantidade.toFixed(4), observacao });
    execucoes.push({ contrato: c.id, id: r.id, diasAtras });
  };

  // pavimentação: obra bem adiantada
  await executar(cPav, '1.1', 135, 1, 'Equipamentos mobilizados');
  await executar(cPav, '1.2', 135, 1);
  await executar(cPav, '1.3', 130, 1);
  await executar(cPav, '2.1', 120, 0.3); await executar(cPav, '2.1', 95, 0.35); await executar(cPav, '2.1', 65, 0.25);
  await executar(cPav, '2.2', 120, 0.3); await executar(cPav, '2.2', 95, 0.35); await executar(cPav, '2.2', 65, 0.25);
  await executar(cPav, '2.3', 90, 0.4); await executar(cPav, '2.3', 60, 0.3);
  await executar(cPav, '3.1', 60, 0.35); await executar(cPav, '3.1', 30, 0.25);
  await executar(cPav, '3.2', 30, 0.3); await executar(cPav, '3.2', 8, 0.15);
  await executar(cPav, '3.3', 8, 0.2);
  await executar(cPav, '4.1', 100, 0.25); await executar(cPav, '4.1', 70, 0.3); await executar(cPav, '4.1', 40, 0.2);
  await executar(cPav, '4.2', 70, 0.25); await executar(cPav, '4.2', 40, 0.25);
  await executar(cPav, '4.3', 70, 0.3); await executar(cPav, '4.3', 40, 0.3);
  // escola
  await executar(cEscola, '1.1', 85, 1); await executar(cEscola, '1.2', 85, 1);
  await executar(cEscola, '2.1', 60, 0.6); await executar(cEscola, '2.1', 32, 0.4);
  await executar(cEscola, '2.2', 32, 0.5); await executar(cEscola, '2.2', 10, 0.3);
  await executar(cEscola, '3.1', 70, 1);
  await executar(cEscola, '3.2', 40, 0.5); await executar(cEscola, '3.2', 12, 0.3);
  await executar(cEscola, '4.1', 12, 0.4);
  // rede de esgoto
  await executar(cRede, '1.1', 50, 0.12); await executar(cRede, '1.1', 25, 0.15);
  await executar(cRede, '1.2', 50, 0.1); await executar(cRede, '1.2', 25, 0.14);
  await executar(cRede, '1.3', 25, 0.15);
  await executar(cRede, '1.4', 25, 0.2);
  await executar(cRede, '2.1', 15, 0.08);
  console.log(`${execucoes.length} execuções lançadas`);

  // ---------- financeiro: contas a pagar ----------
  const pagar = async (d) => api('POST', '/api/lancamentos', { tipo: 'PAGAR', data_emissao: d.data_emissao || d.data_vencimento, ...d });
  const receber = async (d) => api('POST', '/api/lancamentos', { tipo: 'RECEBER', data_emissao: d.data_emissao || d.data_vencimento, ...d });
  const baixar = (id, conta, data, extra = {}) => api('POST', `/api/lancamentos/${id}/baixas`, { conta_bancaria_id: conta, data_baixa: data, ...extra });

  const custosObra = []; // [contrato, item, lancamento]
  const compra = async (contratoObj, item, fornecedor, categoria, descricao, documento, diasVenc, valor, pagoEm) => {
    const l = await pagar({ pessoa_id: fornecedor, categoria_id: cat(categoria), centro_custo_id: contratoObj.centro_custo_id, descricao, documento, data_emissao: dias(diasVenc - 28), data_vencimento: dias(diasVenc), valor: dinheiro(valor) });
    if (pagoEm !== undefined) await baixar(l.id, banco.bb, dias(pagoEm));
    if (item) custosObra.push([contratoObj, item, l.id]);
    return l;
  };

  // pavimentação
  await compra(cPav, '2.1', forn.terraplenagem, '3.3', 'Medição 1 - escavação e carga', 'NF 1021', -100, 98400, -98);
  await compra(cPav, '2.1', forn.terraplenagem, '3.3', 'Medição 2 - escavação e carga', 'NF 1058', -70, 104900, -69);
  await compra(cPav, '2.3', forn.terraplenagem, '3.3', 'Medição 3 - regularização do subleito', 'NF 1102', -40, 61200, -40);
  await compra(cPav, '3.1', forn.areia, '3.1', 'Brita para macadame - 1.400 m³', 'NF 55871', -45, 112300, -44);
  await compra(cPav, '3.2', forn.areia, '3.1', 'Brita graduada - 1.150 m³', 'NF 56220', -15, 108750, -15);
  await compra(cPav, '3.3', forn.asfalto, '3.1', 'Asfalto diluído CM-30 - 9.500 L', 'NF 33012', 5, 61850);
  await compra(cPav, '4.1', forn.tubos, '3.1', 'Tubos de concreto DN 600 - 1.100 m', 'NF 77810', -80, 196400, -79);
  await compra(cPav, '4.2', forn.cimento, '3.1', 'Cimento e argamassa - bocas de lobo', 'NF 90231', -55, 38900, -54);
  await compra(cPav, '4.3', forn.cimento, '3.1', 'Cimento e blocos - poços de visita', 'NF 90455', -35, 41200, -34);
  await compra(cPav, '1.1', forn.locadora, '3.6', 'Locação de rolo compactador - out/nov', 'Fat 4410', 10, 28600);
  // escola
  await compra(cEscola, '2.1', forn.aco, '3.1', 'Estrutura metálica da cobertura', 'NF 214587', -50, 121300, -49);
  await compra(cEscola, '2.2', forn.aco, '3.1', 'Telhas termoacústicas - 1º lote', 'NF 215004', -20, 68900, -20);
  await compra(cEscola, '3.1', forn.cimento, '3.1', 'Concreto usinado fck 25 - fundações', 'NF 89870', -65, 41800, -65);
  await compra(cEscola, '3.2', forn.cimento, '3.1', 'Blocos cerâmicos e argamassa', 'NF 90601', -18, 27650, -17);
  await compra(cEscola, '4.1', forn.aco, '3.1', 'Guarda-corpo em aço inox', 'NF 215390', 12, 22400);
  // rede
  await compra(cRede, '1.2', forn.tubos, '3.1', 'Tubos PVC ocre DN 150 - 1.300 m', 'NF 78102', -30, 74300, -29);
  await compra(cRede, '1.4', forn.cimento, '3.1', 'Poços de visita pré-moldados - 20 un', 'NF 90512', -22, 41900, -22);
  await compra(cRede, '1.1', forn.locadora, '3.6', 'Locação de retroescavadeira - outubro', 'Fat 4388', -12, 18400, -11);
  await compra(cRede, '2.1', forn.tubos, '3.1', 'Conexões e caixas para ligações', 'NF 78350', 18, 29600);

  // vincula os custos aos itens das obras
  for (const [c, item, lancamento] of custosObra) {
    await api('POST', `/api/contratos/${c.id}/custos`, { contrato_item_id: c.itens[item], lancamento_id: lancamento });
  }
  console.log(`${custosObra.length} contas a pagar de obra lançadas e apropriadas aos itens`);

  // despesas administrativas recorrentes (6 meses para trás + 2 à frente)
  for (let m = -5; m <= 2; m++) {
    const venc = (dia) => { const d = new Date(HOJE.getFullYear(), HOJE.getMonth() + m, dia, 12); return iso(d); };
    const passado = new Date(venc(10)) < HOJE;
    const fixas = [
      [forn.imobiliaria, '4.2', 'Aluguel do escritório', 6800, 5, banco.itau],
      [forn.contador, '4.3', 'Honorários contábeis', 3200, 10, banco.itau],
      [forn.oficina, '3.5', 'Manutenção preventiva da frota', 4200 + Math.round(entre(-900, 1800)), 20, banco.itau],
    ];
    for (const [p, c, desc, valor, dia, conta] of fixas) {
      const v = venc(dia);
      const mesAno = v.slice(5, 7) + '/' + v.slice(0, 4);
      const l = await pagar({ pessoa_id: p, categoria_id: cat(c), centro_custo_id: ccAdm, descricao: `${desc} ${mesAno}`, documento: null, data_vencimento: v, valor: dinheiro(valor) });
      if (new Date(v) < new Date(dias(-3))) await baixar(l.id, conta, v);
    }
    const folha = venc(5);
    const lf = await pagar({ pessoa_id: forn.contador, categoria_id: cat('4.1'), centro_custo_id: ccAdm, descricao: `Folha administrativa ${folha.slice(5, 7)}/${folha.slice(0, 4)}`, data_vencimento: folha, valor: dinheiro(38500 + Math.round(entre(0, 2500))) });
    if (new Date(folha) < new Date(dias(-3))) await baixar(lf.id, banco.itau, folha);
    if (passado) {
      const tarifa = await pagar({ pessoa_id: forn.contador, categoria_id: cat('5.1'), centro_custo_id: ccAdm, descricao: `Tarifas bancárias ${venc(28).slice(5, 7)}/${venc(28).slice(0, 4)}`, data_vencimento: venc(28), valor: dinheiro(entre(280, 520)) });
      if (new Date(venc(28)) < HOJE) await baixar(tarifa.id, banco.itau, venc(28));
    }
  }
  // algumas contas vencidas e uma parcelada
  await pagar({ pessoa_id: forn.oficina, categoria_id: cat('3.5'), centro_custo_id: ccAdm, descricao: 'Retífica do motor da escavadeira', documento: 'OS 7781', data_vencimento: dias(-9), valor: '18750.00' });
  await pagar({ pessoa_id: forn.contador, categoria_id: cat('4.4'), centro_custo_id: ccAdm, descricao: 'Seguro-garantia de proposta - CP 118/2026', documento: 'Apólice 0098', data_vencimento: dias(-2), valor: '7310.00' });
  const parcelada = await pagar({ pessoa_id: forn.locadora, categoria_id: cat('3.6'), centro_custo_id: ccAdm, descricao: 'Compra de compactador de solo (financiado)', documento: 'NF 4502', data_vencimento: dias(-40), valor: '43200.00', parcelas: 6 });
  await baixar(parcelada[0].id, banco.itau, dias(-40));
  await baixar(parcelada[1].id, banco.itau, dias(-10), { valor: '4000.00', observacao: 'Pagamento parcial' });
  console.log('Despesas administrativas lançadas');

  // ---------- frota ----------
  const eq = async (d) => (await api('POST', '/api/equipamentos', d)).id;
  const frota = [
    { id: await eq({ nome: 'Caminhão basculante 6x4', tipo: 'VEICULO', placa: 'BEX4F21', combustivel: 'DIESEL_S10', marca: 'Volvo', modelo: 'FMX 460', ano: 2021, leitura_atual: '148200' }), tipo: 'V', inicio: 148200, passo: [420, 620], litros: [180, 260], obra: cPav, op: 'Carlos Mendes' },
    { id: await eq({ nome: 'Caminhão basculante toco', tipo: 'VEICULO', placa: 'AYU7C34', combustivel: 'DIESEL_S10', marca: 'Mercedes-Benz', modelo: 'Atego 2426', ano: 2019, leitura_atual: '212500' }), tipo: 'V', inicio: 212500, passo: [380, 560], litros: [110, 160], obra: cRede, op: 'José Ribeiro' },
    { id: await eq({ nome: 'Caminhonete apoio', tipo: 'VEICULO', placa: 'RHK2D19', combustivel: 'DIESEL_S10', marca: 'Toyota', modelo: 'Hilux SRV', ano: 2023, leitura_atual: '45800' }), tipo: 'V', inicio: 45800, passo: [550, 780], litros: [55, 72], obra: null, op: 'Eng. Paula Souza' },
    { id: await eq({ nome: 'Escavadeira hidráulica 20 t', tipo: 'MAQUINA', placa: 'ESC-01', combustivel: 'DIESEL', marca: 'Caterpillar', modelo: '320', ano: 2020, leitura_atual: '6820' }), tipo: 'M', inicio: 6820, passo: [38, 52], litros: [520, 720], obra: cPav, op: 'Antônio Lima' },
    { id: await eq({ nome: 'Motoniveladora', tipo: 'MAQUINA', placa: 'MOT-02', combustivel: 'DIESEL', marca: 'John Deere', modelo: '670G', ano: 2018, leitura_atual: '9410' }), tipo: 'M', inicio: 9410, passo: [30, 44], litros: [420, 560], obra: cPav, op: 'Rogério Alves' },
    { id: await eq({ nome: 'Retroescavadeira', tipo: 'MAQUINA', placa: 'RET-03', combustivel: 'DIESEL', marca: 'JCB', modelo: '3CX', ano: 2022, leitura_atual: '3150' }), tipo: 'M', inicio: 3150, passo: [34, 48], litros: [140, 190], obra: cRede, op: 'Marcos Pereira' },
    { id: await eq({ nome: 'Rolo compactador', tipo: 'MAQUINA', placa: 'ROL-04', combustivel: 'DIESEL', marca: 'Dynapac', modelo: 'CA250', ano: 2017, leitura_atual: '11240' }), tipo: 'M', inicio: 11240, passo: [36, 50], litros: [160, 230], obra: cPav, op: 'Luiz Carvalho' },
  ];
  console.log('Veículos e máquinas cadastrados');

  // abastecimentos semanais nos últimos 120 dias; o preço do diesel sobe aos poucos
  const abast = [];
  for (const e of frota) {
    let leitura = e.inicio;
    for (let d = -120; d <= -1; d += 7) {
      const data = d + Math.round(entre(0, 2));
      if (data > -1) break;
      leitura += Math.round(entre(e.passo[0], e.passo[1]));
      const litros = entre(e.litros[0], e.litros[1]);
      const preco = 6.05 + ((d + 120) / 120) * 0.35 + entre(-0.05, 0.05);
      const r = await api('POST', '/api/abastecimentos', {
        equipamento_id: e.id, data: dias(data), leitura: leitura.toFixed(1), litros: litros.toFixed(3),
        valor_total: dinheiro(litros * preco), tanque_cheio: aleat() > 0.15, posto: e.tipo === 'V' ? 'Auto Posto Rodovia BR-277' : 'Comboio próprio (diesel do posto)',
        operador: e.op, centro_custo_id: e.obra ? e.obra.centro_custo_id : ccAdm,
      });
      abast.push({ id: r.id, dia: data, valor: Number(dinheiro(litros * preco)) });
    }
    e.final = leitura;
  }
  console.log(`${abast.length} abastecimentos lançados`);

  // notas quinzenais do posto pagando os abastecimentos (deixa as 2 últimas semanas sem conta)
  for (let ini = -120; ini < -15; ini += 15) {
    const lote = abast.filter((a) => a.dia >= ini && a.dia < ini + 15);
    if (!lote.length) continue;
    const total = lote.reduce((s, a) => s + a.valor, 0);
    const l = await pagar({
      pessoa_id: forn.posto, categoria_id: cat('3.4'), centro_custo_id: ccAdm,
      descricao: `Combustível - quinzena ${dias(ini).slice(8, 10)}/${dias(ini).slice(5, 7)} a ${dias(ini + 14).slice(8, 10)}/${dias(ini + 14).slice(5, 7)}`,
      documento: `NF ${61000 + ini + 200}`, data_emissao: dias(ini + 15), data_vencimento: dias(ini + 25), valor: dinheiro(total),
      abastecimentos: lote.map((a) => a.id),
    });
    if (ini + 25 < -2) await baixar(l.id, banco.itau, dias(ini + 25));
  }
  console.log('Notas do posto lançadas e vinculadas aos abastecimentos');

  // planos de manutenção: [equipamento, serviço, a cada (km/h), a cada (dias), quanto já rodou desde a última, dias atrás]
  // mistura planos em dia, próximos de vencer e vencidos
  const planos = [
    [frota[0], 'Troca de óleo e filtros do motor', '15000', 180, 14100, -95],
    [frota[1], 'Troca de óleo e filtros do motor', '15000', 180, 6200, -70],
    [frota[2], 'Revisão programada', '10000', 365, 10600, -160],
    [frota[3], 'Troca de óleo do motor', '250', 90, 236, -40],
    [frota[3], 'Troca de óleo hidráulico', '2000', null, 1150, -150],
    [frota[4], 'Troca de óleo do motor', '250', 90, 268, -45],
    [frota[5], 'Troca de óleo do motor', '250', 90, 120, -25],
    [frota[6], 'Lubrificação geral e troca de óleo', '250', 60, 95, -15],
  ];
  for (const [e, descricao, intervalo, diasInt, rodado, ultData] of planos) {
    const ultLeitura = e.final - rodado;
    const p = await api('POST', '/api/planos-manutencao', { equipamento_id: e.id, descricao, intervalo_leitura: intervalo, intervalo_dias: diasInt, ultima_leitura: String(ultLeitura), ultima_data: dias(ultData) });
    if (e === frota[6]) {
      await api('POST', '/api/manutencoes', { equipamento_id: e.id, plano_id: p.id, tipo: 'PREVENTIVA', descricao, data: dias(ultData), leitura: String(ultLeitura), valor: '1850.00', oficina: 'Diesel Center' });
    }
  }
  await api('POST', '/api/manutencoes', { equipamento_id: frota[3].id, tipo: 'CORRETIVA', descricao: 'Troca de mangueira hidráulica do braço', data: dias(-33), valor: '2740.00', oficina: 'Diesel Center' });
  await api('POST', '/api/manutencoes', { equipamento_id: frota[0].id, tipo: 'CORRETIVA', descricao: 'Substituição das lonas de freio traseiras', data: dias(-21), valor: '3980.00', oficina: 'Diesel Center' });
  await api('POST', '/api/manutencoes', { equipamento_id: frota[2].id, tipo: 'PREVENTIVA', descricao: 'Alinhamento, balanceamento e rodízio de pneus', data: dias(-14), valor: '420.00', oficina: 'Pneus Curitiba' });
  console.log('Planos de manutenção e manutenções registrados');

  // ---------- notas fiscais das medições (geram contas a receber) ----------
  async function faturar(c, numero, ateDiasAtras, desdeDiasAtras, emissao, vencimento, recebida) {
    const pend = await api('GET', `/api/contratos/${c.id}/execucoes?pendentes=1`);
    const itens = pend.filter((e) => {
      const d = Math.round((HOJE - new Date(`${String(e.data).slice(0, 10)}T12:00:00`)) / 86400000);
      return d >= ateDiasAtras && d <= desdeDiasAtras;
    }).map((e) => ({ execucao_id: e.id }));
    if (!itens.length) return;
    const bruto = pend.filter((e) => itens.some((i) => i.execucao_id === e.id)).reduce((s, e) => s + Number(e.valor), 0);
    const nota = await api('POST', `/api/contratos/${c.id}/notas`, {
      numero, serie: '1', data_emissao: dias(emissao), data_vencimento: dias(vencimento),
      iss: dinheiro(bruto * 0.03), inss: dinheiro(bruto * 0.035), irrf: dinheiro(bruto * 0.012), outras_retencoes: dinheiro(bruto * 0.0465),
      categoria_id: cat('1.1'), itens,
    });
    if (recebida) {
      const n = (await api('GET', `/api/contratos/${c.id}/notas`)).find((x) => x.numero === numero);
      await baixar(n.lancamento_id, banco.bb, dias(recebida));
    }
    return nota;
  }
  await faturar(cPav, '2026/0101', 110, 140, -108, -78, -76);
  await faturar(cPav, '2026/0134', 80, 109, -78, -48, -45);
  await faturar(cPav, '2026/0172', 50, 79, -48, -18, -16);
  await faturar(cPav, '2026/0205', 20, 49, -18, 12, null);
  await faturar(cEscola, '2026/0118', 55, 90, -55, -25, -22);
  await faturar(cEscola, '2026/0190', 25, 54, -25, 5, null);
  await faturar(cRede, '2026/0160', 20, 60, -20, -3, null);
  console.log('Notas fiscais registradas (contas a receber geradas)');

  // outras receitas: locação de equipamento a terceiros
  const loc = await receber({ pessoa_id: forn.locadora, categoria_id: cat('1.2'), centro_custo_id: ccAdm, descricao: 'Locação da motoniveladora - setembro', documento: 'Fat 0091', data_vencimento: dias(-50), valor: '24500.00' });
  await baixar(loc.id, banco.itau, dias(-48));
  await receber({ pessoa_id: forn.locadora, categoria_id: cat('1.2'), centro_custo_id: ccAdm, descricao: 'Locação da motoniveladora - outubro', documento: 'Fat 0104', data_vencimento: dias(-12), valor: '24500.00' });
  await receber({ pessoa_id: forn.locadora, categoria_id: cat('1.2'), centro_custo_id: ccAdm, descricao: 'Locação da motoniveladora - novembro', documento: 'Fat 0117', data_vencimento: dias(15), valor: '24500.00' });
  const rend = await receber({ pessoa_id: forn.contador, categoria_id: cat('5.2'), centro_custo_id: ccAdm, descricao: 'Rendimento de aplicação CDB', data_vencimento: dias(-16), valor: '3870.45' });
  await baixar(rend.id, banco.itau, dias(-16));

  console.log('\nDemonstração pronta. Abra o sistema e confira o Painel.');
}

main().catch((e) => { console.error(`Falha na demonstração: ${e.message}`); process.exitCode = 1; });
