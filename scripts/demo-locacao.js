// Complementa a demonstração com locação de equipamentos e apontamento diário da frota:
// receita por dia de cada equipamento, clientes particulares, locações em todas as situações
// e o uso diário (obra própria, parado, manutenção) das últimas semanas.
// Uso: com o sistema rodando, "npm run demo:locacao" (ou: node scripts/demo-locacao.js http://localhost:3000)
// Rode depois do "npm run demo". Não roda duas vezes na mesma empresa.
require('dotenv').config();

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3000}`;
let token = null;
let empresaId = null;

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

const HOJE = new Date();
HOJE.setHours(12, 0, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dias = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return iso(d); };
const diaSemana = (s) => new Date(`${s}T12:00:00`).getDay();
// próxima segunda-feira a partir de um deslocamento (para as locações caírem em semanas cheias)
const segunda = (n) => { let k = n; while (diaSemana(dias(k)) !== 1) k += 1; return k; };

let semente = 7;
const aleat = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };

// documentos com dígitos verificadores válidos
function digitos(base, pesos) { const s = base.split('').reduce((t, c, i) => t + Number(c) * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; }
const cpf = (b) => { const d1 = digitos(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return b + d1 + digitos(b + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]); };
const cnpj = (b) => { const d1 = digitos(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return b + d1 + digitos(b + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); };

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

  if ((await api('GET', '/api/locacoes?por_pagina=1')).total > 0) throw new Error('Esta empresa já tem locações; a demonstração de locação não foi aplicada de novo.');
  const eqs = (await api('GET', '/api/equipamentos?por_pagina=50&ativo=1')).dados;
  if (!eqs.length) throw new Error('Rode primeiro o "npm run demo" (não há equipamentos).');
  const centros = (await api('GET', '/api/centros-custo?por_pagina=50&ativo=1')).dados.filter((c) => c.codigo !== 'ADM');

  // ---------- receita por dia ----------
  const RECEITA = { VEICULO: [1400, 1100, 350], MAQUINA: [2200, 2000, 1100, 1300] };
  const usados = { VEICULO: 0, MAQUINA: 0 };
  for (const e of eqs) {
    const lista = RECEITA[e.tipo];
    e.receita_dia = (lista[usados[e.tipo]++] || lista[lista.length - 1]).toFixed(2);
    await api('PUT', `/api/equipamentos/${e.id}`, { receita_dia: e.receita_dia });
  }
  console.log(`Receita por dia cadastrada em ${eqs.length} equipamentos`);
  const maq = eqs.filter((e) => e.tipo === 'MAQUINA');
  const [esc, moto, retro, rolo] = [maq[0], maq[1] || maq[0], maq[2] || maq[0], maq[3] || maq[0]];

  // ---------- clientes particulares ----------
  const pessoa = async (nome, documento, cidade, telefone, endereco) =>
    ({ ...(await api('POST', '/api/pessoas', { nome, tipo: 'CLIENTE', documento, cidade, uf: 'PR', telefone, email: null })), cidade, endereco });
  const cli = {
    alfa: await pessoa('Alfa Empreendimentos Imobiliários Ltda', cnpj('412233440001'), 'Curitiba', '(41) 3029-4400', 'Av. Sete de Setembro, 4200, sala 1203, Batel'),
    joao: await pessoa('João Carlos Pereira', cpf('418392057'), 'São José dos Pinhais', '(41) 99812-3344', 'Rua Joinville, 1550, Centro'),
    terra: await pessoa('Terraplenagem Vale Verde Ltda', cnpj('287766550001'), 'Araucária', '(41) 3643-2211', 'Rod. do Xisto, km 18'),
    cond: await pessoa('Condomínio Residencial Bosque das Araucárias', cnpj('339988770001'), 'Campo Largo', '(41) 3292-8800', 'Rua das Palmeiras, 300'),
  };
  console.log('4 clientes particulares cadastrados');

  // ---------- locações ----------
  const loc = async (c, eq, ini, fim, extra) => api('POST', '/api/locacoes', {
    cliente_id: c.id, equipamento_id: eq.id, data_inicio: dias(ini), data_fim: dias(fim),
    valor_diaria: eq.receita_dia, combustivel: 'LOCATARIO', cliente_endereco: `${c.endereco} - ${c.cidade}/PR`, cidade: c.cidade, uf: 'PR', ...extra,
  });
  const confirmar = (l, venc) => api('POST', `/api/locacoes/${l.id}/confirmar`, { data_vencimento: venc });
  const criadas = [];

  // 1. concluída há ~6 semanas, com horas excedentes
  const s1 = segunda(-45);
  const l1 = await loc(cli.alfa, retro, s1, s1 + 4, {
    endereco: 'Rua Desembargador Motta, 1800 - Mercês (obra Ed. Mirante)', valor_deslocamento: '450.00',
    com_operador: true, valor_operador_dia: '280.00', franquia_horas_dia: '8.0', valor_hora_excedente: '150.00',
    caucao: '2000.00', responsavel: 'Eng. Marcos Lima', telefone: '(41) 99701-2020',
  });
  await confirmar(l1, dias(s1 + 9));
  const ini1 = Number(retro.leitura_atual) - 160;
  await api('POST', `/api/locacoes/${l1.id}/concluir`, { leitura_inicio: ini1.toFixed(1), leitura_fim: (ini1 + 48).toFixed(1), data_vencimento_excedente: dias(s1 + 14) });
  criadas.push('concluída com 8 h excedentes');

  // 2. concluída há ~4 semanas, sem franquia, combustível cobrado
  const s2 = segunda(-31);
  const l2 = await loc(cli.terra, rolo, s2, s2 + 4, {
    endereco: 'Loteamento Jardim das Acácias - Araucária', valor_deslocamento: '600.00',
    combustivel: 'COBRADO', valor_combustivel: '850.00', desconto: '300.00', responsavel: 'Sr. Valdir', telefone: '(41) 99655-1188',
  });
  await confirmar(l2, dias(s2 + 10));
  await api('POST', `/api/locacoes/${l2.id}/concluir`, {});
  criadas.push('concluída sem franquia');

  // 3. concluída há 2 semanas, dentro da franquia
  const s3 = segunda(-15);
  const l3 = await loc(cli.joao, retro, s3, s3 + 3, {
    endereco: 'Rua Joinville, 1550 - Centro (residência)', valor_deslocamento: '300.00',
    franquia_horas_dia: '8.0', valor_hora_excedente: '150.00', combustivel: 'INCLUSO', valor_diaria: '1250.00',
  });
  await confirmar(l3, dias(s3 + 7));
  const ini3 = Number(retro.leitura_atual) - 60;
  await api('POST', `/api/locacoes/${l3.id}/concluir`, { leitura_inicio: ini3.toFixed(1), leitura_fim: (ini3 + 29).toFixed(1) });
  criadas.push('concluída dentro da franquia');

  // 4. confirmada, em andamento hoje (escavadeira com operador)
  const l4 = await loc(cli.alfa, esc, -4, 5, {
    endereco: 'Av. Manoel Ribas, 6500 - Santa Felicidade (obra Res. Vista Verde)', dias_cobrados: 8, valor_deslocamento: '1200.00',
    com_operador: true, valor_operador_dia: '320.00', franquia_horas_dia: '9.0', valor_hora_excedente: '260.00',
    caucao: '5000.00', responsavel: 'Eng. Marcos Lima', telefone: '(41) 99701-2020',
    observacao: 'Locatário fornece local coberto para guarda da máquina durante a noite.',
  });
  await confirmar(l4, dias(10));
  await api('PUT', `/api/locacoes/${l4.id}`, { leitura_inicio: Number(esc.leitura_atual).toFixed(1) });
  criadas.push('confirmada em andamento');

  // 5 e 6. reservadas para as próximas semanas
  const s5 = segunda(7);
  await loc(cli.cond, moto, s5, s5 + 4, { endereco: 'Rua das Palmeiras, 300 - Campo Largo (vias internas)', valor_deslocamento: '900.00', com_operador: true, valor_operador_dia: '300.00', franquia_horas_dia: '8.0', valor_hora_excedente: '240.00', caucao: '3000.00' });
  const s6 = segunda(14);
  await loc(cli.terra, rolo, s6, s6 + 9, { endereco: 'Loteamento Jardim das Acácias - Araucária (2ª etapa)', valor_deslocamento: '600.00', desconto: '1000.00' });
  criadas.push('2 reservadas');

  // 7. cancelada
  const l7 = await loc(cli.joao, moto, segunda(-8), segunda(-8) + 1, { endereco: 'Rua Joinville, 1550 - Centro' });
  await api('POST', `/api/locacoes/${l7.id}/cancelar`);
  criadas.push('1 cancelada');
  console.log(`Locações: ${criadas.join(', ')}`);

  // ---------- apontamento diário (últimos ~45 dias até hoje) ----------
  const cal = await api('GET', `/api/locacoes/calendario?de=${dias(-46)}&ate=${dias(0)}`);
  const locado = (eqId, d) => cal.locacoes.some((l) => l.equipamento_id === eqId && l.data_inicio <= d && l.data_fim >= d);
  // perfil de uso: chance de estar em obra própria; o rolo e a motoniveladora ficam mais parados
  const uso = (e) => (e.id === rolo.id ? 0.45 : e.id === moto.id ? 0.6 : e.tipo === 'VEICULO' ? 0.88 : 0.75);
  let total = 0;
  for (let n = -46; n <= 0; n += 1) {
    const d = dias(n);
    const ds = diaSemana(d);
    if (ds === 0) continue;
    const itens = [];
    for (const e of eqs) {
      if (locado(e.id, d)) continue;
      const r = aleat();
      if (ds === 6) { if (r < 0.25 && centros.length) itens.push({ equipamento_id: e.id, situacao: 'TRABALHANDO', centro_custo_id: centros[e.id % centros.length].id, horas: '4.0' }); continue; }
      if (r < 0.05 && n < -1) continue; // alguns dias ficam sem apontamento
      let situacao = 'PARADO';
      if (r < uso(e)) situacao = 'TRABALHANDO';
      else if (r > 0.95) situacao = 'MANUTENCAO';
      itens.push({
        equipamento_id: e.id, situacao,
        centro_custo_id: situacao === 'TRABALHANDO' ? centros[Math.abs(e.id + Math.floor(n / 10)) % centros.length].id : null,
        horas: situacao === 'TRABALHANDO' ? (7 + Math.round(aleat() * 3)).toFixed(1) : null,
        observacao: situacao === 'MANUTENCAO' ? 'Troca de mangueira hidráulica' : situacao === 'PARADO' && aleat() < 0.3 ? 'Sem frente de serviço' : null,
      });
    }
    // feriado: 2 de novembro (Finados) e 15 de novembro, se caírem em dia útil, viram folga para todos
    if (d.endsWith('-11-02') || d.endsWith('-11-15') || d.endsWith('-10-12')) for (const i of itens) Object.assign(i, { situacao: 'FOLGA', centro_custo_id: null, horas: null, observacao: 'Feriado' });
    if (itens.length) { await api('POST', '/api/apontamentos/lote', { data: d, itens }); total += itens.length; }
  }
  console.log(`${total} apontamentos diários lançados`);

  const oc = await api('GET', '/api/frota/ociosidade');
  console.log(`Receita perdida no mês até hoje: R$ ${oc.totais.perda_parado}`);
  console.log('Pronto. Veja em Locação > Calendário da frota e Frota > Receita perdida.');
}

main().catch((e) => { console.error('Falhou:', e.message); process.exitCode = 1; });
