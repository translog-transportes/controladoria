const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { ErroApp, ah } = require('./errors');

const COOKIE = 'erp_token';

// O token chega pelo cookie httpOnly (telas) ou por "Authorization: Bearer" (integrações).
function lerToken(req) {
  const cab = req.headers.authorization || '';
  if (cab.startsWith('Bearer ')) return { token: cab.slice(7), viaCookie: false };
  const m = /(?:^|;\s*)erp_token=([^;]+)/.exec(req.headers.cookie || '');
  return m ? { token: decodeURIComponent(m[1]), viaCookie: true } : { token: null, viaCookie: false };
}

function emitirToken(res, usuario) {
  const token = jwt.sign({ sub: usuario.id, tv: usuario.token_versao }, config.jwtSegredo, {
    algorithm: 'HS256',
    expiresIn: `${config.sessaoHoras}h`,
  });
  // httpOnly: o JavaScript da página não consegue ler o token (protege contra roubo por XSS).
  // sameSite strict: o navegador não envia o cookie em requisições vindas de outros sites (CSRF).
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.https,
    maxAge: config.sessaoHoras * 3600 * 1000,
    path: '/',
  });
  return token;
}

function limparToken(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.https, path: '/' });
}

const autenticar = ah(async (req, res, next) => {
  const { token, viaCookie } = lerToken(req);
  if (!token) throw new ErroApp(401, 'Sessão não iniciada');

  let dados;
  try {
    dados = jwt.verify(token, config.jwtSegredo, { algorithms: ['HS256'] });
  } catch {
    throw new ErroApp(401, 'Sessão inválida ou expirada');
  }

  // Segunda barreira contra CSRF: gravações autenticadas por cookie exigem um cabeçalho
  // que só o nosso próprio JavaScript consegue enviar.
  if (viaCookie && !['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'erp') {
    throw new ErroApp(403, 'Requisição recusada');
  }

  const [usuario] = await query(
    'SELECT id, nome, email, super_admin, token_versao FROM usuarios WHERE id = ? AND ativo = 1',
    [dados.sub]
  );
  // token_versao muda no logout e na troca de senha: tokens antigos deixam de valer na hora.
  if (!usuario || usuario.token_versao !== dados.tv) throw new ErroApp(401, 'Sessão encerrada; entre novamente');
  req.usuario = usuario;
  next();
});

// Confere se o usuário tem vínculo com a empresa do cabeçalho X-Empresa-Id e carrega as
// permissões do perfil dele NESSA empresa. Toda consulta usa req.empresaId.
const selecionarEmpresa = ah(async (req, res, next) => {
  const empresaId = Number(req.headers['x-empresa-id']);
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new ErroApp(400, 'Informe a empresa no cabeçalho X-Empresa-Id');
  }
  const [vinculo] = await query(
    `SELECT p.id AS perfil_id, p.nome AS perfil, p.permissoes
       FROM usuario_empresas ue
       JOIN empresas e ON e.id = ue.empresa_id AND e.ativo = 1
       JOIN perfis p   ON p.id = ue.perfil_id
      WHERE ue.usuario_id = ? AND ue.empresa_id = ?`,
    [req.usuario.id, empresaId]
  );
  if (!vinculo) throw new ErroApp(403, 'Você não tem acesso a esta empresa');
  const lista = typeof vinculo.permissoes === 'string' ? JSON.parse(vinculo.permissoes) : vinculo.permissoes;
  req.empresaId = empresaId;
  req.perfil = vinculo.perfil;
  req.permissoes = new Set(lista);
  next();
});

const tem = (req, permissao) => req.permissoes.has('*') || req.permissoes.has(permissao);

// exigir('financeiro.editar'): a rota só passa se o perfil tiver essa permissão
// (com mais de uma, basta ter qualquer delas).
const exigir = (...permissoes) => (req, res, next) => {
  if (permissoes.some((p) => tem(req, p))) return next();
  next(new ErroApp(403, 'Seu perfil não permite esta operação'));
};

const exigirSuperAdmin = (req, res, next) => {
  if (req.usuario.super_admin) return next();
  next(new ErroApp(403, 'Operação restrita ao administrador do sistema'));
};

module.exports = { autenticar, selecionarEmpresa, exigir, exigirSuperAdmin, tem, emitirToken, limparToken };
