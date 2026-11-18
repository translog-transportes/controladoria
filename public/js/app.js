import { api, estado, pode, aplicarSessao, limparSessao, escolherEmpresa } from './api.js';
import { h, trocar, fmt, tag, tabela, modal, formulario, toast, avisarErro, limparCache, hoje } from './ui.js';
import * as telas from './telas.js';
import * as fin from './financeiro.js';
import * as contratos from './contratos.js';
import * as adm from './admin.js';
import * as loc from './locacao.js';

const app = document.getElementById('app');

// ---------- painel inicial ----------
async function painel(raiz) {
  const blocos = [];
  const ignorar = () => null;

  if (pode('relatorios.ver')) {
    const [r, s] = await Promise.all([api('GET', '/api/relatorios/resumo'), api('GET', '/api/relatorios/saldos')]);
    blocos.push(h('div', { class: 'cartoes' },
      h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Saldo em contas'), h('div', { class: `valor${Number(s.saldo_total) < 0 ? ' erro' : ''}` }, fmt.dinheiro(s.saldo_total))),
      h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'A pagar vencido'), h('div', { class: `valor${Number(r.pagar.vencido) > 0 ? ' erro' : ''}` }, fmt.dinheiro(r.pagar.vencido)), h('div', { class: 'nota' }, `Hoje: ${fmt.dinheiro(r.pagar.hoje)} · 7 dias: ${fmt.dinheiro(r.pagar.proximos_7_dias)}`)),
      h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'A receber vencido'), h('div', { class: 'valor' }, fmt.dinheiro(r.receber.vencido)), h('div', { class: 'nota' }, `Hoje: ${fmt.dinheiro(r.receber.hoje)} · 7 dias: ${fmt.dinheiro(r.receber.proximos_7_dias)}`)),
      h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Total a pagar'), h('div', { class: 'valor' }, fmt.dinheiro(r.pagar.total_aberto))),
      h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Total a receber'), h('div', { class: 'valor ok' }, fmt.dinheiro(r.receber.total_aberto)))));
  }
  if (pode('contratos.ver')) {
    const r = await api('GET', '/api/contratos', { status: 'ATIVO', por_pagina: 20 }).catch(ignorar);
    if (r && r.dados.length) {
      blocos.push(h('h2', {}, 'Obras em andamento'), tabela([
        { rotulo: 'Contrato', valor: (c) => h('a', { href: `#/contrato/${c.id}` }, c.numero) }, { rotulo: 'Cliente', campo: 'cliente_nome' },
        { rotulo: 'Planilha', classe: 'num', valor: (c) => fmt.dinheiro(c.valor_planilha) }, { rotulo: 'Executado', classe: 'num', valor: (c) => fmt.dinheiro(c.valor_executado) },
        { rotulo: 'Evolução', valor: (c) => fmt.pct(Number(c.valor_planilha) > 0 ? (Number(c.valor_executado) / Number(c.valor_planilha)) * 100 : 0) },
      ], r.dados));
    }
  }
  if (pode('licitacoes.ver')) {
    const [lic, docs] = await Promise.all([
      api('GET', '/api/licitacoes', { de: new Date().toISOString().slice(0, 10), por_pagina: 50 }).catch(ignorar),
      api('GET', '/api/documentos', { vencendo_em: 30, por_pagina: 20 }).catch(ignorar),
    ]);
    if (lic && lic.dados.length) {
      blocos.push(h('h2', {}, 'Próximas licitações'), tabela([
        { rotulo: 'Abertura', valor: (l) => fmt.dataHora(l.data_abertura) }, { rotulo: 'Processo', campo: 'numero_processo' }, { rotulo: 'Órgão', campo: 'orgao_nome' },
        { rotulo: 'Situação', valor: (l) => tag(fmt.rotulo(l.status), 'info') },
      ], [...lic.dados].reverse()));
    }
    if (docs && docs.dados.length) {
      blocos.push(h('h2', {}, 'Documentos vencidos ou vencendo em 30 dias'), tabela([
        { rotulo: 'Documento', campo: 'nome' }, { rotulo: 'Validade', valor: (d) => fmt.data(d.data_validade) }, { rotulo: 'Situação', valor: telas.validade },
      ], docs.dados));
    }
  }
  if (pode('locacoes.ver') || pode('locacoes.editar')) {
    const hojeTxt = hoje();
    const r = await api('GET', '/api/locacoes', { ate: hojeTxt, de: hojeTxt, por_pagina: 50 }).catch(ignorar);
    const ativas = r ? r.dados.filter((l) => l.status === 'RESERVADA' || l.status === 'CONFIRMADA') : [];
    if (ativas.length) {
      blocos.push(h('h2', {}, 'Equipamentos locados hoje'), tabela([
        { rotulo: 'Nº', campo: 'numero' }, { rotulo: 'Equipamento', campo: 'equipamento_nome' }, { rotulo: 'Cliente', campo: 'cliente_nome' },
        { rotulo: 'Até', valor: (l) => fmt.data(l.data_fim) }, { rotulo: 'Local', valor: (l) => [l.endereco, l.cidade].filter(Boolean).join(' · ') },
      ], ativas));
    }
  }
  if (pode('frota.ver')) {
    const oc = await api('GET', '/api/frota/ociosidade').catch(ignorar);
    if (oc && Number(oc.totais.perda_parado) > 0) {
      blocos.push(h('div', { class: 'cartoes' },
        h('a', { class: 'cartao', href: '#/ociosidade' }, h('div', { class: 'rotulo' }, 'Receita perdida no mês (frota parada)'), h('div', { class: 'valor erro' }, fmt.dinheiro(oc.totais.perda_parado)),
          h('div', { class: 'nota' }, `${oc.equipamentos.reduce((s, e) => s + e.dias_parados, 0)} dia(s) parados somando a frota`))));
    }
    const alertas = await api('GET', '/api/frota/alertas').catch(ignorar);
    if (alertas && alertas.length) {
      blocos.push(h('h2', {}, 'Manutenções da frota'), tabela([
        { rotulo: 'Equipamento', campo: 'equipamento_nome' }, { rotulo: 'Serviço', campo: 'descricao' },
        { rotulo: 'Situação', valor: (a) => tag(a.vencido ? 'Vencida' : 'Próxima', a.vencido ? 'erro' : 'alerta') },
      ], alertas));
    }
  }
  trocar(raiz, h('div', { class: 'cabecalho' }, h('h1', {}, estado.empresa.nome_fantasia || estado.empresa.razao_social)),
    blocos.length ? blocos : h('div', { class: 'painel vazio' }, 'Use o menu para começar.'));
}

