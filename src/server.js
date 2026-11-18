const config = require('./config');
const app = require('./app');
const { pool } = require('./db');

const servidor = app.listen(config.porta, () => {
  console.log(`ERP Construtoras ouvindo em http://localhost:${config.porta}`);
});

function encerrar() {
  servidor.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
