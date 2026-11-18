// Classifica cada dia de um equipamento em um período e calcula a receita perdida.
//
// Prioridade de cada dia: locação (não cancelada) > apontamento > regra do dia útil.
// Dia útil (segunda a sexta, e sábado se "sabado" for true) sem apontamento conta como parado,
// porque a máquina disponível que ninguém usou é justamente o que se quer enxergar.
// Fim de semana sem apontamento é ignorado. Dias depois de "hoje" não contam.
const { paraCentavos, deCentavos } = require('./validate');

function* datas(de, ate) {
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const diaDaSemana = (s) => new Date(`${s}T12:00:00Z`).getUTCDay(); // 0 = domingo

// situacao do dia: LOCADO | TRABALHANDO | PARADO | MANUTENCAO | FOLGA | SEM_APONTAMENTO | null (ignorado)
function situacaoDoDia(data, { locacoes, apontamentos, sabado }) {
  if (locacoes.some((l) => l.data_inicio <= data && l.data_fim >= data)) return 'LOCADO';
  const ap = apontamentos.get(data);
  if (ap) return ap;
  const dia = diaDaSemana(data);
  const util = dia >= 1 && dia <= 5 ? true : dia === 6 ? !!sabado : false;
  return util ? 'SEM_APONTAMENTO' : null;
}

// equipamento: { receita_dia }, locacoes: [{ data_inicio, data_fim }] (já sem as canceladas),
// apontamentos: [{ data, situacao }]
function resumirEquipamento(equipamento, locacoes, apontamentos, { de, ate, hoje, sabado = false }) {
  const limite = ate < hoje ? ate : hoje;
  const mapa = new Map(apontamentos.map((a) => [a.data, a.situacao]));
  const c = { LOCADO: 0, TRABALHANDO: 0, PARADO: 0, MANUTENCAO: 0, FOLGA: 0, SEM_APONTAMENTO: 0 };
  if (de <= limite) {
    for (const data of datas(de, limite)) {
      const s = situacaoDoDia(data, { locacoes, apontamentos: mapa, sabado });
      if (s) c[s] += 1;
    }
  }
  const parados = c.PARADO + c.SEM_APONTAMENTO;
  const usados = c.LOCADO + c.TRABALHANDO;
  const considerados = usados + parados + c.MANUTENCAO; // folga não conta
  const receita = paraCentavos(String(equipamento.receita_dia ?? '0')) || 0;
  return {
    dias_locados: c.LOCADO,
    dias_obra: c.TRABALHANDO,
    dias_parados: parados,
    dias_sem_apontamento: c.SEM_APONTAMENTO,
    dias_manutencao: c.MANUTENCAO,
    dias_folga: c.FOLGA,
    utilizacao: considerados ? Math.round((usados / considerados) * 1000) / 10 : null,
    perda_parado: equipamento.receita_dia === null || equipamento.receita_dia === undefined ? null : deCentavos(parados * receita),
    perda_manutencao: equipamento.receita_dia === null || equipamento.receita_dia === undefined ? null : deCentavos(c.MANUTENCAO * receita),
  };
}

module.exports = { datas, situacaoDoDia, resumirEquipamento };
