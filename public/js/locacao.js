import { api, pode, baixar } from './api.js';
import { h, trocar, fmt, tag, barra, tabela, modal, formulario, confirmar, toast, avisarErro, hoje, paraPonto, opcoesRemotas, limparCache } from './ui.js';

// Locação de equipamentos (calendário, locações, contrato) e receita perdida com a frota parada.

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map((u) => [u, u]);
const COMBUSTIVEL = [['LOCATARIO', 'Por conta do locatário'], ['INCLUSO', 'Incluso na diária'], ['COBRADO', 'Cobrado à parte']];
const STATUS = [['RESERVADA', 'Reservada'], ['CONFIRMADA', 'Confirmada'], ['CONCLUIDA', 'Concluída'], ['CANCELADA', 'Cancelada']];
const COR_STATUS = { RESERVADA: 'alerta', CONFIRMADA: 'info', CONCLUIDA: 'ok', CANCELADA: '' };
const SITUACOES = [['TRABALHANDO', 'Obra própria'], ['PARADO', 'Parado (sem serviço)'], ['MANUTENCAO', 'Em manutenção'], ['FOLGA', 'Folga / feriado']];
const de = (lista, v) => (lista.find((x) => x[0] === v) || [v, v])[1];
const textoEquip = (e) => `${e.nome}${e.placa ? ` (${e.placa})` : ''}`;
const podeApontar = () => pode('abastecimentos.lancar') || pode('frota.editar');
const somarDias = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const cent = (v) => Math.round(Number(v || 0) * 100);

// ---------- formulário da locação ----------
const CAMPOS_TEXTO = [
  { nome: 'endereco', rotulo: 'Endereço da obra (local de uso)', obrigatorio: true, largo: true, max: 200 },
  { nome: 'cidade', rotulo: 'Cidade', max: 80 }, { nome: 'uf', rotulo: 'UF', tipo: 'select', opcoes: UFS },
  { nome: 'cliente_endereco', rotulo: 'Endereço do locatário (sai no contrato)', largo: true, max: 200 },
  { nome: 'responsavel', rotulo: 'Contato do cliente na obra', max: 120 }, { nome: 'telefone', rotulo: 'Telefone do contato', max: 30 },
  { nome: 'leitura_inicio', rotulo: 'Leitura na entrega (horímetro ou km)', tipo: 'numero', casas: 1 },
  { nome: 'observacao', rotulo: 'Condições especiais (saem no contrato)', tipo: 'textarea' },
];
const CAMPOS_VALOR = [
  { nome: 'cliente_id', rotulo: 'Cliente (locatário)', tipo: 'remoto', rota: '/api/pessoas?ativo=1', obrigatorio: true, largo: true },
  { nome: 'equipamento_id', rotulo: 'Equipamento', tipo: 'remoto', rota: '/api/equipamentos?ativo=1', texto: textoEquip, obrigatorio: true, largo: true },
  { nome: 'data_inicio', rotulo: 'Primeiro dia', tipo: 'data', obrigatorio: true }, { nome: 'data_fim', rotulo: 'Último dia', tipo: 'data', obrigatorio: true },
  { nome: 'dias_cobrados', rotulo: 'Diárias cobradas (vazio = todos os dias)', tipo: 'inteiro' },
  { nome: 'valor_diaria', rotulo: 'Valor da diária', tipo: 'dinheiro', obrigatorio: true },
  { nome: 'valor_deslocamento', rotulo: 'Deslocamento (mobilização + desmobilização)', tipo: 'dinheiro' },
  { nome: 'com_operador', rotulo: 'Com operador', tipo: 'bool' }, { nome: 'valor_operador_dia', rotulo: 'Valor do operador por dia', tipo: 'dinheiro' },
  { nome: 'franquia_horas_dia', rotulo: 'Franquia de horas por diária', tipo: 'numero', casas: 1 }, { nome: 'valor_hora_excedente', rotulo: 'Valor da hora excedente', tipo: 'dinheiro' },
  { nome: 'combustivel', rotulo: 'Combustível', tipo: 'select', opcoes: COMBUSTIVEL, obrigatorio: true, padrao: 'LOCATARIO' }, { nome: 'valor_combustivel', rotulo: 'Valor do combustível (se cobrado à parte)', tipo: 'dinheiro' },
  { nome: 'caucao', rotulo: 'Caução / garantia (não entra no total)', tipo: 'dinheiro' }, { nome: 'desconto', rotulo: 'Desconto', tipo: 'dinheiro' },
];

