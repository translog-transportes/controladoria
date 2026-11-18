import { api, estado } from './api.js';
import { h, trocar, fmt, tag, tabela, modal, formulario, confirmar, toast, avisarErro } from './ui.js';
import { un } from './telas.js';

// ---------- consumo da frota ----------
export async function consumo(raiz) {
  const f = { de: '', ate: '' };
  const corpo = h('div');
  async function carregar() {
    const [linhas, alertas] = await Promise.all([api('GET', '/api/frota/consumo', f), api('GET', '/api/frota/alertas')]);
    trocar(corpo, 
      alertas.length ? h('div', { class: 'painel' }, h('h2', {}, 'Manutenções vencidas ou próximas'), alertas.map((a) => h('p', {},
        tag(a.vencido ? 'Vencida' : 'Próxima', a.vencido ? 'erro' : 'alerta'), ` ${a.equipamento_nome}: ${a.descricao}`,
        a.leitura_restante !== null ? ` · ${a.leitura_restante <= 0 ? `passou ${fmt.numero(-a.leitura_restante, 1)}` : `faltam ${fmt.numero(a.leitura_restante, 1)}`} ${a.unidade}` : '',
        a.dias_restantes !== null ? ` · ${a.dias_restantes <= 0 ? `${-a.dias_restantes} dia(s) de atraso` : `${a.dias_restantes} dia(s)`}` : ''))) : null,
      tabela([
        { rotulo: 'Equipamento', valor: (l) => `${l.nome}${l.placa ? ` (${l.placa})` : ''}` },
        { rotulo: 'Abastecimentos', classe: 'num', campo: 'abastecimentos' },
        { rotulo: 'Litros', classe: 'num', valor: (l) => fmt.numero(l.litros_total, 1) },
        { rotulo: 'Gasto', classe: 'num', valor: (l) => fmt.dinheiro(l.valor_total) },
        { rotulo: 'Rodado / trabalhado', classe: 'num', valor: (l) => `${fmt.numero(l.percorrido, 1)} ${un(l.tipo)}` },
        { rotulo: 'Média', classe: 'num', valor: (l) => (l.media === null ? '—' : [h('strong', {}, `${fmt.numero(l.media, 2)} ${l.unidade}`), l.estimado ? [' ', tag('estimada', 'alerta')] : null]) },
        { rotulo: 'Custo', classe: 'num', valor: (l) => (l.custo_por_unidade === null ? '—' : `${fmt.dinheiro(l.custo_por_unidade)} / ${un(l.tipo)}`) },
        { rotulo: 'Preço médio', classe: 'num', valor: (l) => (l.preco_medio_litro === null ? '—' : `${fmt.numero(l.preco_medio_litro, 3)} R$/L`) },
      ], linhas, { vazio: 'Nenhum abastecimento no período.' }),
      h('p', { class: 'vazio' }, 'Veículos em km/L e máquinas em L/h. A média é calculada entre abastecimentos de tanque cheio; "estimada" indica que ainda não há dois tanques cheios no período.'));
  }
  const mudar = (campo) => (ev) => { f[campo] = ev.target.value; carregar().catch(avisarErro); };
  trocar(raiz, 
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Consumo e custo da frota')),
    h('div', { class: 'filtros' }, h('label', {}, 'De', h('input', { type: 'date', onchange: mudar('de') })), h('label', {}, 'Até', h('input', { type: 'date', onchange: mudar('ate') }))),
    corpo);
  await carregar();
}

