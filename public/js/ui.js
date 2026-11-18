import { api, baixar } from './api.js';

// Cria elementos sem innerHTML: todo texto vindo do banco entra como texto puro,
// então nada digitado num cadastro consegue virar código na tela (proteção contra XSS).
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

// Troca o conteúdo de um elemento. Aceita listas e ignora null/false (ao contrário de replaceChildren).
export function trocar(el, ...filhos) {
  el.replaceChildren(...filhos.flat(Infinity)
    .filter((f) => f !== null && f !== undefined && f !== false)
    .map((f) => (f instanceof Node ? f : document.createTextNode(String(f)))));
}

const nfDinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmt = {
  dinheiro: (v) => (v === null || v === undefined || v === '' ? '' : nfDinheiro.format(Number(v))),
  numero: (v, casas = 2) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })),
  pct: (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
  data: (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''),
  dataHora: (s) => (s ? `${fmt.data(s)} ${s.slice(11, 16)}` : ''),
  tamanho: (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`),
  rotulo: (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : ''),
};
export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "1.234,56" -> "1234.56" (o que a API espera); vazio -> null
export function paraPonto(texto) {
  const s = String(texto ?? '').trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  return s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
}
const paraVirgula = (v, casas) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { useGrouping: false, minimumFractionDigits: casas === 2 ? 2 : 0, maximumFractionDigits: casas }));

export function toast(mensagem, tipo = '') {
  const el = h('div', { class: `toast ${tipo}`, role: 'status' }, mensagem);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 3500);
}
export const avisarErro = (e) => { toast(e.message || 'Erro inesperado', 'erro'); if (!e.status) console.error(e); };

export function tag(texto, tipo = '') { return h('span', { class: `tag ${tipo}` }, texto); }

export function barra(percentual) {
  const i = h('i');
  i.style.width = `${Math.max(0, Math.min(100, Number(percentual) || 0))}%`;
  return h('div', { class: 'barra', title: fmt.pct(percentual) }, i);
}

export function modal(titulo, conteudo, { largo = false } = {}) {
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); };
  const esc = (ev) => { if (ev.key === 'Escape') fechar(); };
  const fundo = h('div', { class: 'fundo-modal' },
    h('div', { class: `modal${largo ? ' largo' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('header', {}, h('h2', {}, titulo), h('button', { class: 'mini', onclick: fechar, 'aria-label': 'Fechar' }, '✕')),
      conteudo));
  document.addEventListener('keydown', esc);
  document.body.append(fundo);
  const primeiro = fundo.querySelector('input, select, textarea');
  if (primeiro) primeiro.focus();
  return { fechar, no: fundo };
}

export function confirmar(mensagem, textoBotao = 'Confirmar') {
  return new Promise((resolver) => {
    const m = modal('Confirmação', h('div', {},
      h('p', {}, mensagem),
      h('div', { class: 'form' }, h('div', { class: 'rodape' },
        h('button', { onclick: () => { m.fechar(); resolver(false); } }, 'Cancelar'),
        h('button', { class: 'primario', onclick: () => { m.fechar(); resolver(true); } }, textoBotao)))));
  });
}

export function tabela(colunas, linhas, { classeLinha, vazio = 'Nenhum registro.' } = {}) {
  if (!linhas.length) return h('div', { class: 'painel vazio' }, vazio);
  return h('div', { class: 'rolagem' }, h('table', {},
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { class: c.classe }, c.rotulo)))),
    h('tbody', {}, linhas.map((l) => h('tr', { class: classeLinha ? classeLinha(l) : null },
      colunas.map((c) => h('td', { class: c.classe }, c.valor ? c.valor(l) : l[c.campo])))))));
}

// ---------- formulários ----------
// campo: { nome, rotulo, tipo, obrigatorio, opcoes, rota, texto, casas, largo, padrao }
// tipos: texto | textarea | inteiro | numero | dinheiro | data | datahora | select | remoto | bool | senha

const cacheRemoto = new Map();
export function limparCache() { cacheRemoto.clear(); }
export async function opcoesRemotas(rota) {
  if (!cacheRemoto.has(rota)) {
    cacheRemoto.set(rota, api('GET', rota, { por_pagina: 500 }).then((r) => r.dados || r).catch((e) => { cacheRemoto.delete(rota); throw e; }));
  }
  return cacheRemoto.get(rota);
}