// linha: locação existente (ou null); preset: valores iniciais de uma nova locação
export function formLocacao(linha, preset, aoSalvar) {
  const reservada = !linha || linha.status === 'RESERVADA';
  const campos = reservada ? [...CAMPOS_VALOR, ...CAMPOS_TEXTO] : CAMPOS_TEXTO;
  const resumo = h('div', { class: 'painel resumo-locacao' });
  const form = formulario(campos, linha || { combustivel: 'LOCATARIO', ...preset }, {
    aoCancelar: () => m.fechar(),
    aoSalvar: async (d) => {
      const salvo = linha ? await api('PUT', `/api/locacoes/${linha.id}`, d) : await api('POST', '/api/locacoes', d);
      m.fechar();
      toast(linha ? 'Locação alterada' : `Locação nº ${salvo.numero} reservada`, 'ok');
      if (aoSalvar) await aoSalvar(salvo);
    },
  });
  const campo = (nome) => form.querySelector(`[data-campo=${nome}] input, [data-campo=${nome}] select, [data-campo=${nome}] textarea`);
  const valor = (nome) => { const el = campo(nome); if (!el) return null; return el.type === 'checkbox' ? el.checked : el.value; };

  const atualizar = () => {
    if (!reservada) return;
    const ini = valor('data_inicio');
    const fim = valor('data_fim');
    const corridos = ini && fim && fim >= ini ? diasEntre(ini, fim) : 0;
    const dias = Number(valor('dias_cobrados')) || corridos;
    const diarias = dias * cent(paraPonto(valor('valor_diaria')));
    const operador = valor('com_operador') ? dias * cent(paraPonto(valor('valor_operador_dia'))) : 0;
    const desl = cent(paraPonto(valor('valor_deslocamento')));
    const comb = valor('combustivel') === 'COBRADO' ? cent(paraPonto(valor('valor_combustivel'))) : 0;
    const desc = cent(paraPonto(valor('desconto')));
    const total = diarias + operador + desl + comb - desc;
    const r = (x) => fmt.dinheiro(x / 100);
    trocar(resumo,
      h('div', {}, `${corridos ? `${corridos} dia(s) no período · ` : ''}${dias} diária(s) × ${r(cent(paraPonto(valor('valor_diaria'))))} = ${r(diarias)}`),
      operador ? h('div', {}, `Operador: ${r(operador)}`) : null,
      desl ? h('div', {}, `Deslocamento: ${r(desl)}`) : null,
      comb ? h('div', {}, `Combustível: ${r(comb)}`) : null,
      desc ? h('div', {}, `Desconto: − ${r(desc)}`) : null,
      h('div', { class: 'total' }, `Total da locação: ${r(total)}`));
    campo('valor_operador_dia').closest('label').classList.toggle('oculto', !valor('com_operador'));
    campo('valor_combustivel').closest('label').classList.toggle('oculto', valor('combustivel') !== 'COBRADO');
  };

  if (reservada) {
    form.insertBefore(resumo, form.querySelector('.rodape'));
    form.addEventListener('input', atualizar);
    form.addEventListener('change', atualizar);
    // ao escolher o equipamento, sugere a diária pela receita por dia cadastrada nele
    campo('equipamento_id').addEventListener('change', async (ev) => {
      if (valor('valor_diaria')) return;
      const lista = await opcoesRemotas('/api/equipamentos?ativo=1');
      const eq = lista.find((e) => String(e.id) === ev.target.value);
      if (eq && eq.receita_dia) { campo('valor_diaria').value = Number(eq.receita_dia).toFixed(2).replace('.', ','); atualizar(); }
    });
    // ao mudar o primeiro dia, o último acompanha se estiver vazio ou antes dele
    campo('data_inicio').addEventListener('change', (ev) => { const fim = campo('data_fim'); if (!fim.value || fim.value < ev.target.value) fim.value = ev.target.value; atualizar(); });
    setTimeout(atualizar, 0);
  }
  const m = modal(linha ? `Locação nº ${linha.numero}` : 'Nova locação', h('div', {},
    reservada ? null : h('p', { class: 'vazio' }, 'Locação já confirmada: valores, datas e equipamento não mudam mais (a conta a receber já foi gerada). Para mudar, cancele e faça outra.'),
    form), { largo: true });
  return m;
}

