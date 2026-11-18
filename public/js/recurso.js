import { api, pode } from './api.js';
import { h, trocar, tabela, modal, formulario, confirmar, toast, avisarErro, limparCache } from './ui.js';

// Tela genérica de cadastro: lista com busca, filtros e paginação + formulário em janela.
// cfg: { titulo, rota, colunas, campos, editar (permissão), filtros, busca, acoes(linha, recarregar),
//        semEditar, semExcluir, textoNovo, ajuda }
export function telaRecurso(cfg) {
  return async (raiz) => {
    const podeEditar = pode(cfg.editar);
    const filtro = { pagina: 1, q: '' };
    const corpo = h('div');
    const rodape = h('div', { class: 'paginacao' });

    const abrirForm = (linha) => {
      const m = modal(linha ? `Alterar ${cfg.singular}` : `Novo(a) ${cfg.singular}`, formulario(cfg.campos, linha, {
        aoCancelar: () => m.fechar(),
        aoSalvar: async (dados) => {
          if (linha) await api('PUT', `${cfg.rota}/${linha.id}`, dados);
          else await api('POST', cfg.rota, dados);
          limparCache();
          m.fechar();
          toast('Salvo', 'ok');
          await carregar();
        },
      }));
    };

    const excluir = async (linha) => {
      if (!(await confirmar('Excluir este registro? Essa ação não pode ser desfeita.', 'Excluir'))) return;
      try { await api('DELETE', `${cfg.rota}/${linha.id}`); limparCache(); toast('Excluído', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
    };

    async function carregar() {
      const r = await api('GET', cfg.rota, { ...filtro, por_pagina: 50 });
      const colunas = [...cfg.colunas, {
        rotulo: '', classe: 'acoes', valor: (l) => [
          cfg.acoes ? cfg.acoes(l, carregar) : null,
          podeEditar && !cfg.semEditar ? h('button', { class: 'mini', onclick: () => abrirForm(l) }, 'Alterar') : null,
          (cfg.excluir ? pode(cfg.excluir) : podeEditar) && !cfg.semExcluir ? h('button', { class: 'mini perigo', onclick: () => excluir(l) }, 'Excluir') : null,
        ],
      }];
      trocar(corpo, tabela(colunas, r.dados, { classeLinha: cfg.classeLinha }));
      const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
      trocar(rodape, 
        `${r.total} registro(s)`,
        paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina <= 1, onclick: () => { filtro.pagina -= 1; carregar().catch(avisarErro); } }, '‹ Anterior') : null,
        paginas > 1 ? `Página ${filtro.pagina} de ${paginas}` : null,
        paginas > 1 ? h('button', { class: 'mini', disabled: filtro.pagina >= paginas, onclick: () => { filtro.pagina += 1; carregar().catch(avisarErro); } }, 'Próxima ›') : null);
    }
    const recarregar = () => { filtro.pagina = 1; carregar().catch(avisarErro); };

    let espera;
    const filtros = h('div', { class: 'filtros' },
      cfg.busca === false ? null : h('label', {}, 'Buscar', h('input', { type: 'search', placeholder: 'Digite para buscar', oninput: (ev) => {
        clearTimeout(espera);
        espera = setTimeout(() => { filtro.q = ev.target.value.trim(); recarregar(); }, 300);
      } })),
      (cfg.filtros || []).map((f) => h('label', {}, f.rotulo,
        f.tipo === 'data'
          ? h('input', { type: 'date', onchange: (ev) => { filtro[f.nome] = ev.target.value; recarregar(); } })
          : h('select', { onchange: (ev) => { filtro[f.nome] = ev.target.value; recarregar(); } },
            h('option', { value: '' }, 'Todos'), f.opcoes.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o.charAt(0) + o.slice(1).toLowerCase().replace(/_/g, ' '))))))));

    trocar(raiz, 
      h('div', { class: 'cabecalho' }, h('h1', {}, cfg.titulo),
        podeEditar && !cfg.semNovo ? h('button', { class: 'primario', onclick: () => abrirForm(null) }, cfg.textoNovo || '+ Novo') : null),
      cfg.ajuda ? h('p', { class: 'vazio' }, cfg.ajuda) : null,
      filtros, corpo, rodape);
    await carregar();
  };
}
