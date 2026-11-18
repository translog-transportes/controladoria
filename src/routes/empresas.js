const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { query, transacao } = require('../db');
const { ah, ErroApp } = require('../middleware/errors');
const { selecionarEmpresa, exigir, exigirSuperAdmin } = require('../middleware/auth');
const { validar, paginacao, senhaForte, REGRA_SENHA, dataValida } = require('../utils/validate');
const { criarDadosIniciais } = require('../utils/planoPadrao');
const { PERMISSOES, permissoesValidas } = require('../permissoes');

const camposEmpresa = {
  razao_social: { tipo: 'texto', obrigatorio: true, max: 150 },
  nome_fantasia: { tipo: 'texto', max: 150 },
  cnpj: { tipo: 'texto', obrigatorio: true, somenteDigitos: true, max: 14 },
};
const camposUsuario = {
  nome: { tipo: 'texto', max: 120 },
  email: { tipo: 'texto', obrigatorio: true, max: 160 },
  senha: { tipo: 'texto', max: 200 },
};

// Localiza o usuário pelo e-mail ou cria um novo. Nunca altera a senha de quem já existe.
async function acharOuCriarUsuario(conn, d) {
  const email = d.email.toLowerCase();
  const [[existente]] = await conn.query('SELECT id FROM usuarios WHERE email = ?', [email]);
  if (existente) return existente.id;
  if (!d.nome) throw new ErroApp(422, 'Usuário novo: informe o nome');
  if (!senhaForte(d.senha)) throw new ErroApp(422, `Usuário novo: ${REGRA_SENHA}`);
  const [r] = await conn.query('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', [
    d.nome, email, await bcrypt.hash(d.senha, config.bcryptCusto),
  ]);
  return r.insertId;
}

// ---------- /api/empresas ----------
const empresas = express.Router();

// Empresas que o usuário logado acessa
empresas.get('/', ah(async (req, res) => {
  res.json(await query(
    `SELECT e.*, p.nome AS perfil
       FROM usuario_empresas ue
       JOIN empresas e ON e.id = ue.empresa_id
       JOIN perfis p   ON p.id = ue.perfil_id
      WHERE ue.usuario_id = ? ORDER BY e.razao_social`,
    [req.usuario.id]
  ));
}));

// Altera os dados da empresa selecionada
empresas.put('/atual', selecionarEmpresa, exigir('empresa.gerenciar'), ah(async (req, res) => {
  const dados = validar(req.body, camposEmpresa, { parcial: true });
  if (!Object.keys(dados).length) throw new ErroApp(400, 'Nenhum campo para alterar');
  if (dados.cnpj && dados.cnpj.length !== 14) throw new ErroApp(422, 'CNPJ deve ter 14 dígitos');
  await query('UPDATE empresas SET ? WHERE id = ?', [dados, req.empresaId]);
  const [empresa] = await query('SELECT * FROM empresas WHERE id = ?', [req.empresaId]);
  res.json(empresa);
}));

// ---------- /api/admin (só o administrador do sistema) ----------
// O super admin cria e desativa empresas, mas não enxerga os dados delas:
// para isso precisaria ser vinculado como usuário por um administrador da própria empresa.
const admin = express.Router();
admin.use(exigirSuperAdmin);

admin.get('/empresas', ah(async (req, res) => {
  res.json(await query(
    `SELECT e.*, (SELECT COUNT(*) FROM usuario_empresas ue WHERE ue.empresa_id = e.id) AS usuarios
       FROM empresas e ORDER BY e.razao_social`
  ));
}));

// Cria a empresa com perfis e plano de contas padrão e já define o administrador dela.
// { razao_social, nome_fantasia, cnpj, admin: { nome, email, senha } }
admin.post('/empresas', ah(async (req, res) => {
  const dados = validar(req.body, camposEmpresa);
  if (dados.cnpj.length !== 14) throw new ErroApp(422, 'CNPJ deve ter 14 dígitos');
  const adm = validar(req.body.admin || {}, camposUsuario);

  const id = await transacao(async (conn) => {
    const [r] = await conn.query('INSERT INTO empresas SET ?', [dados]);
    const perfilAdminId = await criarDadosIniciais(conn, r.insertId);
    const usuarioId = await acharOuCriarUsuario(conn, adm);
    await conn.query('INSERT INTO usuario_empresas (usuario_id, empresa_id, perfil_id) VALUES (?, ?, ?)', [usuarioId, r.insertId, perfilAdminId]);
    return r.insertId;
  });
  const [empresa] = await query('SELECT * FROM empresas WHERE id = ?', [id]);
  res.status(201).json(empresa);
}));

