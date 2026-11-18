const { ErroApp } = require('../middleware/errors');

// ---------- números decimais sem ponto flutuante ----------
// escalar("12.5", 4) -> 125000n   desescalar(125000n, 4) -> "12.5000"

function escalar(v, casas) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    v = v.toFixed(casas);
  }
  if (typeof v !== 'string') return null;
  const m = new RegExp(`^(-?)(\\d{1,13})(?:\\.(\\d{1,${casas}}))?$`).exec(v.trim());
  if (!m) return null;
  const n = BigInt(m[2]) * 10n ** BigInt(casas) + BigInt((m[3] || '').padEnd(casas, '0'));
  return m[1] ? -n : n;
}

function desescalar(n, casas) {
  const negativo = n < 0n;
  const abs = negativo ? -n : n;
  const base = 10n ** BigInt(casas);
  const txt = `${abs / base}.${String(abs % base).padStart(casas, '0')}`;
  return negativo ? `-${txt}` : txt;
}

// Dinheiro: sempre em centavos (inteiro) dentro do JS.
function paraCentavos(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    v = v.toFixed(2);
  }
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const centavos = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] ? -centavos : centavos;
}

function deCentavos(c) {
  const abs = Math.abs(c);
  const txt = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${txt}` : txt;
}

// quantidade (4 casas) x preço unitário (4 casas) -> centavos, arredondando meio para cima.
function qtdVezesPreco(qtd, preco) {
  const produto = escalar(String(qtd), 4) * escalar(String(preco), 4); // escala 10^8
  return Number((produto + 500000n) / 1000000n);
}

// ---------- datas: sempre texto AAAA-MM-DD ----------

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Soma meses mantendo o dia; se o mês não tiver o dia (31/01 + 1 mês), usa o último dia.
function somarMeses(data, meses) {
  const [a, m, d] = data.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

// ---------- senha ----------

function senhaForte(s) {
  return typeof s === 'string' && s.length >= 8 && s.length <= 200 && /[A-Za-zÀ-ÿ]/.test(s) && /\d/.test(s);
}
const REGRA_SENHA = 'A senha precisa ter pelo menos 8 caracteres, com letras e números';

// ---------- validação de corpo de requisição ----------
// esquema: { campo: { tipo, obrigatorio, padrao, max, valores, positivo, casas } }
// tipos: texto | inteiro | decimal | data | datahora | enum | bool
// Com { parcial: true } (usado no PUT) só valida os campos enviados.
// Campos fora do esquema são ignorados: a requisição nunca grava coluna que o código não listou.

function validar(dados, esquema, { parcial = false } = {}) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new ErroApp(400, 'Corpo da requisição inválido');
  }
  const saida = {};
  const erros = {};

  for (const [campo, regra] of Object.entries(esquema)) {
    let v = dados[campo];

    if (v === undefined) {
      if (parcial) continue;
      if (regra.obrigatorio) erros[campo] = 'obrigatório';
      else if ('padrao' in regra) saida[campo] = regra.padrao;
      continue;
    }
    if (v === null || v === '') {
      if (regra.obrigatorio) erros[campo] = 'obrigatório';
      // campo com valor padrão nunca fica nulo: vazio volta ao padrão (ou é ignorado no PUT)
      else if ('padrao' in regra) { if (!parcial) saida[campo] = regra.padrao; }
      else saida[campo] = null;
      continue;
    }

    switch (regra.tipo) {
      case 'texto':
        if (typeof v !== 'string') { erros[campo] = 'deve ser texto'; break; }
        v = v.trim();
        if (regra.somenteDigitos) v = v.replace(/\D/g, '');
        if (!v && regra.obrigatorio) { erros[campo] = 'obrigatório'; break; }
        if (regra.max && v.length > regra.max) { erros[campo] = `máximo de ${regra.max} caracteres`; break; }
        saida[campo] = v || null;
        break;
      case 'inteiro': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (regra.min ?? 1) || (regra.max && n > regra.max)) {
          erros[campo] = 'número inteiro inválido';
          break;
        }
        saida[campo] = n;
        break;
      }
      case 'decimal': {
        const casas = regra.casas || 2;
        const n = escalar(v, casas);
        if (n === null) { erros[campo] = 'número inválido (use 1234.56)'; break; }
        if (regra.positivo && n <= 0n) { erros[campo] = 'deve ser maior que zero'; break; }
        if (!regra.permiteNegativo && n < 0n) { erros[campo] = 'não pode ser negativo'; break; }
        saida[campo] = desescalar(n, casas);
        break;
      }
      case 'data':
        if (!dataValida(v)) { erros[campo] = 'data inválida (use AAAA-MM-DD)'; break; }
        saida[campo] = v;
        break;
      case 'datahora': {
        const m = typeof v === 'string' && /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(v);
        if (!m || !dataValida(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) {
          erros[campo] = 'data e hora inválidas (use AAAA-MM-DDTHH:MM)';
          break;
        }
        saida[campo] = `${m[1]} ${m[2]}:${m[3]}:00`;
        break;
      }
      case 'enum':
        if (!regra.valores.includes(v)) { erros[campo] = `use um de: ${regra.valores.join(', ')}`; break; }
        saida[campo] = v;
        break;
      case 'bool':
        if (v === true || v === 1 || v === '1' || v === 'true') saida[campo] = 1;
        else if (v === false || v === 0 || v === '0' || v === 'false') saida[campo] = 0;
        else erros[campo] = 'use true ou false';
        break;
      default:
        throw new Error(`Tipo de campo desconhecido: ${regra.tipo}`);
    }
  }

  if (Object.keys(erros).length) throw new ErroApp(422, 'Dados inválidos', erros);
  return saida;
}

function paginacao(q) {
  const porPagina = Math.min(Math.max(parseInt(q.por_pagina, 10) || 50, 1), 500);
  const pagina = Math.max(parseInt(q.pagina, 10) || 1, 1);
  return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}

module.exports = {
  validar, paginacao, paraCentavos, deCentavos, escalar, desescalar, qtdVezesPreco,
  dataValida, somarMeses, senhaForte, REGRA_SENHA,
};