// ---------- usuários ----------
export async function usuarios(raiz) {
  const corpo = h('div');
  const perfis = await api('GET', '/api/perfis');
  const opcoesPerfil = perfis.map((p) => [p.id, p.nome]);

  async function carregar() {
    const lista = await api('GET', '/api/usuarios');
    trocar(corpo, tabela([
      { rotulo: 'Nome', campo: 'nome' }, { rotulo: 'E-mail', campo: 'email' }, { rotulo: 'Perfil', valor: (u) => tag(u.perfil, 'info') },
      { rotulo: 'Último acesso', valor: (u) => fmt.dataHora(u.ultimo_login) },
      { rotulo: '', classe: 'acoes', valor: (u) => [
        h('button', { class: 'mini', onclick: () => trocarPerfil(u) }, 'Trocar perfil'),
        h('button', { class: 'mini', onclick: () => redefinir(u) }, 'Redefinir senha'),
        u.id !== estado.usuario.id ? h('button', { class: 'mini perigo', onclick: () => remover(u) }, 'Remover acesso') : null,
      ] },
    ], lista));
  }
  const novo = () => {
    const m = modal('Dar acesso a um usuário', h('div', {},
      h('p', {}, 'Se o e-mail já tiver cadastro no sistema, ele só é vinculado a esta empresa (nome e senha são ignorados).'),
      formulario([
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, max: 160 }, { nome: 'perfil_id', rotulo: 'Perfil', tipo: 'select', opcoes: opcoesPerfil, obrigatorio: true },
        { nome: 'nome', rotulo: 'Nome', max: 120 }, { nome: 'senha', rotulo: 'Senha inicial (8+ caracteres, letras e números)', tipo: 'senha' },
      ], null, { aoCancelar: () => m.fechar(), aoSalvar: async (d) => { await api('POST', '/api/usuarios', { ...d, perfil_id: Number(d.perfil_id) }); m.fechar(); toast('Acesso concedido', 'ok'); await carregar(); } })));
  };
  const trocarPerfil = (u) => {
    const m = modal(`Perfil de ${u.nome}`, formulario([{ nome: 'perfil_id', rotulo: 'Perfil', tipo: 'select', opcoes: opcoesPerfil, obrigatorio: true, largo: true }], u, {
      aoCancelar: () => m.fechar(), aoSalvar: async (d) => { await api('PUT', `/api/usuarios/${u.id}`, { perfil_id: Number(d.perfil_id) }); m.fechar(); toast('Perfil alterado', 'ok'); await carregar(); },
    }));
  };
  const redefinir = (u) => {
    const m = modal(`Nova senha para ${u.nome}`, formulario([{ nome: 'senha', rotulo: 'Nova senha (8+ caracteres, letras e números)', tipo: 'senha', obrigatorio: true, largo: true }], null, {
      aoCancelar: () => m.fechar(), aoSalvar: async (d) => { await api('POST', `/api/usuarios/${u.id}/senha`, d); m.fechar(); toast('Senha redefinida; as sessões dele foram encerradas', 'ok'); },
    }));
  };
  const remover = async (u) => {
    if (!(await confirmar(`Remover o acesso de ${u.nome} a esta empresa?`, 'Remover'))) return;
    try { await api('DELETE', `/api/usuarios/${u.id}`); toast('Acesso removido', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
  };
  trocar(raiz, h('div', { class: 'cabecalho' }, h('h1', {}, 'Usuários'), h('button', { class: 'primario', onclick: novo }, '+ Dar acesso')), corpo);
  await carregar();
}

// ---------- perfis e permissões ----------
export async function perfis(raiz) {
  const corpo = h('div');
  const todas = await api('GET', '/api/perfis/permissoes');

  const editar = (p) => {
    const nome = h('input', { type: 'text', value: p ? p.nome : '', maxlength: 60, required: true });
    const marcas = Object.entries(todas).map(([chave, descricao]) => {
      const c = h('input', { type: 'checkbox' });
      c.checked = !!p && p.permissoes.includes(chave);
      return { chave, c, no: h('label', {}, c, h('span', {}, descricao)) };
    });
    const m = modal(p ? `Perfil ${p.nome}` : 'Novo perfil', h('div', {},
      h('label', { class: 'campo' }, h('span', {}, 'Nome do perfil *'), nome),
      h('h3', {}, 'O que este perfil pode fazer'),
      h('div', { class: 'permissoes' }, marcas.map((x) => x.no)),
      h('div', { class: 'form' }, h('div', { class: 'rodape' },
        h('button', { onclick: () => m.fechar() }, 'Cancelar'),
        h('button', { class: 'primario', onclick: async () => {
          const dados = { nome: nome.value.trim(), permissoes: marcas.filter((x) => x.c.checked).map((x) => x.chave) };
          try {
            if (p) await api('PUT', `/api/perfis/${p.id}`, dados); else await api('POST', '/api/perfis', dados);
            m.fechar(); toast('Perfil salvo', 'ok'); await carregar();
          } catch (e) { avisarErro(e); }
        } }, 'Salvar')))), { largo: true });
  };

  async function carregar() {
    const lista = await api('GET', '/api/perfis');
    trocar(corpo, tabela([
      { rotulo: 'Perfil', campo: 'nome' },
      { rotulo: 'Permissões', valor: (p) => (p.sistema ? 'Acesso total (fixo)' : `${p.permissoes.length} de ${Object.keys(todas).length}`) },
      { rotulo: 'Usuários', classe: 'num', campo: 'usuarios' },
      { rotulo: '', classe: 'acoes', valor: (p) => (p.sistema ? null : [
        h('button', { class: 'mini', onclick: () => editar(p) }, 'Alterar'),
        h('button', { class: 'mini perigo', onclick: async () => {
          if (!(await confirmar(`Excluir o perfil ${p.nome}?`, 'Excluir'))) return;
          try { await api('DELETE', `/api/perfis/${p.id}`); toast('Perfil excluído', 'ok'); await carregar(); } catch (e) { avisarErro(e); }
        } }, 'Excluir'),
      ]) },
    ], lista));
  }
  trocar(raiz, h('div', { class: 'cabecalho' }, h('h1', {}, 'Perfis de acesso'), h('button', { class: 'primario', onclick: () => editar(null) }, '+ Novo perfil')), corpo);
  await carregar();
}

// ---------- auditoria ----------
export async function auditoria(raiz) {
  const f = { pagina: 1, de: '', ate: '' };
  const corpo = h('div');
  const rodape = h('div', { class: 'paginacao' });
  const ACOES = { POST: 'Inclusão', PUT: 'Alteração', DELETE: 'Exclusão', LOGIN: 'Login', LOGIN_FALHA: 'Login recusado' };
  async function carregar() {
    const r = await api('GET', '/api/auditoria', { ...f, por_pagina: 100 });
    trocar(corpo, tabela([
      { rotulo: 'Quando', valor: (a) => fmt.dataHora(a.criado_em) }, { rotulo: 'Usuário', campo: 'usuario_nome' },
      { rotulo: 'Ação', valor: (a) => tag(ACOES[a.acao] || a.acao, a.status >= 400 ? 'erro' : a.acao === 'DELETE' ? 'alerta' : 'info') },
      { rotulo: 'Onde', campo: 'rota' }, { rotulo: 'Resultado', classe: 'num', campo: 'status' },
      { rotulo: 'Dados enviados', valor: (a) => (a.dados ? h('button', { class: 'mini', onclick: () => modal('Dados enviados', h('pre', {}, (() => { try { return JSON.stringify(JSON.parse(a.dados), null, 2); } catch { return a.dados; } })())) }, 'Ver') : '') },
      { rotulo: 'IP', campo: 'ip' },
    ], r.dados, { vazio: 'Nenhum registro no período.' }));
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
    trocar(rodape, `${r.total} registro(s)`,
      h('button', { class: 'mini', disabled: f.pagina <= 1, onclick: () => { f.pagina -= 1; carregar().catch(avisarErro); } }, '‹ Anterior'),
      `Página ${f.pagina} de ${paginas}`,
      h('button', { class: 'mini', disabled: f.pagina >= paginas, onclick: () => { f.pagina += 1; carregar().catch(avisarErro); } }, 'Próxima ›'));
  }
  const mudar = (campo) => (ev) => { f[campo] = ev.target.value; f.pagina = 1; carregar().catch(avisarErro); };
  trocar(raiz, 
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Auditoria')),
    h('p', { class: 'vazio' }, 'Registro de tudo o que foi incluído, alterado ou excluído nesta empresa, e de quem fez.'),
    h('div', { class: 'filtros' }, h('label', {}, 'De', h('input', { type: 'date', onchange: mudar('de') })), h('label', {}, 'Até', h('input', { type: 'date', onchange: mudar('ate') }))),
    corpo, rodape);
  await carregar();
}

// ---------- empresas (administrador do sistema) ----------
export async function empresas(raiz) {
  const corpo = h('div');
  async function carregar() {
    const lista = await api('GET', '/api/admin/empresas');
    trocar(corpo, tabela([
      { rotulo: 'Razão social', campo: 'razao_social' }, { rotulo: 'CNPJ', campo: 'cnpj' }, { rotulo: 'Usuários', classe: 'num', campo: 'usuarios' },
      { rotulo: 'Desde', valor: (e) => fmt.data(e.criado_em) }, { rotulo: 'Situação', valor: (e) => (e.ativo ? tag('Ativa', 'ok') : tag('Desativada', 'erro')) },
      { rotulo: '', classe: 'acoes', valor: (e) => h('button', { class: `mini${e.ativo ? ' perigo' : ''}`, onclick: async () => {
        if (!(await confirmar(e.ativo ? `Desativar ${e.razao_social}? Ninguém conseguirá acessá-la até ser reativada. Nada é apagado.` : `Reativar ${e.razao_social}?`))) return;
        try { await api('PUT', `/api/admin/empresas/${e.id}`, { ativo: !e.ativo }); await carregar(); } catch (er) { avisarErro(er); }
      } }, e.ativo ? 'Desativar' : 'Reativar') },
    ], lista));
  }
  const nova = () => {
    const m = modal('Nova empresa (cliente)', h('div', {},
      h('p', {}, 'A empresa já nasce com perfis e plano de contas padrão. Informe quem será o administrador dela.'),
      formulario([
        { nome: 'razao_social', rotulo: 'Razão social', obrigatorio: true, largo: true, max: 150 },
        { nome: 'nome_fantasia', rotulo: 'Nome fantasia', max: 150 }, { nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true, max: 18 },
        { nome: 'adm_email', rotulo: 'E-mail do administrador', tipo: 'email', obrigatorio: true, max: 160 }, { nome: 'adm_nome', rotulo: 'Nome do administrador', max: 120 },
        { nome: 'adm_senha', rotulo: 'Senha inicial (se for usuário novo)', tipo: 'senha' },
      ], null, {
        aoCancelar: () => m.fechar(),
        aoSalvar: async (d) => {
          await api('POST', '/api/admin/empresas', { razao_social: d.razao_social, nome_fantasia: d.nome_fantasia, cnpj: d.cnpj, admin: { email: d.adm_email, nome: d.adm_nome, senha: d.adm_senha } });
          m.fechar(); toast('Empresa criada', 'ok'); await carregar();
        },
      })));
  };
  trocar(raiz, h('div', { class: 'cabecalho' }, h('h1', {}, 'Empresas do sistema'), h('button', { class: 'primario', onclick: nova }, '+ Nova empresa')), corpo);
  await carregar();
}