// Ativa ou desativa uma empresa (cliente inadimplente, contrato encerrado etc.).
// Empresa desativada: ninguém consegue acessá-la, mas nada é apagado.
admin.put('/empresas/:id', ah(async (req, res) => {
  const { ativo } = validar(req.body, { ativo: { tipo: 'bool', obrigatorio: true } });
  const r = await query('UPDATE empresas SET ativo = ? WHERE id = ?', [ativo, req.params.id]);
  if (!r.affectedRows) throw new ErroApp(404, 'Empresa não encontrada');
  res.json({ id: Number(req.params.id), ativo });
}));

// ---------- /api/perfis ----------
const perfis = express.Router();
perfis.use(exigir('usuarios.gerenciar'));

const lerPerfil = (p) => ({ ...p, permissoes: typeof p.permissoes === 'string' ? JSON.parse(p.permissoes) : p.permissoes });

perfis.get('/permissoes', (req, res) => res.json(PERMISSOES));

perfis.get('/', ah(async (req, res) => {
  const linhas = await query(
    `SELECT p.*, (SELECT COUNT(*) FROM usuario_empresas ue WHERE ue.perfil_id = p.id) AS usuarios
       FROM perfis p WHERE p.empresa_id = ? ORDER BY p.sistema DESC, p.nome`,
    [req.empresaId]
  );
  res.json(linhas.map(lerPerfil));
}));

function validarPerfil(body) {
  const { nome } = validar(body, { nome: { tipo: 'texto', obrigatorio: true, max: 60 } });
  // "*" (acesso total) é exclusivo do perfil Administrador e não pode ser concedido por aqui.
  if (!permissoesValidas(body.permissoes)) throw new ErroApp(422, 'Lista de permissões inválida');
  return { nome, permissoes: JSON.stringify([...new Set(body.permissoes)]) };
}

perfis.post('/', ah(async (req, res) => {
  const d = validarPerfil(req.body);
  const r = await query('INSERT INTO perfis (empresa_id, nome, permissoes) VALUES (?, ?, ?)', [req.empresaId, d.nome, d.permissoes]);
  res.status(201).json({ id: r.insertId, nome: d.nome, permissoes: JSON.parse(d.permissoes) });
}));

perfis.put('/:id', ah(async (req, res) => {
  const d = validarPerfil(req.body);
  const r = await query('UPDATE perfis SET nome = ?, permissoes = ? WHERE empresa_id = ? AND id = ? AND sistema = 0', [d.nome, d.permissoes, req.empresaId, req.params.id]);
  if (!r.affectedRows) throw new ErroApp(409, 'Perfil não encontrado ou é o Administrador (que não pode ser alterado)');
  res.json({ id: Number(req.params.id), nome: d.nome, permissoes: JSON.parse(d.permissoes) });
}));

perfis.delete('/:id', ah(async (req, res) => {
  const r = await query('DELETE FROM perfis WHERE empresa_id = ? AND id = ? AND sistema = 0', [req.empresaId, req.params.id]);
  if (!r.affectedRows) throw new ErroApp(409, 'Perfil não encontrado ou é o Administrador (que não pode ser excluído)');
  res.status(204).end();
}));

// ---------- /api/usuarios (usuários da empresa selecionada) ----------
const usuarios = express.Router();
usuarios.use(exigir('usuarios.gerenciar'));

usuarios.get('/', ah(async (req, res) => {
  res.json(await query(
    `SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_login, p.id AS perfil_id, p.nome AS perfil
       FROM usuario_empresas ue
       JOIN usuarios u ON u.id = ue.usuario_id
       JOIN perfis p   ON p.id = ue.perfil_id
      WHERE ue.empresa_id = ? ORDER BY u.nome`,
    [req.empresaId]
  ));
}));

// Dá acesso à empresa. Se o e-mail já existe no sistema, só vincula (sem mexer na senha);
// se não existe, cria o usuário.
usuarios.post('/', ah(async (req, res) => {
  const d = validar(req.body, { ...camposUsuario, perfil_id: { tipo: 'inteiro', obrigatorio: true } });
  const usuarioId = await transacao(async (conn) => {
    const id = await acharOuCriarUsuario(conn, d);
    // A FK composta (empresa_id, perfil_id) garante que o perfil é desta empresa.
    await conn.query(
      'INSERT INTO usuario_empresas (usuario_id, empresa_id, perfil_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE perfil_id = VALUES(perfil_id)',
      [id, req.empresaId, d.perfil_id]
    );
    return id;
  });
  res.status(201).json({ id: usuarioId, email: d.email.toLowerCase(), perfil_id: d.perfil_id });
}));

