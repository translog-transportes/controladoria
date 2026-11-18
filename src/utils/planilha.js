const { ErroApp } = require('../middleware/errors');

const MAX_LINHAS = 5000;
const MAX_COLUNAS = 30;
const CAMPOS = ['codigo', 'descricao', 'unidade', 'quantidade', 'preco_unitario', 'valor_total'];

// Palavras que identificam cada coluna no cabeçalho da planilha orçamentária.
const PADROES = {
  codigo: /^(item|itens|c[oó]d(igo)?\.?|n[ºo°]?\.?)$/i,
  descricao: /(descri|discrimina|servi[cç]o|especifica)/i,
  unidade: /^(un|und|unid|unidade)\.?$/i,
  quantidade: /(quant|^qtd|^qtde)/i,
  preco_unitario: /(unit)/i,
  valor_total: /(total)/i,
};

function textoDaCelula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return textoDaCelula(v.result); // fórmula: usa o resultado
    if (v.text !== undefined) return String(v.text); // hiperlink
    if (v.error) return '';
    return '';
  }
  return String(v);
}

function valorDaCelula(v) {
  if (v && typeof v === 'object' && !(v instanceof Date) && v.result !== undefined) return v.result;
  return typeof v === 'number' ? v : textoDaCelula(v).trim();
}

// Lê a primeira aba de um .xlsx e devolve uma matriz de células (número ou texto).
async function lerPlanilha(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ErroApp(422, 'Não foi possível ler a planilha. Salve como .xlsx e tente de novo.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ErroApp(422, 'A planilha não tem nenhuma aba');

  const linhas = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > MAX_LINHAS) return;
    const valores = Array.isArray(row.values) ? row.values.slice(1, MAX_COLUNAS + 1) : [];
    const celulas = [];
    for (let i = 0; i < valores.length; i++) celulas.push(valorDaCelula(valores[i]));
    linhas[n - 1] = celulas;
  });
  for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
  return linhas;
}

// "1.234,56" -> 1234.56 ; "R$ 10,00" -> 10 ; número continua número.
function numeroBR(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Procura a linha de cabeçalho nas 40 primeiras linhas e sugere qual coluna é qual campo.
function detectar(linhas) {
  let melhor = { linhaCabecalho: 1, mapeamento: {}, acertos: 0 };
  for (let i = 0; i < Math.min(linhas.length, 40); i++) {
    const mapa = {};
    linhas[i].forEach((cel, col) => {
      const txt = String(cel ?? '').trim();
      if (!txt || txt.length > 40) return;
      for (const campo of CAMPOS) {
        if (mapa[campo] === undefined && PADROES[campo].test(txt)) {
          // "Preço total" não pode ser confundido com "Preço unitário"
          if (campo === 'preco_unitario' && /total/i.test(txt)) continue;
          mapa[campo] = col;
          break;
        }
      }
    });
    const acertos = Object.keys(mapa).length;
    if (acertos > melhor.acertos) melhor = { linhaCabecalho: i + 1, mapeamento: mapa, acertos };
  }
  return { linhaCabecalho: melhor.linhaCabecalho, mapeamento: melhor.mapeamento };
}

function validarMapeamento(m) {
  if (!m || typeof m !== 'object') throw new ErroApp(422, 'Mapeamento de colunas inválido');
  const saida = {};
  for (const campo of CAMPOS) {
    if (m[campo] === undefined || m[campo] === null || m[campo] === '') continue;
    const col = Number(m[campo]);
    if (!Number.isInteger(col) || col < 0 || col >= MAX_COLUNAS) throw new ErroApp(422, `Coluna inválida para ${campo}`);
    saida[campo] = col;
  }
  if (saida.codigo === undefined || saida.descricao === undefined) {
    throw new ErroApp(422, 'Indique ao menos as colunas de código (item) e descrição');
  }
  return saida;
}

// Transforma as linhas da planilha em itens. Linha com código e descrição mas sem
// quantidade e preço vira fase (agrupador). Linhas sem código são ignoradas (títulos, totais).
function montarItens(linhas, linhaCabecalho, mapeamento) {
  const itens = [];
  const avisos = [];
  const usados = new Set();
  let ignoradas = 0;

  for (let i = linhaCabecalho; i < linhas.length; i++) {
    const linha = linhas[i];
    const cel = (campo) => (mapeamento[campo] === undefined ? '' : linha[mapeamento[campo]]);

    let codigo = String(cel('codigo') ?? '').trim().replace(/\.$/, '');
    const descricao = String(cel('descricao') ?? '').trim().replace(/\s+/g, ' ');
    if (!/^\d+(\.\d+)*$/.test(codigo) || !descricao) { ignoradas += 1; continue; }

    // O Excel guarda "1.10" como o número 1,1 quando a coluna não é texto.
    // Se o código se repete, é esse caso: 1.1 de novo vira 1.10, depois 1.20...
    if (usados.has(codigo)) {
      const original = codigo;
      while (usados.has(codigo) && codigo.length < 30) codigo += '0';
      avisos.push(`Linha ${i + 1}: código ${original} repetido, importado como ${codigo}. Confira.`);
    }
    usados.add(codigo);

    const quantidade = numeroBR(cel('quantidade'));
    const preco = numeroBR(cel('preco_unitario'));
    const total = numeroBR(cel('valor_total'));
    const fase = !(quantidade > 0 && preco !== null && preco >= 0);

    itens.push({
      linha: i + 1,
      codigo,
      descricao: descricao.slice(0, 500),
      unidade: fase ? null : String(cel('unidade') ?? '').trim().slice(0, 15) || null,
      quantidade: fase ? null : quantidade.toFixed(4),
      preco_unitario: fase ? null : preco.toFixed(4),
      valor_total: fase ? null : (total !== null && total >= 0 ? total : quantidade * preco).toFixed(2),
      fase: fase ? 1 : 0,
    });
  }
  if (!itens.length) throw new ErroApp(422, 'Nenhum item encontrado. Confira a linha do cabeçalho e as colunas escolhidas.');
  return { itens, avisos, ignoradas };
}

module.exports = { lerPlanilha, detectar, validarMapeamento, montarItens, numeroBR, CAMPOS };