function confirmarLocacao(l, depois) {
  const m = modal(`Confirmar locação nº ${l.numero}`, h('div', {},
    h('p', {}, `Gera a conta a receber de ${fmt.dinheiro(l.valor_total)} para ${l.cliente_nome}.`),
    formulario([
      { nome: 'data_vencimento', rotulo: 'Vencimento da cobrança', tipo: 'data', obrigatorio: true },
      { nome: 'categoria_id', rotulo: 'Categoria (padrão: Locação de equipamentos)', tipo: 'remoto', rota: '/api/categorias?ativo=1&tipo=RECEITA', texto: (c) => `${c.codigo} ${c.nome}`, filtro: (c) => !!c.parent_id },
    ], { data_vencimento: l.data_vencimento || l.data_fim }, {
      botao: 'Confirmar e gerar cobrança', aoCancelar: () => m.fechar(),
      aoSalvar: async (d) => { await api('POST', `/api/locacoes/${l.id}/confirmar`, d); m.fechar(); toast('Locação confirmada; conta a receber gerada', 'ok'); await depois(); },
    })));
}

function concluirLocacao(l, depois) {
  const franquia = l.franquia_horas_dia !== null && Number(l.valor_hora_excedente) > 0;
  const m = modal(`Devolução da locação nº ${l.numero}`, h('div', {},
    h('p', {}, franquia
      ? `Franquia: ${fmt.numero(l.franquia_horas_dia, 1)} h por diária × ${l.dias_cobrados} = ${fmt.numero(Number(l.franquia_horas_dia) * l.dias_cobrados, 1)} h. Hora excedente: ${fmt.dinheiro(l.valor_hora_excedente)}. Informe as leituras para calcular.`
      : 'Sem franquia de horas: as leituras são só para registro e atualizam o horímetro/hodômetro do equipamento.'),
    formulario([
      { nome: 'leitura_inicio', rotulo: 'Leitura na entrega', tipo: 'numero', casas: 1 },
      { nome: 'leitura_fim', rotulo: 'Leitura na devolução', tipo: 'numero', casas: 1 },
      franquia ? { nome: 'data_vencimento_excedente', rotulo: 'Vencimento das horas excedentes (se houver)', tipo: 'data' } : null,
    ].filter(Boolean), { leitura_inicio: l.leitura_inicio, data_vencimento_excedente: somarDias(hoje(), 7) }, {
      botao: 'Concluir locação', aoCancelar: () => m.fechar(),
      aoSalvar: async (d) => {
        const r = await api('POST', `/api/locacoes/${l.id}/concluir`, d);
        m.fechar();
        toast(Number(r.valor_excedente) > 0 ? `Concluída: ${fmt.numero(r.horas_excedentes, 1)} h excedentes cobradas (${fmt.dinheiro(r.valor_excedente)})` : 'Locação concluída', 'ok');
        await depois();
      },
    })));
}

async function cancelarLocacao(l, depois) {
  if (!(await confirmar(`Cancelar a locação nº ${l.numero}?${l.lancamento_id ? ' A conta a receber também será cancelada.' : ''} O equipamento fica livre no calendário.`, 'Cancelar locação'))) return;
  try { await api('POST', `/api/locacoes/${l.id}/cancelar`); toast('Locação cancelada', 'ok'); await depois(); } catch (e) { avisarErro(e); }
}

const baixarWord = (l) => baixar(`/api/locacoes/${l.id}/contrato.docx`, `contrato-locacao-${String(l.numero).padStart(4, '0')}.docx`).catch(avisarErro);

function acoesLocacao(l, depois) {
  const ed = pode('locacoes.editar');
  const ativa = l.status !== 'CANCELADA';
  return [
    ativa ? h('button', { class: 'mini', onclick: () => { window.location.hash = `#/locacao/${l.id}/contrato`; } }, 'Contrato') : null,
    ativa ? h('button', { class: 'mini', onclick: () => baixarWord(l) }, 'Word') : null,
    ed && l.status === 'RESERVADA' ? h('button', { class: 'mini primario', onclick: () => confirmarLocacao(l, depois) }, 'Confirmar') : null,
    ed && l.status === 'CONFIRMADA' ? h('button', { class: 'mini primario', onclick: () => concluirLocacao(l, depois) }, 'Devolução') : null,
    ed && ativa ? h('button', { class: 'mini', onclick: () => formLocacao(l, null, depois) }, 'Alterar') : null,
    ed && ['RESERVADA', 'CONFIRMADA'].includes(l.status) ? h('button', { class: 'mini perigo', onclick: () => cancelarLocacao(l, depois) }, 'Cancelar') : null,
  ];
}

function tagRecebimento(status, rotulo = '') {
  if (!status) return '';
  const cor = { ABERTO: 'info', PARCIAL: 'alerta', QUITADO: 'ok', CANCELADO: '' }[status];
  return tag(`${rotulo}${{ ABERTO: 'A receber', PARCIAL: 'Recebido em parte', QUITADO: 'Recebido', CANCELADO: 'Cancelada' }[status]}`, cor);
}