// A empresa nunca pode ficar sem um Administrador.
async function garantirOutroAdmin(conn, empresaId, usuarioId) {
  const [[{ outros }]] = await conn.query(
    `SELECT COUNT(*) AS outros FROM usuario_empresas ue JOIN perfis p ON p.id = ue.perfil_id
      WHERE ue.empresa_id = ? AND p.sistema = 1 AND ue.usuario_id <> ? FOR UPDATE`,
    [empresaId, usuarioId]
  );
  if (!outros) throw new ErroApp(409, 'A empresa precisa ter pelo menos um Administrador');
}

// Troca o perfil de um usuário nesta empresa
usuarios.put('/:id', ah(async (req, res) => {
  const { perfil_id: perfilId } = validar(req.body, { perfil_id: { tipo: 'inteiro', obrigatorio: true } });
  await transacao(async (conn) => {
    const [[perfil]] = await conn.query('SELECT sistema FROM perfis WHERE empresa_id = ? AND id = ?', [req.empresaId, perfilId]);
    if (!perfil) throw new ErroApp(422, 'Perfil não existe nesta empresa');
    if (!perfil.sistema) await garantirOutroAdmin(conn, req.empresaId, req.params.id);
    const [r] = await conn.query('UPDATE usuario_empresas SET perfil_id = ? WHERE usuario_id = ? AND empresa_id = ?', [perfilId, req.params.id, req.empresaId]);
    if (!r.affectedRows) throw new ErroApp(404, 'Usuário não encontrado nesta empresa');
  });
  res.json({ id: Number(req.params.id), perfil_id: perfilId });
}));

// Redefine a senha de um usuário. Só é permitido quando ele pertence apenas a esta empresa:
// assim o administrador de uma empresa nunca ganha acesso a contas usadas em outras.
usuarios.post('/:id/senha', ah(async (req, res) => {
  const { senha } = validar(req.body, { senha: { tipo: 'texto', obrigatorio: true, max: 200 } });
  if (!senhaForte(senha)) throw new ErroApp(422, REGRA_SENHA);
  const vinculos = await query('SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?', [req.params.id]);
  if (!vinculos.some((v) => v.empresa_id === req.empresaId)) throw new ErroApp(404, 'Usuário não encontrado nesta empresa');
  if (vinculos.length > 1) throw new ErroApp(409, 'Este usuário acessa outras empresas; ele mesmo deve trocar a senha');
  const [alvo] = await query('SELECT super_admin FROM usuarios WHERE id = ?', [req.params.id]);
  if (alvo.super_admin) throw new ErroApp(403, 'Não é possível redefinir a senha do administrador do sistema');
  await query(
    'UPDATE usuarios SET senha_hash = ?, token_versao = token_versao + 1, tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?',
    [await bcrypt.hash(senha, config.bcryptCusto), req.params.id]
  );
  res.status(204).end();
}));

// Remove o acesso do usuário a esta empresa (não apaga o usuário nem o histórico)
usuarios.delete('/:id', ah(async (req, res) => {
  await transacao(async (conn) => {
    await garantirOutroAdmin(conn, req.empresaId, req.params.id);
    const [r] = await conn.query('DELETE FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?', [req.params.id, req.empresaId]);
    if (!r.affectedRows) throw new ErroApp(404, 'Usuário não encontrado nesta empresa');
  });
  res.status(204).end();
}));

// ---------- /api/auditoria ----------
const auditoria = express.Router();
auditoria.get('/', exigir('auditoria.ver'), ah(async (req, res) => {
  const where = ['a.empresa_id = ?'];
  const params = [req.empresaId];
  if (req.query.usuario_id) { where.push('a.usuario_id = ?'); params.push(Number(req.query.usuario_id)); }
  if (dataValida(req.query.de)) { where.push('a.criado_em >= ?'); params.push(req.query.de); }
  if (dataValida(req.query.ate)) { where.push('a.criado_em <= ?'); params.push(`${req.query.ate} 23:59:59`); }
  const { pagina, porPagina, offset } = paginacao(req.query);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM auditoria a WHERE ${where.join(' AND ')}`, params);
  const dados = await query(
    `SELECT a.*, u.nome AS usuario_nome FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, porPagina, offset]
  );
  res.json({ dados, pagina, por_pagina: porPagina, total });
}));

module.exports = { empresas, admin, perfis, usuarios, auditoria };
