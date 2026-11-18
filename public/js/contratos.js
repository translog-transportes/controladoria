import { api, pode } from './api.js';
import { h, trocar, fmt, tag, barra, tabela, modal, formulario, confirmar, toast, avisarErro, hoje, anexos, paraPonto } from './ui.js';
import { telaRecurso } from './recurso.js';

const STATUS = [['ATIVO', 'Ativo'], ['SUSPENSO', 'Suspenso'], ['CONCLUIDO', 'Concluído'], ['RESCINDIDO', 'Rescindido']];
const pctDe = (parte, todo) => (Number(todo) > 0 ? (Number(parte) / Number(todo)) * 100 : 0);

export const lista = telaRecurso({
  titulo: 'Contratos e obras', singular: 'contrato', rota: '/api/contratos', editar: 'contratos.editar', semExcluir: true, textoNovo: '+ Novo contrato',
  filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: STATUS }],
  acoes: (l) => h('button', { class: 'mini primario', onclick: () => { window.location.hash = `#/contrato/${l.id}`; } }, 'Abrir obra'),
  colunas: [
    { rotulo: 'Contrato', campo: 'numero' }, { rotulo: 'Cliente', campo: 'cliente_nome' },
    { rotulo: 'Objeto', valor: (l) => (l.objeto && l.objeto.length > 70 ? `${l.objeto.slice(0, 70)}…` : l.objeto) },
    { rotulo: 'Prazo', valor: (l) => [fmt.data(l.data_inicio), fmt.data(l.data_fim)].filter(Boolean).join(' a ') },
    { rotulo: 'Planilha', classe: 'num', valor: (l) => fmt.dinheiro(l.valor_planilha) },
    { rotulo: 'Executado', valor: (l) => [fmt.pct(pctDe(l.valor_executado, l.valor_planilha)), barra(pctDe(l.valor_executado, l.valor_planilha))] },
    { rotulo: 'Situação', valor: (l) => tag((STATUS.find((s) => s[0] === l.status) || [])[1], l.status === 'ATIVO' ? 'ok' : '') },
  ],
  campos: [
    { nome: 'numero', rotulo: 'Nº do contrato', obrigatorio: true, max: 40 },
    { nome: 'cliente_id', rotulo: 'Cliente / órgão contratante', tipo: 'remoto', rota: '/api/pessoas?ativo=1', obrigatorio: true },
    { nome: 'licitacao_id', rotulo: 'Licitação de origem', tipo: 'remoto', rota: '/api/licitacoes', texto: (l) => `${l.numero_processo} - ${l.orgao_nome || ''}` },
    { nome: 'status', rotulo: 'Situação', tipo: 'select', opcoes: STATUS, obrigatorio: true, padrao: 'ATIVO' },
    { nome: 'objeto', rotulo: 'Objeto', tipo: 'textarea' },
    { nome: 'data_assinatura', rotulo: 'Assinatura', tipo: 'data' }, { nome: 'valor_total', rotulo: 'Valor do contrato', tipo: 'dinheiro', padrao: '0.00' },
    { nome: 'data_inicio', rotulo: 'Início', tipo: 'data' }, { nome: 'data_fim', rotulo: 'Término', tipo: 'data' },
  ],
});