// ---------- tela: locações ----------
export async function locacoes(raiz) {
  const filtro = { pagina: 1, status: '', q: '' };
  const corpo = h('div');
  const rodape = h('div', { class: 'paginacao' });
  async function carregar() {
    const r = await api('GET', '/api/locacoes', { ...filtro, por_pagina: 50 });
    trocar(corpo, tabela([
      { rotulo: 'Nº', classe: 'num', campo: 'numero' },
      { rotulo: 'Cliente', valor: (l) => [l.cliente_nome, h('div', { class: 'nota' }, [l.endereco, l.cidade].filter(Boolean).join(' · '))] },
      { rotulo: 'Equipamento', valor: (l) => textoEquip({ nome: l.equipamento_nome, placa: l.equipamento_placa }) },
      { rotulo: 'Período', valor: (l) => `${fmt.data(l.data_inicio)} a ${fmt.data(l.data_fim)}` },
      { rotulo: 'Diárias', classe: 'num', campo: 'dias_cobrados' },
      { rotulo: 'Total', classe: 'num', valor: (l) => [fmt.dinheiro(l.valor_total), Number(l.valor_excedente) > 0 ? h('div', { class: 'nota' }, `+ ${fmt.dinheiro(l.valor_excedente)} excedente`) : null] },
      { rotulo: 'Situação', valor: (l) => tag(de(STATUS, l.status), COR_STATUS[l.status]) },
      { rotulo: 'Cobrança', valor: (l) => [tagRecebimento(l.recebimento_status), l.excedente_status ? [' ', tagRecebimento(l.excedente_status, 'Exc.: ')] : null] },
      { rotulo: '', classe: 'acoes', valor: (l) => acoesLocacao(l, carregar) },
    ], r.dados, { vazio: 'Nenhuma locação. Use "+ Nova locação" ou clique em um dia no Calendário da frota.' }));
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
    trocar(rodape, `${r.total} locação(ões)`,
      paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina <= 1, onclick: () => { filtro.pagina -= 1; carregar().catch(avisarErro); } }, '‹ Anterior') : null,
      paginas > 1 ? `Página ${filtro.pagina} de ${paginas}` : null,
      paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina >= paginas, onclick: () => { filtro.pagina += 1; carregar().catch(avisarErro); } }, 'Próxima ›') : null);
  }
  let espera;
  trocar(raiz,
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Locações de equipamentos'),
      h('button', { onclick: () => { window.location.hash = '#/calendario'; } }, 'Ver calendário'),
      pode('locacoes.editar') ? h('button', { class: 'primario', onclick: () => formLocacao(null, {}, carregar) }, '+ Nova locação') : null),
    h('p', { class: 'vazio' }, 'Reservada ocupa o calendário · Confirmada gera a conta a receber · Devolução registra o horímetro e cobra as horas excedentes.'),
    h('div', { class: 'filtros' },
      h('label', {}, 'Buscar', h('input', { type: 'search', placeholder: 'Cliente, endereço, equipamento ou nº', oninput: (ev) => { clearTimeout(espera); espera = setTimeout(() => { filtro.q = ev.target.value.trim(); filtro.pagina = 1; carregar().catch(avisarErro); }, 300); } })),
      h('label', {}, 'Situação', h('select', { onchange: (ev) => { filtro.status = ev.target.value; filtro.pagina = 1; carregar().catch(avisarErro); } }, h('option', { value: '' }, 'Todas'), STATUS.map(([v, t]) => h('option', { value: v }, t))))),
    corpo, rodape);
  await carregar();
}

