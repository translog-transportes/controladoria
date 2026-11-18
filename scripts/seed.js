// Cria o administrador do sistema (super admin) e a primeira empresa, com perfis e plano de
// contas padrão, usando ADMIN_* e EMPRESA_* do .env. Pode rodar de novo sem duplicar nada.
// Uso: npm run seed
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { pool, transacao } = require('../src/db');
const { criarDadosIniciais } = require('../src/utils/planoPadrao');
const { senhaForte, REGRA_SENHA } = require('../src/utils/validate');

async function main() {
  const nome = process.env.ADMIN_NOME || 'Administrador';
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA || '';
  const razao = process.env.EMPRESA_RAZAO_SOCIAL;
  const cnpj = (process.env.EMPRESA_CNPJ || '').replace(/\D/g, '');
  if (!email || !razao || cnpj.length !== 14) {
    throw new Error('Defina ADMIN_EMAIL, ADMIN_SENHA, EMPRESA_RAZAO_SOCIAL e EMPRESA_CNPJ (14 dígitos) no .env');
  }
  if (!senhaForte(senha) || senha === 'trocar123') throw new Error(`ADMIN_SENHA: troque a senha de exemplo. ${REGRA_SENHA}.`);

  await transacao(async (conn) => {
    let [[usuario]] = await conn.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (!usuario) {
      const [r] = await conn.query('INSERT INTO usuarios (nome, email, senha_hash, super_admin) VALUES (?, ?, ?, 1)', [
        nome, email, await bcrypt.hash(senha, config.bcryptCusto),
      ]);
      usuario = { id: r.insertId };
      console.log(`Administrador do sistema criado: ${email}`);
    }

    const [[empresa]] = await conn.query('SELECT id FROM empresas WHERE cnpj = ?', [cnpj]);
    if (!empresa) {
      const [r] = await conn.query('INSERT INTO empresas (razao_social, cnpj) VALUES (?, ?)', [razao, cnpj]);
      const perfilAdminId = await criarDadosIniciais(conn, r.insertId);
      await conn.query('INSERT INTO usuario_empresas (usuario_id, empresa_id, perfil_id) VALUES (?, ?, ?)', [usuario.id, r.insertId, perfilAdminId]);
      console.log(`Empresa criada: ${razao} (id ${r.insertId})`);
    }
  });
  console.log('Pronto. Depois do primeiro login, apague ADMIN_SENHA do .env.');
}

main()
  .catch((e) => { console.error(`Falha no seed: ${e.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