// Tela da obra: evolução, planilha de execução, execuções, notas fiscais, importação e anexos.
export async function detalhe(raiz, id) {
  const base = `/api/contratos/${id}`;
  const corpo = h('div');
  const topo = h('div');
  const abas = h('div', { class: 'abas' });
  let ev = null; // evolução carregada
  let abaAtual = 'planilha';

  const cartao = (rotulo, valor, nota, extra) => h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), nota ? h('div', { class: 'nota' }, nota) : null, extra);

  async function carregar() {
    ev = await api('GET', `${base}/evolucao`);
    const t = ev.totais;
    const c = ev.contrato;
    trocar(topo, 
      h('div', { class: 'cabecalho' },
        h('h1', {}, `Contrato ${c.numero}`), h('span', {}, c.cliente_nome),
        h('button', { onclick: () => { window.location.hash = '#/contratos'; } }, '‹ Voltar')),
      h('div', { class: 'cartoes' },
        cartao('Valor da planilha', fmt.dinheiro(t.valor_previsto)),
        cartao('Executado (físico)', fmt.dinheiro(t.valor_executado), `${fmt.pct(t.percentual_fisico)} da obra`, barra(t.percentual_fisico)),
        cartao('Faturado (notas)', fmt.dinheiro(t.valor_faturado), `A faturar: ${fmt.dinheiro(t.a_faturar)}`, barra(t.percentual_faturado)),
        cartao('Custo apropriado', fmt.dinheiro(t.custo), 'Contas a pagar vinculadas aos itens'),
        cartao('Resultado (executado − custo)', h('span', { class: Number(t.resultado) < 0 ? 'erro-texto' : null }, fmt.dinheiro(t.resultado)))));
    mostrarAba();
  }
  const recarregar = () => carregar().catch(avisarErro);

  // ----- aba Planilha -----
  function abaPlanilha() {
    const executar = (item) => {
      const saldo = Number(item.quantidade) - Number(item.executado_qtd);
      const m = modal(`Executar item ${item.codigo}`, h('div', {},
        h('p', {}, item.descricao),
        h('p', {}, `Contratado: ${fmt.numero(item.quantidade, 4)} ${item.unidade || ''} · já executado: ${fmt.numero(item.executado_qtd, 4)} · saldo: ${fmt.numero(saldo, 4)}`),
        formulario([
          { nome: 'data', rotulo: 'Data da execução', tipo: 'data', obrigatorio: true },
          { nome: 'quantidade', rotulo: `Quantidade executada (${item.unidade || 'un'})`, tipo: 'numero', casas: 4, obrigatorio: true },
          { nome: 'observacao', rotulo: 'Observação', largo: true, max: 300 },
        ], { data: hoje(), quantidade: saldo.toFixed(4) }, {
          botao: 'Marcar como executado', aoCancelar: () => m.fechar(),
          aoSalvar: async (d) => { await api('POST', `${base}/execucoes`, { ...d, contrato_item_id: item.id }); m.fechar(); toast('Execução registrada', 'ok'); await carregar(); },
        })));
    };

    const custos = async (item) => {
      const caixa = h('div');
      const m = modal(`Custos do item ${item.codigo}`, caixa, { largo: true });
      const montar = async () => {
        const [vinculados, livres] = await Promise.all([api('GET', `${base}/custos`, { item_id: item.id }), pode('contratos.editar') ? api('GET', `${base}/custos/disponiveis`) : []]);
        const sel = h('select', {}, h('option', { value: '' }, 'Escolha a conta a pagar…'),
          livres.map((l) => h('option', { value: l.id }, `${fmt.data(l.data_vencimento)} · ${l.pessoa_nome} · ${l.descricao}${l.documento ? ` (${l.documento})` : ''} · livre ${fmt.dinheiro(l.disponivel)}`)));
        const valor = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Tudo o que está livre' });
        trocar(caixa, 
          h('p', {}, item.descricao),
          tabela([
            { rotulo: 'Vencimento', valor: (k) => fmt.data(k.data_vencimento) }, { rotulo: 'Fornecedor', campo: 'pessoa_nome' }, { rotulo: 'Conta', campo: 'descricao' },
            { rotulo: 'Documento', campo: 'documento' }, { rotulo: 'Valor da conta', classe: 'num', valor: (k) => fmt.dinheiro(k.lancamento_valor) },
            { rotulo: 'Apropriado ao item', classe: 'num', valor: (k) => fmt.dinheiro(k.valor) },
            { rotulo: '', classe: 'acoes', valor: (k) => (pode('contratos.editar') ? h('button', { class: 'mini perigo', onclick: () => api('DELETE', `${base}/custos/${k.id}`).then(montar).then(() => carregarSilencioso()).catch(avisarErro) }, 'Remover') : null) },
          ], vinculados, { vazio: 'Nenhuma conta a pagar vinculada a este item.' }),
          pode('contratos.editar') ? h('div', { class: 'filtros' },
            h('label', {}, 'Vincular conta a pagar', sel),
            h('label', {}, 'Valor (deixe vazio para usar tudo)', valor),
            h('button', { class: 'primario', onclick: async () => {
              if (!sel.value) return toast('Escolha a conta a pagar', 'erro');
              try {
                await api('POST', `${base}/custos`, { contrato_item_id: item.id, lancamento_id: Number(sel.value), valor: paraPonto(valor.value) || undefined });
                toast('Custo vinculado', 'ok'); await montar(); await carregarSilencioso();
              } catch (e) { avisarErro(e); }
              return null;
            } }, 'Vincular')) : null);
      };
      const carregarSilencioso = async () => { ev = await api('GET', `${base}/evolucao`); };
      try { await montar(); } catch (e) { m.fechar(); avisarErro(e); }
      // ao fechar a janela, atualiza a tela da obra
      new MutationObserver((_, obs) => { if (!m.no.isConnected) { obs.disconnect(); recarregar(); } }).observe(document.body, { childList: true });
    };

    const novoItem = (item) => {
      const m = modal(item ? `Alterar item ${item.codigo}` : 'Novo item ou fase', formulario([
        item ? null : { nome: 'codigo', rotulo: 'Código (ex.: 1.2.3)', obrigatorio: true, max: 30 },
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largo: true, max: 500 },
        { nome: 'unidade', rotulo: 'Unidade', max: 15 },
        { nome: 'quantidade', rotulo: 'Quantidade (vazio = fase)', tipo: 'numero', casas: 4 },
        { nome: 'preco_unitario', rotulo: 'Preço unitário', tipo: 'numero', casas: 4 },
      ].filter(Boolean), item, {
        aoCancelar: () => m.fechar(),
        aoSalvar: async (d) => {
          if (item) await api('PUT', `${base}/itens/${item.id}`, item.fase ? { descricao: d.descricao } : d);
          else await api('POST', `${base}/itens`, d);
          m.fechar(); toast('Salvo', 'ok'); await carregar();
        },
      }));
    };

    const excluirItem = async (item) => {
      if (!(await confirmar(`Excluir o item ${item.codigo}${item.fase ? ' e todos os subitens' : ''}?`, 'Excluir'))) return;
      try { await api('DELETE', `${base}/itens/${item.id}`); toast('Excluído', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
    };

    const recuo = (item) => { const s = h('span', {}, item.descricao); s.style.paddingLeft = `${item.nivel * 16}px`; s.style.display = 'inline-block'; return s; };
    return h('div', {},
      pode('contratos.editar') ? h('div', { class: 'filtros' }, h('button', { onclick: () => novoItem(null) }, '+ Item ou fase')) : null,
      tabela([
        { rotulo: 'Item', campo: 'codigo' }, { rotulo: 'Descrição', valor: recuo }, { rotulo: 'Un.', campo: 'unidade' },
        { rotulo: 'Qtd.', classe: 'num', valor: (i) => (i.fase ? '' : fmt.numero(i.quantidade, 4)) },
        { rotulo: 'Preço unit.', classe: 'num', valor: (i) => (i.fase ? '' : fmt.numero(i.preco_unitario, 4)) },
        { rotulo: 'Previsto', classe: 'num', valor: (i) => fmt.dinheiro(i.valor_previsto) },
        { rotulo: 'Qtd. exec.', classe: 'num', valor: (i) => (i.fase ? '' : fmt.numero(i.executado_qtd, 4)) },
        { rotulo: 'Executado', classe: 'num', valor: (i) => fmt.dinheiro(i.valor_executado) },
        { rotulo: '%', valor: (i) => [fmt.pct(i.percentual), barra(i.percentual)] },
        { rotulo: 'Faturado', classe: 'num', valor: (i) => fmt.dinheiro(i.valor_faturado) },
        { rotulo: 'Custo', classe: 'num', valor: (i) => h('span', { class: Number(i.custo) > Number(i.valor_previsto) && Number(i.valor_previsto) > 0 ? 'erro-texto' : null }, fmt.dinheiro(i.custo)) },
        { rotulo: '', classe: 'acoes', valor: (i) => [
          !i.fase && pode('execucao.lancar') && Number(i.executado_qtd) < Number(i.quantidade) ? h('button', { class: 'mini primario', onclick: () => executar(i) }, 'Executar') : null,
          h('button', { class: 'mini', onclick: () => custos(i) }, 'Custos'),
          pode('contratos.editar') ? h('button', { class: 'mini', onclick: () => novoItem(i) }, 'Alterar') : null,
          pode('contratos.editar') ? h('button', { class: 'mini perigo', onclick: () => excluirItem(i) }, 'Excluir') : null,
        ] },
      ], ev.itens, { classeLinha: (i) => (i.fase ? 'fase' : null), vazio: 'A planilha está vazia. Use a aba "Importar planilha" ou inclua os itens um a um.' }),
      ev.curva.length ? h('div', {}, h('h2', {}, 'Evolução mês a mês'), tabela([
        { rotulo: 'Mês', valor: (c) => `${c.mes.slice(5, 7)}/${c.mes.slice(0, 4)}` },
        { rotulo: 'Executado no mês', classe: 'num', valor: (c) => fmt.dinheiro(c.valor) },
        { rotulo: 'Acumulado', classe: 'num', valor: (c) => fmt.dinheiro(c.acumulado) },
        { rotulo: '% da obra', valor: (c) => [fmt.pct(c.percentual), barra(c.percentual)] },
      ], ev.curva)) : null);
  }

  // ----- aba Execuções -----
  async function abaExecucoes() {
    const itens = await api('GET', `${base}/execucoes`);
    return tabela([
      { rotulo: 'Data', valor: (e) => fmt.data(e.data) }, { rotulo: 'Item', campo: 'codigo' }, { rotulo: 'Descrição', campo: 'descricao' },
      { rotulo: 'Quantidade', classe: 'num', valor: (e) => `${fmt.numero(e.quantidade, 4)} ${e.unidade || ''}` },
      { rotulo: 'Valor', classe: 'num', valor: (e) => fmt.dinheiro(e.valor) },
      { rotulo: 'Faturamento', valor: (e) => (Number(e.faturado_qtd) >= Number(e.quantidade) ? tag('Faturado', 'ok') : Number(e.faturado_qtd) > 0 ? tag('Parcial', 'alerta') : tag('A faturar', 'info')) },
      { rotulo: 'Lançado por', campo: 'criado_por_nome' }, { rotulo: 'Obs.', campo: 'observacao' },
      { rotulo: '', classe: 'acoes', valor: (e) => (pode('execucao.lancar') && Number(e.faturado_qtd) === 0 ? h('button', { class: 'mini perigo', onclick: async () => {
        if (!(await confirmar('Excluir esta execução?', 'Excluir'))) return;
        try { await api('DELETE', `${base}/execucoes/${e.id}`); toast('Execução excluída', 'ok'); await carregar(); } catch (er) { avisarErro(er); }
      } }, 'Excluir') : null) },
    ], itens, { vazio: 'Nenhuma execução lançada. Na aba Planilha, use "Executar" no item.' });
  }

  // ----- aba Notas fiscais -----
  async function abaNotas() {
    const notas = await api('GET', `${base}/notas`);

    const nova = async () => {
      const pendentes = await api('GET', `${base}/execucoes`, { pendentes: 1 });
      if (!pendentes.length) return toast('Não há itens executados aguardando nota fiscal', 'erro');
      const marcados = new Map(); // execucao_id -> { check, qtd }
      const totalEl = h('strong', {}, fmt.dinheiro(0));
      const somar = () => {
        let t = 0;
        for (const p of pendentes) {
          const m = marcados.get(p.id);
          if (m.check.checked) t += Number(paraPonto(m.qtd.value) || 0) * Number(p.preco_unitario);
        }
        totalEl.textContent = fmt.dinheiro(t);
      };
      const listaEl = h('div', { class: 'lista-marcar' }, pendentes.map((p) => {
        const restante = Number(p.quantidade) - Number(p.faturado_qtd);
        const check = h('input', { type: 'checkbox', onchange: somar });
        const qtd = h('input', { type: 'text', inputmode: 'decimal', value: restante.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 4 }), oninput: somar, 'aria-label': 'Quantidade a faturar' });
        marcados.set(p.id, { check, qtd });
        return h('label', {}, check, h('span', {}, `${p.codigo} · ${p.descricao} · executado em ${fmt.data(p.data)} · saldo ${fmt.numero(restante, 4)} ${p.unidade || ''}`), qtd);
      }));
      const form = formulario([
        { nome: 'numero', rotulo: 'Nº da nota', obrigatorio: true, max: 20 }, { nome: 'serie', rotulo: 'Série', max: 5 },
        { nome: 'data_emissao', rotulo: 'Emissão', tipo: 'data', obrigatorio: true }, { nome: 'data_vencimento', rotulo: 'Previsão de recebimento', tipo: 'data', obrigatorio: true },
        { nome: 'iss', rotulo: 'ISS retido', tipo: 'dinheiro' }, { nome: 'inss', rotulo: 'INSS retido', tipo: 'dinheiro' },
        { nome: 'irrf', rotulo: 'IRRF retido', tipo: 'dinheiro' }, { nome: 'outras_retencoes', rotulo: 'Outras retenções (PIS/COFINS/CSLL)', tipo: 'dinheiro' },
        { nome: 'observacao', rotulo: 'Observação', largo: true, max: 300 },
      ], { data_emissao: hoje() }, {
        botao: 'Registrar nota', aoCancelar: () => m.fechar(),
        aoSalvar: async (d) => {
          const itens = pendentes.filter((p) => marcados.get(p.id).check.checked).map((p) => ({ execucao_id: p.id, quantidade: paraPonto(marcados.get(p.id).qtd.value) }));
          if (!itens.length) { toast('Marque ao menos um item executado', 'erro'); return; }
          await api('POST', `${base}/notas`, { ...d, itens });
          m.fechar(); toast('Nota registrada e conta a receber gerada', 'ok'); await carregar();
        },
      });
      const m = modal('Registrar nota fiscal', h('div', {},
        h('h3', {}, 'Itens executados que entram nesta nota'), listaEl,
        h('p', {}, 'Valor bruto aproximado: ', totalEl), form), { largo: true });
      return null;
    };

    const ver = async (n) => {
      const d = await api('GET', `${base}/notas/${n.id}`);
      modal(`Nota ${d.numero}${d.serie ? `/${d.serie}` : ''}`, h('div', {},
        tabela([
          { rotulo: 'Item', campo: 'codigo' }, { rotulo: 'Descrição', campo: 'descricao' },
          { rotulo: 'Quantidade', classe: 'num', valor: (i) => `${fmt.numero(i.quantidade, 4)} ${i.unidade || ''}` },
          { rotulo: 'Valor', classe: 'num', valor: (i) => fmt.dinheiro(i.valor) },
        ], d.itens),
        h('h3', {}, 'Anexos'), anexos('NOTA', d.id, pode('notas.editar'))), { largo: true });
    };

    const cancelar = async (n) => {
      if (!(await confirmar(`Cancelar a nota ${n.numero}? A conta a receber também será cancelada e os itens voltam a ficar disponíveis.`, 'Cancelar nota'))) return;
      try { await api('POST', `${base}/notas/${n.id}/cancelar`); toast('Nota cancelada', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
    };

    const retido = (n) => Number(n.iss) + Number(n.inss) + Number(n.irrf) + Number(n.outras_retencoes);
    return h('div', {},
      pode('notas.editar') ? h('div', { class: 'filtros' }, h('button', { class: 'primario', onclick: () => nova().catch(avisarErro) }, '+ Registrar nota fiscal')) : null,
      tabela([
        { rotulo: 'Nota', valor: (n) => `${n.numero}${n.serie ? `/${n.serie}` : ''}` }, { rotulo: 'Emissão', valor: (n) => fmt.data(n.data_emissao) },
        { rotulo: 'Itens', classe: 'num', campo: 'itens' }, { rotulo: 'Valor bruto', classe: 'num', valor: (n) => fmt.dinheiro(n.valor_bruto) },
        { rotulo: 'Retenções', classe: 'num', valor: (n) => fmt.dinheiro(retido(n)) }, { rotulo: 'Líquido', classe: 'num', valor: (n) => fmt.dinheiro(n.valor_liquido) },
        { rotulo: 'Recebimento', valor: (n) => (n.status === 'CANCELADA' ? tag('Nota cancelada') : n.recebimento_status === 'QUITADO' ? tag('Recebido', 'ok') : n.recebimento_status === 'PARCIAL' ? tag('Parcial', 'alerta') : tag(`Previsto ${fmt.data(n.data_vencimento)}`, 'info')) },
        { rotulo: '', classe: 'acoes', valor: (n) => [
          h('button', { class: 'mini', onclick: () => ver(n).catch(avisarErro) }, 'Itens e anexos'),
          pode('notas.editar') && n.status === 'EMITIDA' ? h('button', { class: 'mini perigo', onclick: () => cancelar(n) }, 'Cancelar') : null,
        ] },
      ], notas, { vazio: 'Nenhuma nota registrada.' }));
  }

  // ----- aba Importar planilha -----
  function abaImportar() {
    const CAMPOS = [['codigo', 'Item / código'], ['descricao', 'Descrição'], ['unidade', 'Unidade'], ['quantidade', 'Quantidade'], ['preco_unitario', 'Preço unitário'], ['valor_total', 'Valor total']];
    const arquivo = h('input', { type: 'file', accept: '.xlsx' });
    const previa = h('div');
    let seletores = {};
    let linhaCab = null;
    let substituir = null;

    const enviar = async (somentePrevia, usarMapa) => {
      if (!arquivo.files[0]) { toast('Escolha a planilha (.xlsx)', 'erro'); return null; }
      const fd = new FormData();
      fd.append('arquivo', arquivo.files[0]);
      if (somentePrevia) fd.append('previa', '1');
      if (usarMapa) {
        const mapa = {};
        for (const [campo] of CAMPOS) if (seletores[campo].value !== '') mapa[campo] = Number(seletores[campo].value);
        fd.append('mapeamento', JSON.stringify(mapa));
        fd.append('linha_cabecalho', linhaCab.value);
        if (substituir.checked) fd.append('substituir', '1');
      }
      return api('POST', `${base}/planilha`, fd);
    };

    const mostrar = (r) => {
      seletores = {};
      linhaCab = h('input', { type: 'number', min: '1', value: r.linha_cabecalho });
      substituir = h('input', { type: 'checkbox' });
      const colunas = r.cabecalho.map((txt, i) => [i, `${String.fromCharCode(65 + (i % 26))} - ${txt || '(vazia)'}`]);
      trocar(previa, 
        h('div', { class: 'painel' },
          h('h2', {}, 'Confira as colunas'),
          h('div', { class: 'filtros' },
            h('label', {}, 'Linha do cabeçalho', linhaCab),
            CAMPOS.map(([campo, rotulo]) => {
              const s = h('select', {}, h('option', { value: '' }, '(não usar)'), colunas.map(([i, t]) => h('option', { value: i }, t)));
              s.value = r.mapeamento[campo] ?? '';
              seletores[campo] = s;
              return h('label', {}, rotulo, s);
            })),
          r.erro ? h('p', { class: 'erro-texto' }, r.erro)
            : h('p', {}, `Encontrados ${r.itens_encontrados} linhas (${r.fases} fases e ${r.itens_encontrados - r.fases} itens), total ${fmt.dinheiro(r.valor_total)}. ${r.linhas_ignoradas} linhas ignoradas (títulos, totais, vazias).`),
          r.avisos.map((a) => h('p', { class: 'erro-texto' }, a)),
          h('div', { class: 'filtros' },
            h('button', { onclick: () => enviar(true, true).then((x) => x && mostrar(x)).catch(avisarErro) }, 'Atualizar prévia'),
            h('label', { class: 'campo check' }, substituir, h('span', {}, 'Substituir a planilha atual do contrato')),
            h('button', { class: 'primario', onclick: async () => {
              try {
                const x = await enviar(false, true);
                if (!x) return;
                toast(`${x.itens_importados} linhas importadas`, 'ok');
                abaAtual = 'planilha';
                await carregar();
              } catch (e) { avisarErro(e); }
            } }, 'Importar'))),
        h('h3', {}, 'Primeiras linhas do arquivo'),
        h('div', { class: 'rolagem' }, h('table', {}, h('tbody', {}, r.amostra.map((l, n) => h('tr', { class: n + 1 === r.linha_cabecalho ? 'fase' : null }, h('td', { class: 'num' }, n + 1), l.map((c) => h('td', {}, c))))))));
    };

    return h('div', {},
      h('p', {}, 'Envie a planilha orçamentária do contrato em Excel (.xlsx). O sistema localiza o cabeçalho e as colunas; você confere antes de gravar. Linhas com código e sem quantidade viram fases.'),
      h('div', { class: 'filtros' }, h('label', {}, 'Planilha (.xlsx)', arquivo),
        h('button', { class: 'primario', onclick: () => enviar(true, false).then((x) => x && mostrar(x)).catch(avisarErro) }, 'Ler planilha')),
      previa);
  }

  const ABAS = [
    ['planilha', 'Planilha e evolução', () => abaPlanilha()],
    ['execucoes', 'Execuções', abaExecucoes],
    ['notas', 'Notas fiscais', abaNotas],
    pode('contratos.editar') ? ['importar', 'Importar planilha', () => abaImportar()] : null,
    ['anexos', 'Edital e anexos', () => anexos('CONTRATO', Number(id), pode('contratos.editar'))],
  ].filter(Boolean);

  function mostrarAba() {
    trocar(abas, ABAS.map(([chave, titulo]) => h('button', { class: chave === abaAtual ? 'ativa' : null, onclick: () => { abaAtual = chave; mostrarAba(); } }, titulo)));
    const [, , montar] = ABAS.find((a) => a[0] === abaAtual) || ABAS[0];
    Promise.resolve(montar()).then((no) => trocar(corpo, no)).catch(avisarErro);
  }

  trocar(raiz, topo, abas, corpo);
  await carregar();
}