// ---------- tela: calendário da frota ----------
const SIGLA = { LOCADO: 'L', TRABALHANDO: 'O', PARADO: 'P', MANUTENCAO: 'M', FOLGA: 'F', SEM: '' };
const CLASSE = { LOCADO: 'loc', TRABALHANDO: 'obra', PARADO: 'parado', MANUTENCAO: 'manut', FOLGA: 'folga', SEM: 'sem' };
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export async function calendario(raiz) {
  const agora = hoje();
  let ano = Number(agora.slice(0, 4));
  let mes = Number(agora.slice(5, 7)) - 1;
  let dados = null;
  const corpo = h('div');
  const titulo = h('strong', { class: 'mes' });

  const periodo = () => {
    const ini = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    const ult = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return { ini, fim: `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ult).padStart(2, '0')}`, ult };
  };

  function situacao(eqId, data) {
    const loc = dados.locacoes.find((l) => l.equipamento_id === eqId && l.data_inicio <= data && l.data_fim >= data);
    if (loc) return { s: 'LOCADO', loc };
    const ap = dados.apontamentos.find((a) => a.equipamento_id === eqId && a.data === data);
    if (ap) return { s: ap.situacao, ap };
    const dia = new Date(`${data}T12:00:00Z`).getUTCDay();
    return { s: data < dados.hoje && dia >= 1 && dia <= 5 ? 'SEM' : null };
  }

  async function carregar() {
    const { ini, fim, ult } = periodo();
    trocar(titulo, `${MESES[mes]} de ${ano}`);
    dados = await api('GET', '/api/locacoes/calendario', { de: ini, ate: fim });
    const dias = Array.from({ length: ult }, (_, i) => `${ini.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
    if (!dados.equipamentos.length) { trocar(corpo, h('div', { class: 'painel vazio' }, 'Cadastre os veículos e máquinas em Frota > Veículos e máquinas.')); return; }
    const cabeca = h('tr', {}, h('th', { class: 'fixa' }, 'Equipamento'), dias.map((d) => {
      const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
      return h('th', { class: `dia${dia === 0 || dia === 6 ? ' fds' : ''}${d === dados.hoje ? ' hoje' : ''}` }, h('div', {}, String(Number(d.slice(8)))), h('small', {}, SEMANA[dia]));
    }));
    const linhas = dados.equipamentos.map((eq) => h('tr', {},
      h('td', { class: 'fixa' }, h('div', {}, textoEquip(eq)), h('small', {}, eq.receita_dia ? `${fmt.dinheiro(eq.receita_dia)}/dia` : 'sem receita/dia')),
      dias.map((d) => {
        const r = situacao(eq.id, d);
        const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
        const dica = r.loc ? `Locação nº ${r.loc.numero} · ${r.loc.cliente_nome} · ${fmt.data(r.loc.data_inicio)} a ${fmt.data(r.loc.data_fim)} (${de(STATUS, r.loc.status)})`
          : r.ap ? `${de(SITUACOES, r.ap.situacao)}${r.ap.centro_custo_nome ? ` · ${r.ap.centro_custo_nome}` : ''}${r.ap.horas ? ` · ${fmt.numero(r.ap.horas, 1)} h` : ''}${r.ap.observacao ? ` · ${r.ap.observacao}` : ''}`
            : r.s === 'SEM' ? 'Dia útil sem apontamento (conta como parado)' : 'Livre';
        const cls = ['dia', r.s ? CLASSE[r.s] : '', dia === 0 || dia === 6 ? 'fds' : '', d === dados.hoje ? 'hoje' : '', r.loc && r.loc.status === 'RESERVADA' ? 'reservada' : ''].filter(Boolean).join(' ');
        return h('td', { class: cls, title: `${fmt.data(d)} · ${dica}`, onclick: () => clicar(eq, d, r) }, r.s ? SIGLA[r.s] : '');
      })));
    trocar(corpo, h('div', { class: 'rolagem calendario' }, h('table', {}, h('thead', {}, cabeca), h('tbody', {}, linhas))));
  }
  const recarregar = () => carregar().catch(avisarErro);

  function clicar(eq, data, r) {
    if (r.loc) {
      const l = r.loc;
      const m = modal(`Locação nº ${l.numero}`, h('div', {},
        h('p', {}, h('strong', {}, l.cliente_nome), ` · ${textoEquip(eq)}`),
        h('p', {}, `${fmt.data(l.data_inicio)} a ${fmt.data(l.data_fim)} · ${[l.endereco, l.cidade].filter(Boolean).join(', ')}`),
        h('p', {}, tag(de(STATUS, l.status), COR_STATUS[l.status])),
        h('div', { class: 'form' }, h('div', { class: 'rodape' },
          h('button', { onclick: () => { m.fechar(); window.location.hash = `#/locacao/${l.id}/contrato`; } }, 'Ver contrato'),
          h('button', { class: 'primario', onclick: () => { m.fechar(); window.location.hash = '#/locacoes'; } }, 'Ir para Locações')))));
      return;
    }
    const opcoes = [];
    if (podeApontar()) {
      opcoes.push(h('h3', {}, 'Apontar o dia'), formulario([
        { nome: 'situacao', rotulo: 'O que o equipamento fez', tipo: 'select', opcoes: SITUACOES, obrigatorio: true },
        { nome: 'centro_custo_id', rotulo: 'Obra (se em obra própria)', tipo: 'remoto', rota: '/api/centros-custo?ativo=1', texto: (c) => `${c.codigo} - ${c.nome}` },
        { nome: 'horas', rotulo: 'Horas trabalhadas', tipo: 'numero', casas: 1 },
        { nome: 'observacao', rotulo: 'Observação', max: 200 },
      ], r.ap || { situacao: 'TRABALHANDO' }, {
        botao: 'Salvar apontamento', aoCancelar: () => m.fechar(),
        aoSalvar: async (d) => { await api('PUT', '/api/apontamentos', { ...d, equipamento_id: eq.id, data }); m.fechar(); toast('Apontamento salvo', 'ok'); await carregar(); },
      }));
      if (r.ap) opcoes.push(h('p', {}, h('button', { class: 'mini perigo', onclick: async () => { try { await api('DELETE', `/api/apontamentos/${r.ap.id}`); m.fechar(); toast('Apontamento removido', 'ok'); await carregar(); } catch (e) { avisarErro(e); } } }, 'Remover apontamento deste dia')));
    }
    if (pode('locacoes.editar')) {
      opcoes.push(h('h3', {}, 'Locação'), h('p', {}, h('button', { class: 'primario', onclick: () => { m.fechar(); formLocacao(null, { equipamento_id: eq.id, data_inicio: data, data_fim: data, valor_diaria: eq.receita_dia }, () => { limparCache(); return carregar(); }); } }, '+ Nova locação começando neste dia')));
    }
    if (!opcoes.length) opcoes.push(h('p', { class: 'vazio' }, 'Seu perfil só permite consultar o calendário.'));
    const m = modal(`${textoEquip(eq)} · ${fmt.data(data)}`, h('div', {}, opcoes));
  }

  async function apontarDia() {
    const dataEl = h('input', { type: 'date', value: hoje() });
    const lista = h('div');
    const centros = await opcoesRemotas('/api/centros-custo?ativo=1');
    let linhas = [];
    const montar = async () => {
      const data = dataEl.value;
      if (!data) return;
      const cal = await api('GET', '/api/locacoes/calendario', { de: data, ate: data });
      linhas = cal.equipamentos.map((eq) => {
        const loc = cal.locacoes.find((l) => l.equipamento_id === eq.id);
        const ap = cal.apontamentos.find((a) => a.equipamento_id === eq.id);
        const sit = h('select', { disabled: !!loc }, h('option', { value: '' }, loc ? 'Locado' : '— não apontado —'), SITUACOES.map(([v, t]) => h('option', { value: v }, t)));
        sit.value = ap ? ap.situacao : '';
        const obra = h('select', {}, h('option', { value: '' }, ''), centros.map((c) => h('option', { value: c.id }, `${c.codigo} - ${c.nome}`)));
        obra.value = ap && ap.centro_custo_id ? String(ap.centro_custo_id) : '';
        const horas = h('input', { type: 'text', inputmode: 'decimal', value: ap && ap.horas ? String(ap.horas).replace('.', ',') : '', placeholder: 'h' });
        const mostrarObra = () => { obra.disabled = sit.value !== 'TRABALHANDO'; };
        sit.addEventListener('change', mostrarObra);
        mostrarObra();
        return { eq, loc, ap, sit, obra, horas };
      });
      trocar(lista, h('div', { class: 'rolagem' }, h('table', {}, h('thead', {}, h('tr', {}, ['Equipamento', 'Situação', 'Obra', 'Horas'].map((t) => h('th', {}, t)))),
        h('tbody', {}, linhas.map((x) => h('tr', {},
          h('td', {}, textoEquip(x.eq), x.loc ? h('div', { class: 'nota' }, `Locado para ${x.loc.cliente_nome} (nº ${x.loc.numero})`) : null),
          h('td', {}, x.sit), h('td', {}, x.loc ? '' : x.obra), h('td', {}, x.loc ? '' : x.horas)))))));
    };
    dataEl.addEventListener('change', () => montar().catch(avisarErro));
    const todos = h('select', { onchange: (ev) => { for (const x of linhas) if (!x.loc && ev.target.value) { x.sit.value = ev.target.value; x.sit.dispatchEvent(new Event('change')); } ev.target.value = ''; } },
      h('option', { value: '' }, 'Marcar todos como…'), SITUACOES.map(([v, t]) => h('option', { value: v }, t)));
    const m = modal('Apontar o dia', h('div', {},
      h('p', { class: 'vazio' }, 'Marque o que cada equipamento fez no dia. Dia útil sem apontamento conta como parado na receita perdida.'),
      h('div', { class: 'filtros' }, h('label', {}, 'Dia', dataEl), h('label', {}, 'Atalho', todos)),
      lista,
      h('div', { class: 'form' }, h('div', { class: 'rodape' },
        h('button', { onclick: () => m.fechar() }, 'Cancelar'),
        h('button', { class: 'primario', onclick: async () => {
          const itens = linhas.filter((x) => !x.loc && (x.sit.value || x.ap)).map((x) => ({
            equipamento_id: x.eq.id, situacao: x.sit.value || null,
            centro_custo_id: x.sit.value === 'TRABALHANDO' && x.obra.value ? Number(x.obra.value) : null,
            horas: paraPonto(x.horas.value),
          }));
          if (!itens.length) { toast('Nenhum equipamento apontado', 'erro'); return; }
          try { await api('POST', '/api/apontamentos/lote', { data: dataEl.value, itens }); m.fechar(); toast('Dia apontado', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
        } }, 'Salvar o dia')))), { largo: true });
    await montar();
  }

  const mudarMes = (n) => { mes += n; if (mes < 0) { mes = 11; ano -= 1; } if (mes > 11) { mes = 0; ano += 1; } recarregar(); };
  trocar(raiz,
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Calendário da frota'),
      podeApontar() ? h('button', { onclick: () => apontarDia().catch(avisarErro) }, 'Apontar o dia') : null,
      pode('locacoes.editar') ? h('button', { class: 'primario', onclick: () => formLocacao(null, {}, () => { limparCache(); return carregar(); }) }, '+ Nova locação') : null),
    h('div', { class: 'filtros' },
      h('button', { onclick: () => mudarMes(-1) }, '‹'), titulo, h('button', { onclick: () => mudarMes(1) }, '›'),
      h('button', { class: 'mini', onclick: () => { ano = Number(agora.slice(0, 4)); mes = Number(agora.slice(5, 7)) - 1; recarregar(); } }, 'Hoje')),
    h('div', { class: 'legenda' },
      h('span', { class: 'dia loc' }, 'L'), ' Locado ', h('span', { class: 'dia loc reservada' }, 'L'), ' Reservado ',
      h('span', { class: 'dia obra' }, 'O'), ' Obra própria ', h('span', { class: 'dia parado' }, 'P'), ' Parado ',
      h('span', { class: 'dia manut' }, 'M'), ' Manutenção ', h('span', { class: 'dia folga' }, 'F'), ' Folga ',
      h('span', { class: 'dia sem' }, ''), ' Dia útil sem apontamento'),
    corpo,
    h('p', { class: 'vazio' }, 'Clique em um dia para apontar o uso ou reservar uma locação. Passe o mouse para ver os detalhes.'));
  await carregar();
}

