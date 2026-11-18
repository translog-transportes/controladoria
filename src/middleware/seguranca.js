const { query } = require('../db');

// Limitador de requisições em memória. Serve para um servidor só; com vários
// servidores atrás de um balanceador, troque por Redis.
function limitador({ janelaMs, max, mensagem, chave = (req) => req.ip }) {
  const acessos = new Map();
  setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of acessos) if (v.expira <= agora) acessos.delete(k);
  }, 60000).unref();

  return (req, res, next) => {
    const k = chave(req);
    const agora = Date.now();
    let v = acessos.get(k);
    if (!v || v.expira <= agora) {
      v = { n: 0, expira: agora + janelaMs };
      acessos.set(k, v);
    }
    v.n += 1;
    if (v.n > max) {
      res.set('Retry-After', String(Math.ceil((v.expira - agora) / 1000)));
      return res.status(429).json({ erro: mensagem });
    }
    next();
  };
}

// Remove senhas e tokens antes de gravar o corpo da requisição na auditoria.
function semSegredos(valor, nivel = 0) {
  if (valor === null || typeof valor !== 'object' || nivel > 5) return valor;
  if (Array.isArray(valor)) return valor.slice(0, 200).map((v) => semSegredos(v, nivel + 1));
  const saida = {};
  for (const [k, v] of Object.entries(valor)) {
    saida[k] = /senha|password|token|segredo/i.test(k) ? '***' : semSegredos(v, nivel + 1);
  }
  return saida;
}

function registrar({ empresaId = null, usuarioId = null, acao, rota, status, dados, ip }) {
  let texto = null;
  if (dados && Object.keys(dados).length) texto = JSON.stringify(semSegredos(dados)).slice(0, 8000);
  // A auditoria nunca pode derrubar a requisição: falha aqui só vai para o log.
  query('INSERT INTO auditoria (empresa_id, usuario_id, acao, rota, status, dados, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    empresaId, usuarioId, acao, String(rota).slice(0, 255), status, texto, ip || null,
  ]).catch((e) => console.error('Falha ao gravar auditoria:', e.message));
}

// Grava toda requisição que altera dados (POST, PUT, DELETE), com quem fez, onde e o resultado.
function auditar(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/auth/login')) return next();
  res.on('finish', () => {
    if (!req.usuario) return;
    registrar({
      empresaId: req.empresaId,
      usuarioId: req.usuario.id,
      acao: req.method,
      rota: req.originalUrl,
      status: res.statusCode,
      dados: req.body,
      ip: req.ip,
    });
  });
  next();
}

module.exports = { limitador, auditar, registrar };
