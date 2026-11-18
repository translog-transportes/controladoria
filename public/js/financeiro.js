import { api, pode } from './api.js';
import { h, trocar, fmt, tag, tabela, modal, formulario, confirmar, toast, avisarErro, hoje } from './ui.js';

const nomeEquip = (a) => (a.placa ? `${a.placa} (${a.equipamento_nome})` : a.equipamento_nome);

// Lista de abastecimentos que ainda não estão em nenhuma conta a pagar, para marcar os que a
// conta (nota do posto) paga. aoMudar(total, quantidade) é chamado a cada marcação.
function seletorAbastecimentos(aoMudar) {
  const marcados = new Map();
  const f = { de: '', ate: '', q: '' };
  const lista = h('div', { class: 'lista-marcar' }, h('div', { class: 'vazio' }, 'Carregando…'));
  const resumo = h('p');
  const atualizar = () => {
    const sel = [...marcados.values()];
    const total = sel.reduce((s, a) => s + Number(a.valor_total), 0);
    const litros = sel.reduce((s, a) => s + Number(a.litros), 0);
    trocar(resumo, sel.length
      ? [h('strong', {}, `${sel.length} abastecimento(s) · ${fmt.numero(litros, 1)} L · ${fmt.dinheiro(total)}`), ` · placas: ${[...new Set(sel.map(nomeEquip))].join(', ')}`]
      : 'Nenhum abastecimento marcado.');
    aoMudar(total, sel.length);
  };
  const carregar = async () => {
    const itens = await api('GET', '/api/lancamentos/abastecimentos-pendentes', f);
    trocar(lista, itens.length ? itens.map((a) => {
      const c = h('input', { type: 'checkbox', onchange: () => { if (c.checked) marcados.set(a.id, a); else marcados.delete(a.id); atualizar(); } });
      c.checked = marcados.has(a.id);
      return h('label', {}, c, h('span', {},
        `${fmt.data(a.data)} · `, h('strong', {}, nomeEquip(a)),
        ` · ${fmt.numero(a.litros, 3)} L · ${fmt.dinheiro(a.valor_total)}${a.posto ? ` · ${a.posto}` : ''}${a.operador ? ` · ${a.operador}` : ''}`));
    }) : h('div', { class: 'vazio' }, 'Nenhum abastecimento pendente neste filtro. Lance os abastecimentos em Frota > Abastecimentos.'));
  };
  const mudar = (campo) => (ev) => { f[campo] = ev.target.value; carregar().catch(avisarErro); };
  carregar().catch(avisarErro);
  atualizar();
  return {
    no: h('div', {},
      h('div', { class: 'filtros' },
        h('label', {}, 'De', h('input', { type: 'date', onchange: mudar('de') })),
        h('label', {}, 'Até', h('input', { type: 'date', onchange: mudar('ate') })),
        h('label', {}, 'Placa, equipamento ou posto', h('input', { type: 'search', onchange: mudar('q') }))),
      lista, resumo),
    ids: () => [...marcados.keys()],
  };
}

const COR_STATUS = { ABERTO: 'info', PARCIAL: 'alerta', QUITADO: 'ok', CANCELADO: '' };
const textoCC = (c) => `${c.codigo} - ${c.nome}`;

