const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { query } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { autenticar, emitirToken, limparToken } = require('../middleware/auth');
const { limitador, registrar } = require('../middleware/seguranca');
const { validar, senhaForte, REGRA_SENHA } = require('../utils/validate');

const r = express.Router();

// Hash de mentira: quando o e-mail não existe, comparamos com ele mesmo assim,
// para a resposta demorar o mesmo tempo e não revelar quais e-mails estão cadastrados.
const HASH_FALSO = bcrypt.hashSync('senha-que-nao-existe', config.bcryptCusto);
const MSG_LOGIN = 'E-mail ou senha incorretos, ou conta temporariamente bloqueada';

async function empresasDoUsuario(usuarioId) {
  const linhas = await query(
    `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, p.nome AS perfil, p.permissoes
       FROM usuario_empresas ue
       JOIN empresas e ON e.id = ue.empresa_id AND e.ativo = 1
       JOIN perfis p   ON p.id = ue.perfil_id
      WHERE ue.usuario_id = ?
      ORDER BY e.razao_social`,
    [usuarioId]
  );
  for (const l of linhas) if (typeof l.permissoes === 'string') l.permissoes = JSON.parse(l.permissoes);
  return linhas;
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, super_admin: !!u.super_admin });

// POST /api/auth/login  { email, senha }
// Proteções: limite de tentativas por IP, bloqueio da conta após 5 senhas erradas (15 min)
// e a mesma mensagem para qualquer falha.
r.post(
  '/login',
  limitador({ janelaMs: 15 * 60 * 1000, max: 30, mensagem: 'Muitas tentativas de login. Aguarde alguns minutos.' }),
  ah(async (req, res) => {
    const { email, senha } = validar(req.body, {
      email: { tipo: 'texto', obrigatorio: true, max: 160 },
      senha: { tipo: 'texto', obrigatorio: true, max: 200 },
    });
    const [usuario] = await query(
      `SELECT *, (bloqueado_ate IS NOT NULL AND bloqueado_ate > NOW()) AS bloqueado
         FROM usuarios WHERE email = ? AND ativo = 1`,
      [email.toLowerCase()]
    );
    const confere = await bcrypt.compare(senha, usuario ? usuario.senha_hash : HASH_FALSO);

    if (!usuario || usuario.bloqueado || !confere) {
      if (usuario && !usuario.bloqueado) {
        await query(
          `UPDATE usuarios
              SET tentativas_falhas = tentativas_falhas + 1,
                  bloqueado_ate = IF(tentativas_falhas >= ?, NOW() + INTERVAL ? MINUTE, bloqueado_ate)
            WHERE id = ?`,
          [config.loginMaxFalhas, config.loginBloqueioMinutos, usuario.id]
        );
      }
      registrar({ usuarioId: usuario ? usuario.id : null, acao: 'LOGIN_FALHA', rota: '/api/auth/login', status: 401, dados: { email }, ip: req.ip });
      throw new ErroApp(401, MSG_LOGIN);
    }

    await query('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login = NOW() WHERE id = ?', [usuario.id]);
    const token = emitirToken(res, usuario);
    registrar({ usuarioId: usuario.id, acao: 'LOGIN', rota: '/api/auth/login', status: 200, ip: req.ip });
    res.json({ token, usuario: publico(usuario), empresas: await empresasDoUsuario(usuario.id) });
  })
);

// GET /api/auth/me
r.get('/me', autenticar, ah(async (req, res) => {
  res.json({ usuario: publico(req.usuario), empresas: await empresasDoUsuario(req.usuario.id) });
}));

// POST /api/auth/logout  (encerra a sessão em todos os dispositivos)
r.post('/logout', autenticar, ah(async (req, res) => {
  await query('UPDATE usuarios SET token_versao = token_versao + 1 WHERE id = ?', [req.usuario.id]);
  limparToken(res);
  res.status(204).end();
}));

// PUT /api/auth/senha  { senha_atual, senha_nova }
// Derruba as outras sessões e devolve um token novo para esta.
r.put('/senha', autenticar, ah(async (req, res) => {
  const { senha_atual: atual, senha_nova: nova } = validar(req.body, {
    senha_atual: { tipo: 'texto', obrigatorio: true, max: 200 },
    senha_nova: { tipo: 'texto', obrigatorio: true, max: 200 },
  });
  if (!senhaForte(nova)) throw new ErroApp(422, REGRA_SENHA);
  const [u] = await query('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!(await bcrypt.compare(atual, u.senha_hash))) throw new ErroApp(401, 'Senha atual incorreta');

  await query('UPDATE usuarios SET senha_hash = ?, token_versao = token_versao + 1 WHERE id = ?', [
    await bcrypt.hash(nova, config.bcryptCusto), req.usuario.id,
  ]);
  const token = emitirToken(res, { id: req.usuario.id, token_versao: req.usuario.token_versao + 1 });
  res.json({ token });
}));

module.exports = r;