// ---------- menu e rotas ----------
// [grupo, rótulo, rota, permissão, tela]
const MENU = [
  ['', 'Painel', '#/painel', null, painel],
  ['Financeiro', 'Contas a pagar', '#/pagar', 'financeiro.ver', fin.contas('PAGAR')],
  ['Financeiro', 'Contas a receber', '#/receber', 'financeiro.ver', fin.contas('RECEBER')],
  ['Financeiro', 'Fluxo de caixa', '#/fluxo', 'relatorios.ver', fin.fluxoCaixa],
  ['Financeiro', 'DRE', '#/dre', 'relatorios.ver', fin.dre],
  ['Licitações', 'Licitações', '#/licitacoes', 'licitacoes.ver', telas.licitacoes],
  ['Licitações', 'Documentos', '#/documentos', 'licitacoes.ver', telas.documentos],
  ['Obras', 'Contratos e obras', '#/contratos', 'contratos.ver', contratos.lista],
  ['Frota', 'Veículos e máquinas', '#/equipamentos', 'frota.ver', telas.equipamentos],
  ['Frota', 'Abastecimentos', '#/abastecimentos', 'frota.ver', telas.abastecimentos],
  ['Frota', 'Consumo e custo', '#/consumo', 'frota.ver', adm.consumo],
  ['Frota', 'Planos de manutenção', '#/planos', 'frota.ver', telas.planos],
  ['Frota', 'Manutenções', '#/manutencoes', 'frota.ver', telas.manutencoes],
  ['Frota', 'Receita perdida', '#/ociosidade', 'frota.ver', loc.ociosidade],
  ['Locação', 'Calendário da frota', '#/calendario', ['frota.ver', 'locacoes.ver', 'locacoes.editar'], loc.calendario],
  ['Locação', 'Locações', '#/locacoes', ['locacoes.ver', 'locacoes.editar'], loc.locacoes],
  ['Cadastros', 'Clientes e fornecedores', '#/pessoas', 'cadastros.ver', telas.pessoas],
  ['Cadastros', 'Plano de contas', '#/categorias', 'cadastros.ver', telas.categorias],
  ['Cadastros', 'Centros de custo', '#/centros-custo', 'cadastros.ver', telas.centrosCusto],
  ['Cadastros', 'Contas bancárias', '#/contas-bancarias', 'cadastros.ver', telas.contasBancarias],
  ['Administração', 'Usuários', '#/usuarios', 'usuarios.gerenciar', adm.usuarios],
  ['Administração', 'Perfis de acesso', '#/perfis', 'usuarios.gerenciar', adm.perfis],
  ['Administração', 'Auditoria', '#/auditoria', 'auditoria.ver', adm.auditoria],
];
const visivel = ([, , , permissao]) => !permissao || [].concat(permissao).some((p) => pode(p));