// Contas a pagar (tipo PAGAR) e a receber (tipo RECEBER): mesma tela, com rótulos diferentes.
export function contas(tipo) {
  const pagar = tipo === 'PAGAR';
  const nomes = pagar ? { titulo: 'Contas a pagar', pessoa: 'Fornecedor', baixa: 'Pagar', baixado: 'Pago' } : { titulo: 'Contas a receber', pessoa: 'Cliente', baixa: 'Receber', baixado: 'Recebido' };

  return async (raiz) => {
    const filtro = { tipo, pagina: 1, status: '', venc_de: '', venc_ate: '', q: '', vencidos: '' };
    const corpo = h('div');
    const rodape = h('div', { class: 'paginacao' });

    const camposConta = [
      { nome: 'pessoa_id', rotulo: nomes.pessoa, tipo: 'remoto', rota: '/api/pessoas?ativo=1', obrigatorio: true },
      { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'remoto', rota: `/api/categorias?ativo=1&tipo=${pagar ? 'DESPESA' : 'RECEITA'}`, texto: (c) => `${c.codigo} ${c.nome}`, filtro: (c) => !!c.parent_id, obrigatorio: true },
      { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largo: true, max: 200 },
      { nome: 'centro_custo_id', rotulo: 'Obra / centro de custo', tipo: 'remoto', rota: '/api/centros-custo?ativo=1', texto: textoCC },
      { nome: 'documento', rotulo: 'Documento (NF, boleto, empenho)', max: 40 },
      { nome: 'data_emissao', rotulo: 'Emissão', tipo: 'data' },
      { nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true },
      { nome: 'valor', rotulo: 'Valor', tipo: 'dinheiro', obrigatorio: true },
    ];

    const nova = () => {
      let sel = null;
      const form = formulario([
        ...camposConta,
        { nome: 'parcelas', rotulo: 'Parcelas (mensais)', tipo: 'inteiro', padrao: 1 },
        { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' },
      ], { data_emissao: hoje() }, {
        aoCancelar: () => m.fechar(),
        aoSalvar: async (d) => {
          const abastecimentos = sel ? sel.ids() : [];
          await api('POST', '/api/lancamentos', { ...d, tipo, parcelas: d.parcelas || 1, abastecimentos });
          m.fechar();
          toast(abastecimentos.length ? `Conta lançada com ${abastecimentos.length} abastecimento(s)` : 'Conta lançada', 'ok');
          await carregar();
        },
      });
      if (pagar) {
        // Conta de combustível: marcar os abastecimentos (placas) que ela paga.
        // Enquanto o valor não for digitado à mão, ele acompanha a soma dos marcados.
        const valor = form.querySelector('[data-campo=valor] input');
        let digitado = false;
        valor.addEventListener('input', () => { digitado = true; });
        const area = h('div', { class: 'campo largo' });
        const botao = h('button', { type: 'button', onclick: () => {
          sel = seletorAbastecimentos((total, n) => { if (n && !digitado) valor.value = total.toFixed(2).replace('.', ','); });
          trocar(area, h('span', {}, 'Abastecimentos que esta conta paga'), sel.no);
        } }, '⛽ Vincular abastecimentos (conta de combustível)');
        trocar(area, botao);
        form.insertBefore(area, form.querySelector('.rodape'));
      }
      const m = modal(`Nova conta a ${pagar ? 'pagar' : 'receber'}`, form, { largo: pagar });
    };

    const alterar = (l) => {
      const semValor = Number(l.valor_baixado) > 0;
      const m = modal('Alterar conta', formulario(
        [...camposConta.filter((c) => !(semValor && c.nome === 'valor')), { nome: 'observacao', rotulo: 'Observações', tipo: 'textarea' }], l, {
          aoCancelar: () => m.fechar(),
          aoSalvar: async (d) => { await api('PUT', `/api/lancamentos/${l.id}`, d); m.fechar(); toast('Salvo', 'ok'); await carregar(); },
        }));
    };

    const baixar = (l) => {
      const m = modal(`${nomes.baixa}: ${l.descricao}`, h('div', {},
        h('p', {}, `${l.pessoa_nome} · saldo em aberto ${fmt.dinheiro(l.saldo)}`),
        formulario([
          { nome: 'conta_bancaria_id', rotulo: 'Conta bancária', tipo: 'remoto', rota: '/api/contas-bancarias?ativo=1', obrigatorio: true },
          { nome: 'data_baixa', rotulo: 'Data', tipo: 'data', obrigatorio: true },
          { nome: 'valor', rotulo: 'Valor (do principal)', tipo: 'dinheiro', obrigatorio: true },
          { nome: 'juros', rotulo: 'Juros', tipo: 'dinheiro' }, { nome: 'multa', rotulo: 'Multa', tipo: 'dinheiro' }, { nome: 'desconto', rotulo: 'Desconto', tipo: 'dinheiro' },
          { nome: 'observacao', rotulo: 'Observação', largo: true, max: 200 },
        ], { data_baixa: hoje(), valor: l.saldo }, {
          botao: nomes.baixa, aoCancelar: () => m.fechar(),
          aoSalvar: async (d) => { await api('POST', `/api/lancamentos/${l.id}/baixas`, d); m.fechar(); toast('Baixa registrada', 'ok'); await carregar(); },
        })));
    };

    const detalhes = async (l) => {
      const d = await api('GET', `/api/lancamentos/${l.id}`);
      const m = modal(d.descricao, h('div', {},
        h('p', {}, `${d.pessoa_nome} · ${d.categoria_codigo} ${d.categoria_nome}${d.centro_custo_nome ? ` · ${d.centro_custo_nome}` : ''}`),
        h('p', {}, `Valor ${fmt.dinheiro(d.valor)} · ${nomes.baixado.toLowerCase()} ${fmt.dinheiro(d.valor_baixado)} · saldo ${fmt.dinheiro(d.saldo)}`),
        d.observacao ? h('p', {}, d.observacao) : null,
        h('h3', {}, 'Baixas'),
        tabela([
          { rotulo: 'Data', valor: (b) => fmt.data(b.data_baixa) }, { rotulo: 'Conta', campo: 'conta_bancaria_nome' },
          { rotulo: 'Principal', classe: 'num', valor: (b) => fmt.dinheiro(b.valor) },
          { rotulo: 'Juros/multa', classe: 'num', valor: (b) => fmt.dinheiro(Number(b.juros) + Number(b.multa)) },
          { rotulo: 'Desconto', classe: 'num', valor: (b) => fmt.dinheiro(b.desconto) },
          { rotulo: 'Movimento', classe: 'num', valor: (b) => fmt.dinheiro(b.valor_movimento) },
          { rotulo: '', classe: 'acoes', valor: (b) => (pode('financeiro.baixar') ? h('button', { class: 'mini perigo', onclick: async () => {
            if (!(await confirmar('Estornar esta baixa?', 'Estornar'))) return;
            try { await api('DELETE', `/api/lancamentos/${l.id}/baixas/${b.id}`); m.fechar(); toast('Baixa estornada', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
          } }, 'Estornar') : null) },
        ], d.baixas, { vazio: 'Nenhuma baixa.' }),
        pagar ? blocoAbastecimentos() : null), { largo: true });

      function blocoAbastecimentos() {
        const reabrir = async () => { m.fechar(); await carregar(); await detalhes(l); };
        const total = d.abastecimentos.reduce((s, a) => s + Number(a.valor_total), 0);
        const litros = d.abastecimentos.reduce((s, a) => s + Number(a.litros), 0);
        const diferenca = Number(d.valor) - total;
        const podeEditar = pode('financeiro.editar') && d.status !== 'CANCELADO';
        const vincular = () => {
          const s = seletorAbastecimentos(() => {});
          const m2 = modal('Vincular abastecimentos', h('div', {}, s.no,
            h('div', { class: 'form' }, h('div', { class: 'rodape' },
              h('button', { onclick: () => m2.fechar() }, 'Cancelar'),
              h('button', { class: 'primario', onclick: async () => {
                const ids = s.ids();
                if (!ids.length) { toast('Marque ao menos um abastecimento', 'erro'); return; }
                try { await api('POST', `/api/lancamentos/${l.id}/abastecimentos`, { ids }); m2.fechar(); toast('Abastecimentos vinculados', 'ok'); await reabrir(); } catch (e) { avisarErro(e); }
              } }, 'Vincular')))), { largo: true });
        };
        return h('div', {},
          h('h3', {}, 'Abastecimentos pagos por esta conta'),
          d.abastecimentos.length ? h('p', {},
            `${d.abastecimentos.length} abastecimento(s) · ${fmt.numero(litros, 1)} L · ${fmt.dinheiro(total)}`,
            Math.abs(diferenca) >= 0.005 ? [' · ', h('span', { class: 'erro-texto' }, `diferença para o valor da conta: ${fmt.dinheiro(diferenca)}`)] : ' · confere com o valor da conta') : null,
          tabela([
            { rotulo: 'Data', valor: (a) => fmt.data(a.data) }, { rotulo: 'Placa / equipamento', valor: (a) => h('strong', {}, nomeEquip(a)) },
            { rotulo: 'Litros', classe: 'num', valor: (a) => fmt.numero(a.litros, 3) }, { rotulo: 'Valor', classe: 'num', valor: (a) => fmt.dinheiro(a.valor_total) },
            { rotulo: 'Posto', campo: 'posto' }, { rotulo: 'Obra', campo: 'centro_custo_nome' }, { rotulo: 'Operador', campo: 'operador' },
            { rotulo: '', classe: 'acoes', valor: (a) => (podeEditar ? h('button', { class: 'mini perigo', onclick: async () => {
              try { await api('DELETE', `/api/lancamentos/${l.id}/abastecimentos/${a.id}`); toast('Abastecimento desvinculado', 'ok'); await reabrir(); } catch (e) { avisarErro(e); }
            } }, 'Desvincular') : null) },
          ], d.abastecimentos, { vazio: 'Nenhum abastecimento vinculado. Se esta é uma conta de combustível, vincule os abastecimentos que ela paga.' }),
          podeEditar ? h('div', { class: 'filtros' }, h('button', { onclick: vincular }, '⛽ Vincular abastecimentos')) : null);
      }
    };

    const cancelar = async (l) => {
      if (!(await confirmar(`Cancelar a conta "${l.descricao}"?`, 'Cancelar conta'))) return;
      try { await api('POST', `/api/lancamentos/${l.id}/cancelar`); toast('Conta cancelada', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
    };

    async function carregar() {
      const r = await api('GET', '/api/lancamentos', { ...filtro, por_pagina: 50 });
      const vencida = (l) => ['ABERTO', 'PARCIAL'].includes(l.status) && l.data_vencimento < hoje();
      trocar(corpo, 
        h('div', { class: 'cartoes' },
          h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Total do filtro'), h('div', { class: 'valor' }, fmt.dinheiro(r.valor_total))),
          h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Saldo em aberto'), h('div', { class: 'valor' }, fmt.dinheiro(r.saldo_total)))),
        tabela([
          { rotulo: 'Vencimento', valor: (l) => [fmt.data(l.data_vencimento), vencida(l) ? [' ', tag('Vencida', 'erro')] : null] },
          { rotulo: nomes.pessoa, campo: 'pessoa_nome' },
          { rotulo: 'Descrição', valor: (l) => [`${l.descricao}${l.total_parcelas > 1 ? ` (${l.parcela}/${l.total_parcelas})` : ''}`, l.placas ? h('div', { class: 'nota' }, `⛽ Placas: ${l.placas}`) : null] },
          { rotulo: 'Documento', campo: 'documento' }, { rotulo: 'Obra', campo: 'centro_custo_nome' },
          { rotulo: 'Valor', classe: 'num', valor: (l) => fmt.dinheiro(l.valor) }, { rotulo: 'Saldo', classe: 'num', valor: (l) => fmt.dinheiro(l.saldo) },
          { rotulo: 'Situação', valor: (l) => tag(fmt.rotulo(l.status), COR_STATUS[l.status]) },
          { rotulo: '', classe: 'acoes', valor: (l) => [
            pode('financeiro.baixar') && ['ABERTO', 'PARCIAL'].includes(l.status) ? h('button', { class: 'mini primario', onclick: () => baixar(l) }, nomes.baixa) : null,
            h('button', { class: 'mini', onclick: () => detalhes(l).catch(avisarErro) }, 'Detalhes'),
            pode('financeiro.editar') && l.status !== 'CANCELADO' ? h('button', { class: 'mini', onclick: () => alterar(l) }, 'Alterar') : null,
            pode('financeiro.editar') && l.status === 'ABERTO' ? h('button', { class: 'mini perigo', onclick: () => cancelar(l) }, 'Cancelar') : null,
          ] },
        ], r.dados));
      const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
      trocar(rodape, `${r.total} conta(s)`,
        paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina <= 1, onclick: () => { filtro.pagina -= 1; carregar().catch(avisarErro); } }, '‹ Anterior') : null,
        paginas > 1 ? `Página ${filtro.pagina} de ${paginas}` : null,
        paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina >= paginas, onclick: () => { filtro.pagina += 1; carregar().catch(avisarErro); } }, 'Próxima ›') : null);
    }
    const mudar = (campo) => (ev) => { filtro[campo] = ev.target.value; filtro.pagina = 1; carregar().catch(avisarErro); };

    trocar(raiz, 
      h('div', { class: 'cabecalho' }, h('h1', {}, nomes.titulo),
        pode('financeiro.editar') ? h('button', { class: 'primario', onclick: nova }, '+ Nova conta') : null),
      h('div', { class: 'filtros' },
        h('label', {}, 'Buscar', h('input', { type: 'search', placeholder: 'Descrição, documento ou nome', onchange: mudar('q') })),
        h('label', {}, 'Situação', h('select', { onchange: (ev) => {
          filtro.vencidos = ev.target.value === 'VENCIDOS' ? '1' : '';
          filtro.status = ev.target.value === 'VENCIDOS' ? '' : ev.target.value;
          filtro.pagina = 1; carregar().catch(avisarErro);
        } }, [['', 'Todas'], ['ABERTO', 'Em aberto'], ['PARCIAL', 'Parcial'], ['VENCIDOS', 'Vencidas'], ['QUITADO', 'Quitadas'], ['CANCELADO', 'Canceladas']].map(([v, t]) => h('option', { value: v }, t)))),
        h('label', {}, 'Vencimento de', h('input', { type: 'date', onchange: mudar('venc_de') })),
        h('label', {}, 'até', h('input', { type: 'date', onchange: mudar('venc_ate') }))),
      corpo, rodape);
    await carregar();
  };
}

// ---------- relatórios ----------

function periodoPadrao() {
  const d = new Date();
  const ini = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = new Date(d.getFullYear(), d.getMonth() + 3, 0);
  return { de: ini, ate: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}` };
}

export async function fluxoCaixa(raiz) {
  const f = { ...periodoPadrao(), agrupar: 'mes' };
  const corpo = h('div');
  const rotuloPeriodo = (p) => (p.length === 7 ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : fmt.data(p));
  async function carregar() {
    const [r, s] = await Promise.all([api('GET', '/api/relatorios/fluxo-caixa', f), api('GET', '/api/relatorios/saldos')]);
    trocar(corpo, 
      h('div', { class: 'cartoes' },
        s.contas.map((c) => h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, c.nome), h('div', { class: `valor${Number(c.saldo) < 0 ? ' erro' : ''}` }, fmt.dinheiro(c.saldo)))),
        h('div', { class: 'cartao' }, h('div', { class: 'rotulo' }, 'Saldo total hoje'), h('div', { class: `valor${Number(s.saldo_total) < 0 ? ' erro' : ''}` }, fmt.dinheiro(s.saldo_total)))),
      h('p', {}, `Saldo no início do período: ${fmt.dinheiro(r.saldo_inicial)}`),
      tabela([
        { rotulo: 'Período', valor: (p) => rotuloPeriodo(p.periodo) },
        { rotulo: 'Recebido', classe: 'num', valor: (p) => fmt.dinheiro(p.entradas) }, { rotulo: 'Pago', classe: 'num', valor: (p) => fmt.dinheiro(p.saidas) },
        { rotulo: 'A receber', classe: 'num', valor: (p) => fmt.dinheiro(p.entradas_previstas) }, { rotulo: 'A pagar', classe: 'num', valor: (p) => fmt.dinheiro(p.saidas_previstas) },
        { rotulo: 'Saldo realizado', classe: 'num', valor: (p) => fmt.dinheiro(p.saldo) },
        { rotulo: 'Saldo projetado', classe: 'num', valor: (p) => h('span', { class: Number(p.saldo_projetado) < 0 ? 'erro-texto' : null }, fmt.dinheiro(p.saldo_projetado)) },
      ], r.periodos, { vazio: 'Sem movimentação no período.' }));
  }
  const mudar = (campo) => (ev) => { f[campo] = ev.target.value; carregar().catch(avisarErro); };
  trocar(raiz, 
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Fluxo de caixa')),
    h('div', { class: 'filtros' },
      h('label', {}, 'De', h('input', { type: 'date', value: f.de, onchange: mudar('de') })),
      h('label', {}, 'Até', h('input', { type: 'date', value: f.ate, onchange: mudar('ate') })),
      h('label', {}, 'Agrupar por', h('select', { onchange: mudar('agrupar') }, h('option', { value: 'mes' }, 'Mês'), h('option', { value: 'dia' }, 'Dia')))),
    corpo);
  await carregar();
}

export async function dre(raiz) {
  const ano = new Date().getFullYear();
  const f = { de: `${ano}-01-01`, ate: `${ano}-12-31`, centro_custo_id: '' };
  const corpo = h('div');
  const GRUPOS = [['RECEITA_BRUTA', 'Receita bruta', null], ['DEDUCOES', '(−) Deduções e impostos', 'receita_liquida', '= Receita líquida'],
    ['CUSTO_DIRETO', '(−) Custos diretos de obra', 'lucro_bruto', '= Lucro bruto'], ['DESPESA_OPERACIONAL', '(−) Despesas administrativas', 'resultado_operacional', '= Resultado operacional'],
    ['RESULTADO_FINANCEIRO', 'Resultado financeiro', 'resultado', '= Resultado do período']];
  async function carregar() {
    const r = await api('GET', '/api/relatorios/dre', f);
    const linhas = [];
    for (const [chave, titulo, total, tituloTotal] of GRUPOS) {
      linhas.push(h('tr', { class: 'fase' }, h('td', {}, titulo), h('td', { class: 'num' }, fmt.dinheiro(r.grupos[chave].total))));
      for (const c of r.grupos[chave].categorias) linhas.push(h('tr', {}, h('td', {}, `   ${c.codigo} ${c.nome}`), h('td', { class: 'num' }, fmt.dinheiro(c.valor))));
      if (total) linhas.push(h('tr', { class: 'total' }, h('td', {}, tituloTotal), h('td', { class: `num${Number(r[total]) < 0 ? ' erro-texto' : ''}` }, fmt.dinheiro(r[total]))));
    }
    trocar(corpo, h('div', { class: 'rolagem' }, h('table', {}, h('tbody', {}, linhas))));
  }
  const cc = h('select', { onchange: (ev) => { f.centro_custo_id = ev.target.value; carregar().catch(avisarErro); } }, h('option', { value: '' }, 'Empresa toda'));
  api('GET', '/api/centros-custo', { por_pagina: 500 }).then((r) => cc.append(...r.dados.map((c) => h('option', { value: c.id }, textoCC(c))))).catch(() => {});
  const mudar = (campo) => (ev) => { f[campo] = ev.target.value; carregar().catch(avisarErro); };
  trocar(raiz, 
    h('div', { class: 'cabecalho' }, h('h1', {}, 'DRE (resultado por competência)')),
    h('div', { class: 'filtros' },
      h('label', {}, 'De', h('input', { type: 'date', value: f.de, onchange: mudar('de') })),
      h('label', {}, 'Até', h('input', { type: 'date', value: f.ate, onchange: mudar('ate') })),
      h('label', {}, 'Obra / centro de custo', cc)),
    corpo);
  await carregar();
}
