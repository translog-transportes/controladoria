// Aplica, em ordem, os arquivos de sql/ que ainda não foram aplicados.
// Uso: npm run migrate
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

async function main() {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS migracoes (
         arquivo VARCHAR(100) PRIMARY KEY,
         aplicado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB`
    );
    const [aplicadas] = await conn.query('SELECT arquivo FROM migracoes');
    const feitas = new Set(aplicadas.map((m) => m.arquivo));

    const pasta = path.join(__dirname, '..', 'sql');
    const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      process.stdout.write(`Aplicando ${arquivo}... `);
      await conn.query(fs.readFileSync(path.join(pasta, arquivo), 'utf8'));
      await conn.query('INSERT INTO migracoes (arquivo) VALUES (?)', [arquivo]);
      console.log('ok');
    }
    console.log('Banco atualizado.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(`\nFalha na migração: ${e.message}`);
  process.exit(1);
});