function entrada(c, valor) {
  const v = valor ?? c.padrao ?? null;
  const req = c.obrigatorio ? true : null;
  switch (c.tipo) {
    case 'textarea': { const el = h('textarea', { required: req }); el.value = v ?? ''; return { no: el, valor: () => el.value.trim() || null }; }
    case 'inteiro': { const el = h('input', { type: 'number', step: '1', required: req, value: v ?? '' }); return { no: el, valor: () => (el.value === '' ? null : Number(el.value)) }; }
    case 'numero':
    case 'dinheiro': {
      const casas = c.tipo === 'dinheiro' ? 2 : c.casas || 2;
      const el = h('input', { type: 'text', inputmode: 'decimal', required: req, value: paraVirgula(v, casas), placeholder: '0,00' });
      return { no: el, valor: () => paraPonto(el.value) };
    }
    case 'data': { const el = h('input', { type: 'date', required: req, value: v ? String(v).slice(0, 10) : '' }); return { no: el, valor: () => el.value || null }; }
    case 'datahora': { const el = h('input', { type: 'datetime-local', required: req, value: v ? String(v).slice(0, 16).replace(' ', 'T') : '' }); return { no: el, valor: () => el.value || null }; }
    case 'bool': { const el = h('input', { type: 'checkbox' }); el.checked = v === null ? false : !!Number(v); return { no: el, valor: () => el.checked, check: true }; }
    case 'select': {
      const el = h('select', { required: req }, !c.obrigatorio || v === null ? h('option', { value: '' }, '') : null,
        c.opcoes.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, fmt.rotulo(o)))));
      el.value = v ?? '';
      return { no: el, valor: () => el.value || null };
    }
    case 'remoto': {
      const el = h('select', { required: req }, h('option', { value: '' }, 'Carregando…'));
      opcoesRemotas(c.rota).then((lista) => {
        trocar(el, h('option', { value: '' }, ''), ...lista.filter(c.filtro || (() => true)).map((o) => h('option', { value: o.id }, c.texto ? c.texto(o) : o.nome)));
        el.value = v ?? '';
      }).catch(() => trocar(el, h('option', { value: '' }, 'Sem permissão para listar')));
      return { no: el, valor: () => (el.value ? Number(el.value) : null) };
    }
    case 'senha': { const el = h('input', { type: 'password', required: req, autocomplete: 'new-password' }); return { no: el, valor: () => el.value || null }; }
    default: { const el = h('input', { type: c.tipo === 'email' ? 'email' : 'text', required: req, value: v ?? '', maxlength: c.max }); return { no: el, valor: () => el.value.trim() || null }; }
  }
}

// Monta o formulário, coleta os valores e mostra os erros de validação que a API devolver.
export function formulario(campos, valores, { aoSalvar, botao = 'Salvar', aoCancelar } = {}) {
  const entradas = {};
  const avisos = {};
  const btn = h('button', { class: 'primario', type: 'submit' }, botao);
  const form = h('form', { class: 'form', novalidate: null },
    campos.map((c) => {
      const e = entrada(c, valores ? valores[c.nome] : undefined);
      entradas[c.nome] = e;
      avisos[c.nome] = h('small', { class: 'erro' });
      const rotulo = h('span', {}, c.rotulo + (c.obrigatorio ? ' *' : ''));
      return h('label', { 'data-campo': c.nome, class: `campo${c.largo || c.tipo === 'textarea' ? ' largo' : ''}${e.check ? ' check' : ''}` }, rotulo, e.no, avisos[c.nome]);
    }),
    h('div', { class: 'rodape' }, aoCancelar ? h('button', { type: 'button', onclick: aoCancelar }, 'Cancelar') : null, btn));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    for (const a of Object.values(avisos)) a.textContent = '';
    const dados = {};
    for (const c of campos) dados[c.nome] = entradas[c.nome].valor();
    btn.disabled = true;
    try {
      await aoSalvar(dados);
    } catch (e) {
      for (const [campo, msg] of Object.entries(e.detalhes || {})) if (avisos[campo]) avisos[campo].textContent = msg;
      avisarErro(e);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

// Lista, envio, download e exclusão de anexos de um registro (edital, certidão, contrato...).
export function anexos(entidade, entidadeId, podeEditar) {
  const lista = h('div');
  const arquivo = h('input', { type: 'file', accept: '.pdf,.xlsx,.docx,.png,.jpg,.jpeg' });
  const carregar = async () => {
    const itens = await api('GET', '/api/arquivos', { entidade, entidade_id: entidadeId });
    trocar(lista, tabela([
      { rotulo: 'Arquivo', valor: (a) => h('a', { onclick: () => baixar(`/api/arquivos/${a.id}/download`, a.nome_original).catch(avisarErro) }, a.nome_original) },
      { rotulo: 'Tamanho', classe: 'num', valor: (a) => fmt.tamanho(a.tamanho) },
      { rotulo: 'Enviado em', valor: (a) => fmt.dataHora(a.criado_em) },
      { rotulo: 'Por', campo: 'criado_por_nome' },
      { rotulo: '', classe: 'acoes', valor: (a) => (podeEditar ? h('button', { class: 'mini perigo', onclick: async () => {
        if (!(await confirmar(`Excluir o arquivo "${a.nome_original}"?`, 'Excluir'))) return;
        api('DELETE', `/api/arquivos/${a.id}`).then(carregar).catch(avisarErro);
      } }, 'Excluir') : null) },
    ], itens, { vazio: 'Nenhum anexo.' }));
  };
  const enviar = async () => {
    if (!arquivo.files[0]) return toast('Escolha um arquivo', 'erro');
    const fd = new FormData();
    fd.append('entidade', entidade);
    fd.append('entidade_id', entidadeId);
    fd.append('arquivo', arquivo.files[0]);
    try { await api('POST', '/api/arquivos', fd); arquivo.value = ''; toast('Arquivo enviado', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
    return null;
  };
  carregar().catch(avisarErro);
  return h('div', {},
    podeEditar ? h('div', { class: 'filtros' }, h('label', {}, 'Novo anexo (PDF, XLSX, DOCX, PNG ou JPG, até 20 MB)', arquivo), h('button', { class: 'primario', onclick: enviar }, 'Enviar')) : null,
    lista);
}