// ---------- tela: contrato (impressão) ----------
export async function contrato(raiz, id) {
  const [m, l] = await Promise.all([api('GET', `/api/locacoes/${id}/contrato`), api('GET', `/api/locacoes/${id}`)]);
  trocar(raiz,
    h('div', { class: 'cabecalho nao-imprimir' }, h('h1', {}, `Contrato da locação nº ${l.numero}`),
      h('button', { onclick: () => { window.location.hash = '#/locacoes'; } }, '‹ Voltar'),
      h('button', { onclick: () => baixarWord(l) }, 'Baixar Word (.docx)'),
      h('button', { class: 'primario', onclick: () => window.print() }, 'Imprimir / salvar PDF')),
    h('p', { class: 'vazio nao-imprimir' }, 'Modelo de contrato gerado com os dados da locação. Revise o texto com seu advogado antes do primeiro uso; no Word você pode ajustar o que quiser.'),
    h('article', { class: 'documento' },
      h('h1', {}, m.titulo), h('p', { class: 'centro' }, m.numero),
      m.partes.map((p) => h('p', {}, h('strong', {}, `${p.papel}: `), p.texto)),
      h('p', {}, 'As partes acima qualificadas celebram o presente contrato de locação, que se regerá pelas cláusulas e condições a seguir.'),
      h('table', {}, h('tbody', {}, m.resumo.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))))),
      h('h3', {}, 'QUADRO DE VALORES'),
      h('table', {}, h('thead', {}, h('tr', {}, ['Descrição', 'Qtd.', 'Valor unitário', 'Total'].map((t, i) => h('th', { class: i ? 'num' : null }, t)))),
        h('tbody', {}, m.valores.linhas.map((x) => h('tr', {}, x.map((c, i) => h('td', { class: i ? 'num' : null }, c)))),
          h('tr', { class: 'total' }, h('td', {}, 'VALOR TOTAL'), h('td', {}), h('td', {}), h('td', { class: 'num' }, m.valores.total)))),
      m.valores.caucao ? h('p', {}, `Caução (garantia, não incluída no total): ${m.valores.caucao}`) : null,
      m.clausulas.map((c) => [h('h3', {}, c.titulo), c.paragrafos.map((p) => h('p', {}, p))]),
      h('p', { class: 'direita' }, m.localData),
      h('div', { class: 'assinaturas' }, m.assinaturas.map((a) => h('div', {}, h('div', { class: 'linha' }), h('div', {}, a.nome), a.papel ? h('strong', {}, a.papel) : null)))));
}