function montarLayout() {
  const conteudo = h('main', { class: 'conteudo' });
  const itens = MENU.filter(visivel);
  let grupo = null;
  const nav = h('nav', { class: 'menu', 'aria-label': 'Menu principal' }, h('div', { class: 'marca' }, 'ERP Construtoras'));
  for (const [g, rotulo, rota] of itens) {
    if (g !== grupo && g) nav.append(h('div', { class: 'grupo' }, g));
    grupo = g;
    nav.append(h('a', { href: rota, 'data-rota': rota, onclick: () => nav.classList.remove('aberto') }, rotulo));
  }
  if (estado.usuario.super_admin) nav.append(h('div', { class: 'grupo' }, 'Sistema'), h('a', { href: '#/empresas', 'data-rota': '#/empresas', onclick: () => nav.classList.remove('aberto') }, 'Empresas (clientes)'));

  const seletor = h('select', { 'aria-label': 'Empresa', onchange: (ev) => { escolherEmpresa(ev.target.value); limparCache(); window.location.hash = '#/painel'; iniciar(); } },
    estado.empresas.map((e) => h('option', { value: e.id }, e.nome_fantasia || e.razao_social)));
  seletor.value = estado.empresa.id;

  trocar(app, h('div', { class: 'layout' }, nav,
    h('div', { class: 'principal' },
      h('header', { class: 'topo' },
        h('button', { class: 'abrir-menu', onclick: () => nav.classList.toggle('aberto') }, '☰ Menu'),
        seletor, h('span', { class: 'usuario' }, `${estado.usuario.nome} · ${estado.empresa.perfil}`),
        h('button', { onclick: trocarSenha }, 'Trocar senha'), h('button', { onclick: sair }, 'Sair')),
      conteudo)));
  return { conteudo, nav };
}

let layout = null;
async function navegar() {
  if (!layout) return;
  const rota = window.location.hash || '#/painel';
  const { conteudo, nav } = layout;
  let tela = null;
  let ativa = rota;
  const contrato = /^#\/contrato\/(\d+)$/.exec(rota);
  const contratoLoc = /^#\/locacao\/(\d+)\/contrato$/.exec(rota);
  if (contrato && pode('contratos.ver')) { tela = (r) => contratos.detalhe(r, contrato[1]); ativa = '#/contratos'; }
  else if (contratoLoc && (pode('locacoes.ver') || pode('locacoes.editar'))) { tela = (r) => loc.contrato(r, contratoLoc[1]); ativa = '#/locacoes'; }
  else if (rota === '#/empresas' && estado.usuario.super_admin) tela = adm.empresas;
  else { const item = MENU.filter(visivel).find((m) => m[2] === rota); tela = item ? item[4] : null; }
  if (!tela) { window.location.hash = '#/painel'; return; }

  for (const a of nav.querySelectorAll('a')) a.classList.toggle('ativo', a.dataset.rota === ativa);
  trocar(conteudo, h('div', { class: 'vazio' }, 'Carregando…'));
  try { await tela(conteudo); } catch (e) { trocar(conteudo, h('div', { class: 'painel vazio' }, e.message || 'Não foi possível carregar a tela.')); if (!e.status) console.error(e); }
}

function semEmpresa() {
  const extra = estado.usuario.super_admin ? h('button', { class: 'primario', onclick: () => adm.empresas(caixa) }, 'Gerenciar empresas') : null;
  const caixa = h('div', { class: 'conteudo' },
    h('div', { class: 'painel vazio' }, 'Seu usuário ainda não tem acesso a nenhuma empresa ativa. Peça a um administrador para liberar.', h('p', {}, extra, ' ', h('button', { onclick: sair }, 'Sair'))));
  trocar(app, caixa);
}

function iniciar() {
  if (!estado.empresa) { layout = null; semEmpresa(); return; }
  layout = montarLayout();
  navegar();
}

// ---------- sessão ----------
function telaLogin(mensagem) {
  layout = null;
  const form = formulario([
    { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, largo: true },
    { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, largo: true },
  ], null, {
    botao: 'Entrar',
    aoSalvar: async (d) => { aplicarSessao(await api('POST', '/api/auth/login', d)); limparCache(); iniciar(); },
  });
  form.querySelector('input[type=password]').setAttribute('autocomplete', 'current-password');
  form.querySelector('input[type=email]').setAttribute('autocomplete', 'username');
  trocar(app, h('div', { class: 'login' }, h('div', { class: 'caixa' },
    h('h1', {}, 'ERP Construtoras'), h('p', {}, mensagem || 'Financeiro, licitações, obras e frota'), form)));
}

async function sair() {
  try { await api('POST', '/api/auth/logout'); } catch { /* sessão já encerrada */ }
  limparSessao();
  telaLogin();
}

function trocarSenha() {
  const m = modal('Trocar senha', formulario([
    { nome: 'senha_atual', rotulo: 'Senha atual', tipo: 'senha', obrigatorio: true, largo: true },
    { nome: 'senha_nova', rotulo: 'Nova senha (8+ caracteres, letras e números)', tipo: 'senha', obrigatorio: true, largo: true },
  ], null, {
    aoCancelar: () => m.fechar(),
    aoSalvar: async (d) => { await api('PUT', '/api/auth/senha', d); m.fechar(); toast('Senha alterada. Os outros dispositivos foram desconectados.', 'ok'); },
  }));
}

window.addEventListener('hashchange', () => navegar());
window.addEventListener('sessao-expirada', () => { limparSessao(); document.querySelectorAll('.fundo-modal').forEach((m) => m.remove()); telaLogin('Sua sessão expirou. Entre novamente.'); });

api('GET', '/api/auth/me')
  .then((dados) => { aplicarSessao(dados); iniciar(); })
  .catch((e) => { if (e.status !== 401) avisarErro(e); telaLogin(); });
