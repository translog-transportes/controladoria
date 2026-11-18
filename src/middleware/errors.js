class ErroApp extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

// Permite usar async/await nas rotas do Express 4 sem try/catch em cada uma.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function naoEncontrado(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

// eslint-disable-next-line no-unused-vars
function tratarErros(err, req, res, next) {
  if (err instanceof ErroApp) {
    return res.status(err.status).json({ erro: err.message, detalhes: err.detalhes });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' });
  }
  if (err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 20 MB' : 'Envio de arquivo inválido';
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ erro: msg });
  }
  // Erros do MySQL traduzidos para respostas claras
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      return res.status(409).json({ erro: 'Já existe um registro com esses dados nesta empresa' });
    case 'ER_NO_REFERENCED_ROW_2':
      return res.status(422).json({ erro: 'Um dos cadastros informados não existe nesta empresa' });
    case 'ER_ROW_IS_REFERENCED_2':
      return res.status(409).json({ erro: 'Registro em uso; desative-o em vez de excluir' });
    case 'ER_BAD_NULL_ERROR':
      return res.status(422).json({ erro: 'Há um campo obrigatório vazio' });
    case 'ER_DATA_TOO_LONG':
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return res.status(422).json({ erro: 'Há um valor maior do que o campo comporta' });
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return res.status(422).json({ erro: 'Valor fora do permitido' });
    default:
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno' });
}

module.exports = { ErroApp, ah, naoEncontrado, tratarErros };