// ---------- tela: receita perdida (ociosidade) ----------
export async function ociosidade(raiz) {
  const agora = hoje();
  const f = { de: `${agora.slice(0, 8)}01`, ate: agora, sabado: '' };
  const corpo = h('div');
  async function carregar() {
    const r = await api('GET', '/api/frota/ociosidade', f);
    const com = r.equipamentos.filter((e) => e.utilizacao !== null);
    const media = com.length ? com.reduce((s, e) => s + e.utilizacao, 0) / com.length : 0;
    const parados = r.equipamentos.reduce((s, e) => s + e.dias_parados, 0);
    trocar(corpo,
      h('div', { class: 'cartoes' },
        h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Receita perdida (dias parados)'), h('div', { class: `valor${Number(r.totais.perda_parado) > 0 ? ' erro' : ''}` }, fmt.dinheiro(r.totais.perda_parado))),
        h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Perda em manutenção'), h('div', { class: 'valor' }, fmt.dinheiro(r.totais.perda_manutencao))),
        h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Dias parados (soma da frota)'), h('div', { class: 'valor' }, String(parados))),
        h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Utilização média'), h('div', { class: 'valor' }, fmt.pct(media)), barra(media))),
      r.totais.sem_receita_dia ? h('p', { class: 'erro-texto' }, `${r.totais.sem_receita_dia} equipamento(s) sem "receita por dia" cadastrada não entram na receita perdida. Cadastre em Frota > Veículos e máquinas.`) : null,
      tabela([
        { rotulo: 'Equipamento', valor: (e) => textoEquip(e) },
        { rotulo: 'Receita/dia', classe: 'num', valor: (e) => (e.receita_dia ? fmt.dinheiro(e.receita_dia) : '—') },
        { rotulo: 'Locado', classe: 'num', campo: 'dias_locados' },
        { rotulo: 'Obra própria', classe: 'num', campo: 'dias_obra' },
        { rotulo: 'Manutenção', classe: 'num', campo: 'dias_manutencao' },
        { rotulo: 'Parado', classe: 'num', valor: (e) => [h('strong', {}, String(e.dias_parados)), e.dias_sem_apontamento ? h('div', { class: 'nota' }, `${e.dias_sem_apontamento} sem apontamento`) : null] },
        { rotulo: 'Utilização', valor: (e) => (e.utilizacao === null ? '—' : [fmt.pct(e.utilizacao), barra(e.utilizacao)]) },
        { rotulo: 'Receita perdida', classe: 'num', valor: (e) => (e.perda_parado === null ? '—' : h('span', { class: Number(e.perda_parado) > 0 ? 'erro-texto' : null }, fmt.dinheiro(e.perda_parado))) },
        { rotulo: 'Perda manutenção', classe: 'num', valor: (e) => (e.perda_manutencao === null ? '—' : fmt.dinheiro(e.perda_manutencao)) },
      ], r.equipamentos, { vazio: 'Nenhum equipamento ativo.' }),
      h('p', { class: 'vazio' }, `Período ${fmt.data(r.de)} a ${fmt.data(r.ate > r.hoje ? r.hoje : r.ate)}. Cada dia vale: locado > apontamento > dia útil (segunda a sexta${r.sabado ? ' e sábado' : ''}) sem apontamento, que conta como parado. Receita perdida = dias parados × receita por dia. Folga não conta. Dias futuros não entram.`));
  }
  const mudar = (campo) => (ev) => { f[campo] = ev.target.type === 'checkbox' ? (ev.target.checked ? '1' : '') : ev.target.value; carregar().catch(avisarErro); };
  trocar(raiz,
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Receita perdida com a frota parada'), h('button', { onclick: () => { window.location.hash = '#/calendario'; } }, 'Ver calendário')),
    h('div', { class: 'filtros' },
      h('label', {}, 'De', h('input', { type: 'date', value: f.de, onchange: mudar('de') })),
      h('label', {}, 'Até', h('input', { type: 'date', value: f.ate, onchange: mudar('ate') })),
      h('label', { class: 'campo check' }, h('input', { type: 'checkbox', onchange: mudar('sabado') }), h('span', {}, 'Sábado é dia útil'))),
    corpo);
  await carregar();
}
