const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { autenticar, selecionarEmpresa } = require('./middleware/auth');
const { limitador, auditar } = require('./middleware/seguranca');
const { naoEncontrado, tratarErros } = require('./middleware/errors');
const adm = require('./routes/empresas');
const cadastros = require('./routes/cadastros');
const lic = require('./routes/licitacoes');
const frota = require('./routes/frota');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Cabeçalhos de segurança. A política de conteúdo (CSP) só deixa o navegador executar
// scripts e estilos servidos pelo próprio sistema: mesmo que alguém consiga gravar um
// texto malicioso num cadastro, ele não roda.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: config.https,
  crossOriginEmbedderPolicy: false,
}));

app.use('/api', limitador({ janelaMs: 60 * 1000, max: 600, mensagem: 'Muitas requisições. Aguarde um instante.' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(auditar);

app.get('/api/saude', (req, res) => res.json({ ok: true }));

// Público (login)
app.use('/api/auth', require('./routes/auth'));

// Exige login
app.use('/api/empresas', autenticar, adm.empresas);
app.use('/api/admin', autenticar, adm.admin);

// Exige login + empresa selecionada (cabeçalho X-Empresa-Id). Cada rota confere a permissão.
const daEmpresa = [autenticar, selecionarEmpresa];
app.use('/api/perfis', daEmpresa, adm.perfis);
app.use('/api/usuarios', daEmpresa, adm.usuarios);
app.use('/api/auditoria', daEmpresa, adm.auditoria);
app.use('/api/pessoas', daEmpresa, cadastros.pessoas);
app.use('/api/categorias', daEmpresa, cadastros.categorias);
app.use('/api/centros-custo', daEmpresa, cadastros.centrosCusto);
app.use('/api/contas-bancarias', daEmpresa, cadastros.contasBancarias);
app.use('/api/lancamentos', daEmpresa, require('./routes/lancamentos'));
app.use('/api/relatorios', daEmpresa, require('./routes/relatorios'));
app.use('/api/licitacoes', daEmpresa, lic.licitacoes);
app.use('/api/documentos', daEmpresa, lic.documentos);
app.use('/api/arquivos', daEmpresa, lic.arquivos);
app.use('/api/contratos', daEmpresa, require('./routes/contratos'));
app.use('/api/equipamentos', daEmpresa, frota.equipamentos);
app.use('/api/planos-manutencao', daEmpresa, frota.planos);
app.use('/api/manutencoes', daEmpresa, frota.manutencoes);
app.use('/api/abastecimentos', daEmpresa, frota.abastecimentos);
app.use('/api/frota', daEmpresa, frota.frota);
const loc = require('./routes/locacoes');
app.use('/api/locacoes', daEmpresa, loc.locacoes);
app.use('/api/apontamentos', daEmpresa, loc.apontamentos);
app.use('/api', naoEncontrado);

// Telas (arquivos estáticos em /public)
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: config.https ? '1h' : 0 }));

app.use(naoEncontrado);
app.use(tratarErros);

module.exports = app;
