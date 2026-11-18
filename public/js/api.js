// Comunicação com a API. O token fica num cookie httpOnly: o JavaScript não o lê nem o guarda.
export const estado = { usuario: null, empresas: [], empresa: null, permissoes: new Set() };

export class ErroApi extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes || {};
  }
}

export const pode = (permissao) => estado.permissoes.has('*') || estado.permissoes.has(permissao);

function cabecalhos(extra = {}) {
  const c = { 'X-Requested-With': 'erp', ...extra };
  if (estado.empresa) c['X-Empresa-Id'] = String(estado.empresa.id);
  return c;
}

async function tratar(resposta) {
  if (resposta.status === 204) return null;
  let corpo = null;
  try { corpo = await resposta.json(); } catch { /* resposta sem JSON */ }
  if (!resposta.ok) {
    if (resposta.status === 401 && estado.usuario) window.dispatchEvent(new Event('sessao-expirada'));
    throw new ErroApi(resposta.status, (corpo && corpo.erro) || `Erro ${resposta.status}`, corpo && corpo.detalhes);
  }
  return corpo;
}

// api('GET', '/api/pessoas', { q: 'abc' })  -> parâmetros viram query string
// api('POST', '/api/pessoas', { nome: 'X' }) -> corpo JSON
// api('POST', '/api/arquivos', formData)     -> multipart
export async function api(metodo, rota, dados) {
  const opcoes = { method: metodo, credentials: 'same-origin', headers: cabecalhos() };
  let url = rota;
  if (metodo === 'GET' && dados) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(dados)) if (v !== null && v !== undefined && v !== '') qs.set(k, v);
    if ([...qs].length) url += (rota.includes('?') ? '&' : '?') + qs;
  } else if (dados instanceof FormData) {
    opcoes.body = dados;
  } else if (dados !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(dados);
  }
  return tratar(await fetch(url, opcoes));
}

// Baixa um anexo (precisa dos cabeçalhos, por isso não é um link comum).
export async function baixar(rota, nome) {
  const resposta = await fetch(rota, { credentials: 'same-origin', headers: cabecalhos() });
  if (!resposta.ok) return tratar(resposta);
  const url = URL.createObjectURL(await resposta.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return null;
}

export function escolherEmpresa(id) {
  const empresa = estado.empresas.find((e) => e.id === Number(id)) || estado.empresas[0] || null;
  estado.empresa = empresa;
  estado.permissoes = new Set(empresa ? empresa.permissoes : []);
  try { if (empresa) localStorage.setItem('empresa', String(empresa.id)); } catch { /* sem armazenamento */ }
}

export function aplicarSessao(dados) {
  estado.usuario = dados.usuario;
  estado.empresas = dados.empresas;
  let salva = null;
  try { salva = localStorage.getItem('empresa'); } catch { /* sem armazenamento */ }
  escolherEmpresa(salva);
}

export function limparSessao() {
  estado.usuario = null;
  estado.empresas = [];
  estado.empresa = null;
  estado.permissoes = new Set();
}
