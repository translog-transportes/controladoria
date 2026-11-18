require('dotenv').config();
const path = require('path');

function obrigatoria(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida (veja .env.example)`);
  return v;
}

const jwtSegredo = obrigatoria('JWT_SECRET');
if (jwtSegredo.length < 32) {
  throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres. Gere um com: npm run segredo');
}

module.exports = {
  porta: Number(process.env.PORT || 3000),
  jwtSegredo,
  sessaoHoras: Number(process.env.SESSAO_HORAS || 8),
  // true quando o sistema é acessado por https:// (cookie "Secure" e HSTS)
  https: process.env.HTTPS === 'true',
  // nº de proxies na frente do Node (nginx etc.), para o IP real aparecer na auditoria
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  bcryptCusto: 12,
  loginMaxFalhas: 5,
  loginBloqueioMinutos: 15,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: obrigatoria('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: obrigatoria('DB_NAME'),
  },
};
