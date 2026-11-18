// Cálculo de consumo médio pelo método do tanque cheio.
//
// Só dá para saber quanto se gastou entre dois abastecimentos de tanque cheio: os litros
// colocados depois do primeiro "cheio" até o próximo "cheio" (inclusive) repõem exatamente
// o que foi consumido no trecho. Abastecimentos parciais no meio entram na soma dos litros.
//
// tipo VEICULO -> leitura em km,    média em km/L, custo por km
// tipo MAQUINA -> leitura em horas, média em L/h,  custo por hora
//
// abastecimentos: [{ leitura, litros, valor_total, tanque_cheio }] de um único equipamento.
function calcularConsumo(tipo, abastecimentos) {
  const lista = abastecimentos
    .map((a) => ({ leitura: Number(a.leitura), litros: Number(a.litros), valor: Number(a.valor_total), cheio: !!Number(a.tanque_cheio) }))
    .sort((a, b) => a.leitura - b.leitura);

  const total = { litros: 0, valor: 0 };
  for (const a of lista) { total.litros += a.litros; total.valor += a.valor; }

  let ancora = null; // leitura do último tanque cheio
  let litros = 0;
  let valor = 0;
  const trechos = [];
  for (const a of lista) {
    if (ancora === null) {
      if (a.cheio) ancora = a.leitura;
      continue;
    }
    litros += a.litros;
    valor += a.valor;
    if (a.cheio) {
      const percorrido = a.leitura - ancora;
      if (percorrido > 0) trechos.push({ de: ancora, ate: a.leitura, percorrido, litros, valor });
      ancora = a.leitura;
      litros = 0;
      valor = 0;
    }
  }

  let percorrido = trechos.reduce((s, t) => s + t.percorrido, 0);
  let gasto = trechos.reduce((s, t) => s + t.litros, 0);
  let custo = trechos.reduce((s, t) => s + t.valor, 0);
  let estimado = false;

  // Sem dois tanques cheios, estima pela primeira e última leitura (menos preciso).
  if (!trechos.length && lista.length >= 2) {
    percorrido = lista[lista.length - 1].leitura - lista[0].leitura;
    gasto = total.litros - lista[0].litros;
    custo = total.valor - lista[0].valor;
    estimado = true;
  }

  const ok = percorrido > 0 && gasto > 0;
  const arred = (n, casas) => Math.round(n * 10 ** casas) / 10 ** casas;
  return {
    unidade: tipo === 'VEICULO' ? 'km/L' : 'L/h',
    abastecimentos: lista.length,
    litros_total: arred(total.litros, 3),
    valor_total: arred(total.valor, 2),
    percorrido: arred(Math.max(percorrido, 0), 1),
    media: ok ? arred(tipo === 'VEICULO' ? percorrido / gasto : gasto / percorrido, 2) : null,
    custo_por_unidade: ok ? arred(custo / percorrido, 2) : null, // R$/km ou R$/hora
    preco_medio_litro: total.litros > 0 ? arred(total.valor / total.litros, 3) : null,
    estimado,
    trechos: trechos.map((t) => ({
      de: t.de, ate: t.ate, percorrido: arred(t.percorrido, 1), litros: arred(t.litros, 3),
      media: arred(tipo === 'VEICULO' ? t.percorrido / t.litros : t.litros / t.percorrido, 2),
    })),
  };
}

module.exports = { calcularConsumo };
