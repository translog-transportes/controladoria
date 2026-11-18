const mysql = require('mysql2/promise');
const config = require('./config');

// DECIMAL e DATE voltam como texto ("1234.56", "2026-11-14"):
// dinheiro nunca passa por ponto flutuante e data não sofre com fuso horário.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: false,
  charset: 'utf8mb4',
});

async function query(sql, params = []) {
  const [linhas] = await pool.query(sql, params);
  return linhas;
}

// Executa fn(conn) dentro de uma transação; desfaz tudo se der erro.
async function transacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transacao };
