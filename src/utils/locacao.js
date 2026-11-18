// Regras de cálculo da locação de equipamentos. Dinheiro sempre em centavos (inteiro).
const { paraCentavos, deCentavos, escalar } = require('./validate');

const cent = (v) => paraCentavos(String(v ?? '0')) || 0;

// Dias corridos entre duas datas AAAA-MM-DD, contando o primeiro e o último.
function diasCorridos(inicio, fim) {
  const ms = Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

// Composição do valor da locação. A caução é garantia: aparece no contrato, mas não entra no total.
function calcularTotal(l) {
  const dias = Number(l.dias_cobrados) || 0;
  const diarias = dias * cent(l.valor_diaria);
  const operador = Number(l.com_operador) ? dias * cent(l.valor_operador_dia) : 0;
  const deslocamento = cent(l.valor_deslocamento);
  const combustivel = l.combustivel === 'COBRADO' ? cent(l.valor_combustivel) : 0;
  const desconto = cent(l.desconto);
  const bruto = diarias + operador + deslocamento + combustivel;
  return {
    diarias: deCentavos(diarias),
    operador: deCentavos(operador),
    deslocamento: deCentavos(deslocamento),
    combustivel: deCentavos(combustivel),
    desconto: deCentavos(desconto),
    total: deCentavos(bruto - desconto),
    totalCentavos: bruto - desconto,
  };
}

// Horas excedentes na devolução: usado (leitura final - inicial) além da franquia (horas/dia x dias).
// Leituras com 1 casa decimal; o valor arredonda meio centavo para cima.
function calcularExcedente(l, leituraInicio, leituraFim) {
  if (l.franquia_horas_dia === null || l.franquia_horas_dia === undefined || !l.valor_hora_excedente) {
    return { horas: null, valor: null };
  }
  const usado = escalar(String(leituraFim), 1) - escalar(String(leituraInicio), 1); // décimos de hora
  const franquia = escalar(String(l.franquia_horas_dia), 1) * BigInt(Number(l.dias_cobrados));
  const excedente = usado > franquia ? usado - franquia : 0n;
  const valor = Number((excedente * BigInt(cent(l.valor_hora_excedente)) + 5n) / 10n);
  return { horas: (Number(excedente) / 10).toFixed(1), valor: deCentavos(valor) };
}

module.exports = { diasCorridos, calcularTotal, calcularExcedente };
