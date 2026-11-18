// Monta o contrato de locação de equipamento a partir dos dados da locação.
// O mesmo modelo serve para a página de impressão (tela) e para o arquivo Word (.docx),
// então o texto do contrato existe em um lugar só.
//
// O texto é um modelo genérico de mercado. Antes de usar com clientes, peça a um advogado
// para revisar as cláusulas e ajustá-las à realidade da empresa.
const { calcularTotal } = require('./locacao');

const nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (v) => nf.format(Number(v || 0));
const numero = (v, casas = 1) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const dataBR = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataExtenso = (s) => `${Number(s.slice(8, 10))} de ${MESES[Number(s.slice(5, 7)) - 1]} de ${s.slice(0, 4)}`;

function documento(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 14) return `CNPJ ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `CPF ${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return 'CPF/CNPJ ____________________';
}

// l: locação com cliente_* e equipamento_* (ver SELECT em routes/locacoes.js); empresa: { razao_social, cnpj }
// hoje: AAAA-MM-DD (data impressa no contrato)
function montarContrato(l, empresa, hoje) {
  const t = calcularTotal(l);
  const un = l.equipamento_tipo === 'VEICULO' ? 'km' : 'horas';
  const equipamento = [l.equipamento_nome, [l.equipamento_marca, l.equipamento_modelo].filter(Boolean).join(' '), l.equipamento_ano ? `ano ${l.equipamento_ano}` : null]
    .filter(Boolean).join(', ') + (l.equipamento_placa ? ` (placa/nº de frota ${l.equipamento_placa})` : '');
  const localObra = [l.endereco, [l.cidade, l.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
  const dias = Number(l.dias_cobrados);

  const valores = [['Diárias do equipamento', `${dias}`, dinheiro(l.valor_diaria), dinheiro(t.diarias)]];
  if (Number(l.com_operador)) valores.push(['Operador (por dia)', `${dias}`, dinheiro(l.valor_operador_dia), dinheiro(t.operador)]);
  if (Number(t.deslocamento) > 0) valores.push(['Mobilização e desmobilização (transporte)', '1', dinheiro(t.deslocamento), dinheiro(t.deslocamento)]);
  if (Number(t.combustivel) > 0) valores.push(['Combustível', '1', dinheiro(t.combustivel), dinheiro(t.combustivel)]);
  if (Number(t.desconto) > 0) valores.push(['Desconto', '', '', `- ${dinheiro(t.desconto)}`]);

  const clausulas = [];
  const c = (titulo, ...paragrafos) => clausulas.push({ titulo: `CLÁUSULA ${clausulas.length + 1}ª - ${titulo}`, paragrafos: paragrafos.filter(Boolean) });

  c('DO OBJETO',
    `O presente contrato tem por objeto a locação do equipamento ${equipamento}, ${Number(l.com_operador) ? 'com operador fornecido pela LOCADORA' : 'sem operador'}, para utilização exclusiva na obra situada em ${localObra}.`,
    'O equipamento será entregue em perfeito estado de conservação e funcionamento, o que o LOCATÁRIO declara conferir no ato do recebimento.');
  c('DO PRAZO',
    `A locação vigorará de ${dataBR(l.data_inicio)} a ${dataBR(l.data_fim)}, totalizando ${dias} diária(s).`,
    'A permanência do equipamento além do prazo, sem novo ajuste por escrito, será cobrada pela mesma diária, por dia de atraso na devolução.');
  c('DO PREÇO',
    `Pela locação, o LOCATÁRIO pagará à LOCADORA o valor total de ${dinheiro(t.total)}, conforme a composição do quadro de valores deste contrato.`,
    l.franquia_horas_dia !== null && l.franquia_horas_dia !== undefined && Number(l.valor_hora_excedente) > 0
      ? `Cada diária inclui ${numero(l.franquia_horas_dia)} hora(s) de uso. As horas que excederem a franquia total do período, apuradas pela diferença entre as leituras do ${l.equipamento_tipo === 'VEICULO' ? 'hodômetro' : 'horímetro'} na entrega e na devolução, serão cobradas a ${dinheiro(l.valor_hora_excedente)} por hora.`
      : null,
    'Dias em que o equipamento ficar parado por defeito não causado pelo LOCATÁRIO não serão cobrados.');
  c('DO PAGAMENTO',
    l.data_vencimento
      ? `O pagamento será feito até ${dataBR(l.data_vencimento)}, por depósito, transferência ou boleto emitido pela LOCADORA.`
      : 'O pagamento será feito na data ajustada entre as partes, por depósito, transferência ou boleto emitido pela LOCADORA.',
    'O atraso no pagamento sujeitará o LOCATÁRIO a multa de 2% (dois por cento) sobre o valor devido, juros de mora de 1% (um por cento) ao mês e correção monetária, sem prejuízo da retirada do equipamento.');
  c('DO COMBUSTÍVEL',
    {
      LOCATARIO: 'O abastecimento do equipamento durante a locação é de responsabilidade do LOCATÁRIO, que o devolverá com o mesmo nível de combustível da entrega, sob pena de cobrança da diferença.',
      INCLUSO: 'O combustível consumido durante a locação está incluído no preço e será fornecido pela LOCADORA.',
      COBRADO: `O combustível será fornecido pela LOCADORA e cobrado à parte, no valor de ${dinheiro(l.valor_combustivel)}, já incluído no valor total.`,
    }[l.combustivel] || null);
  c('DA OPERAÇÃO',
    Number(l.com_operador)
      ? 'A LOCADORA fornecerá operador habilitado, responsável pela condução do equipamento. Cabe ao LOCATÁRIO indicar os serviços, garantir condições seguras de trabalho no local e respeitar a jornada legal do operador.'
      : 'A operação será feita por profissional habilitado indicado pelo LOCATÁRIO, que responde integralmente pela operação, pela segurança no local e por danos causados a terceiros.');
  c('DAS OBRIGAÇÕES DO LOCATÁRIO',
    'a) utilizar o equipamento somente na obra e na finalidade deste contrato, respeitando sua capacidade e as recomendações do fabricante;',
    'b) não sublocar, emprestar ou retirar o equipamento do local da obra sem autorização por escrito da LOCADORA;',
    'c) comunicar imediatamente qualquer defeito, acidente, furto ou apreensão, e permitir a vistoria do equipamento a qualquer tempo;',
    'd) devolver o equipamento ao fim do prazo nas mesmas condições em que o recebeu, ressalvado o desgaste natural pelo uso normal.');
  c('DA MANUTENÇÃO E DOS DANOS',
    'A manutenção preventiva é de responsabilidade da LOCADORA. Danos decorrentes de mau uso, imperícia, negligência ou acidente durante a locação serão reparados às custas do LOCATÁRIO, assim como a reposição do equipamento em caso de furto ou perda.');
  if (Number(l.caucao) > 0) {
    c('DA CAUÇÃO',
      `O LOCATÁRIO entrega à LOCADORA, como garantia, caução no valor de ${dinheiro(l.caucao)}, que será devolvida em até 10 (dez) dias após a devolução do equipamento, descontados eventuais valores devidos por danos, combustível ou atraso.`);
  }
  c('DA RESCISÃO',
    'O descumprimento de qualquer cláusula autoriza a parte prejudicada a rescindir este contrato e a LOCADORA a retirar imediatamente o equipamento, sendo devidas as diárias até a data da efetiva devolução.');
  if (l.observacao) c('DAS CONDIÇÕES ESPECIAIS', ...String(l.observacao).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  c('DO FORO',
    `Fica eleito o foro da comarca de ${l.cidade || '____________________'} para dirimir quaisquer questões oriundas deste contrato.`,
    'E, por estarem de acordo, as partes assinam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.');

  return {
    titulo: 'CONTRATO DE LOCAÇÃO DE EQUIPAMENTO',
    numero: `Nº ${String(l.numero).padStart(4, '0')}/${l.data_inicio.slice(0, 4)}`,
    partes: [
      { papel: 'LOCADORA', texto: `${empresa.razao_social}, inscrita no ${documento(empresa.cnpj)}, doravante denominada LOCADORA.` },
      {
        papel: 'LOCATÁRIO',
        texto: `${l.cliente_nome}, inscrito(a) no ${documento(l.cliente_documento)}${l.cliente_endereco ? `, com endereço em ${l.cliente_endereco}` : [l.cliente_cidade, l.cliente_uf].filter(Boolean).length ? `, com sede em ${[l.cliente_cidade, l.cliente_uf].filter(Boolean).join('/')}` : ''}, doravante denominado(a) LOCATÁRIO.`,
      },
    ],
    resumo: [
      ['Equipamento', equipamento],
      ['Local de uso', localObra],
      ['Período', `${dataBR(l.data_inicio)} a ${dataBR(l.data_fim)} (${dias} diária(s))`],
      ['Operador', Number(l.com_operador) ? 'Incluso' : 'Não incluso'],
      ['Leitura na entrega', l.leitura_inicio !== null && l.leitura_inicio !== undefined ? `${numero(l.leitura_inicio)} ${un}` : `__________ ${un}`],
      ['Contato na obra', [l.responsavel, l.telefone].filter(Boolean).join(' · ') || '—'],
    ],
    valores: { linhas: valores, total: dinheiro(t.total), caucao: Number(l.caucao) > 0 ? dinheiro(l.caucao) : null },
    clausulas,
    localData: `${l.cidade || '____________________'}, ${dataExtenso(hoje)}.`,
    assinaturas: [
      { nome: empresa.razao_social, papel: 'LOCADORA' },
      { nome: l.cliente_nome, papel: 'LOCATÁRIO' },
      { nome: 'Testemunha 1 - Nome e CPF', papel: '' },
      { nome: 'Testemunha 2 - Nome e CPF', papel: '' },
    ],
  };
}

// Gera o .docx do contrato (Buffer).
async function gerarDocx(m) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle,
  } = require('docx');
  const fonte = 'Arial';
  const p = (texto, opcoes = {}) => new Paragraph({
    alignment: opcoes.alinhamento || AlignmentType.JUSTIFIED,
    spacing: { after: opcoes.depois ?? 120, before: opcoes.antes ?? 0 },
    children: [new TextRun({ text: texto, bold: !!opcoes.negrito, size: opcoes.tamanho || 21, font: fonte })],
  });
  const celula = (texto, { negrito = false, direita = false, largura } = {}) => new TableCell({
    width: largura ? { size: largura, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: direita ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: texto, bold: negrito, size: 19, font: fonte })] })],
  });
  const tabela = (linhas) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: linhas });

  const filhos = [
    p(m.titulo, { negrito: true, tamanho: 28, alinhamento: AlignmentType.CENTER, depois: 40 }),
    p(m.numero, { alinhamento: AlignmentType.CENTER, depois: 300 }),
    ...m.partes.map((x) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 },
      children: [new TextRun({ text: `${x.papel}: `, bold: true, size: 21, font: fonte }), new TextRun({ text: x.texto, size: 21, font: fonte })],
    })),
    p('As partes acima qualificadas celebram o presente contrato de locação, que se regerá pelas cláusulas e condições a seguir.', { depois: 200 }),
    tabela(m.resumo.map(([k, v]) => new TableRow({ children: [celula(k, { negrito: true, largura: 28 }), celula(v, { largura: 72 })] }))),
    p('QUADRO DE VALORES', { negrito: true, antes: 240, depois: 100 }),
    tabela([
      new TableRow({ tableHeader: true, children: ['Descrição', 'Qtd.', 'Valor unitário', 'Total'].map((x, i) => celula(x, { negrito: true, direita: i > 0 })) }),
      ...m.valores.linhas.map((l) => new TableRow({ children: l.map((x, i) => celula(x, { direita: i > 0 })) })),
      new TableRow({ children: [celula('VALOR TOTAL', { negrito: true }), celula(''), celula(''), celula(m.valores.total, { negrito: true, direita: true })] }),
    ]),
    m.valores.caucao ? p(`Caução (garantia, não incluída no total): ${m.valores.caucao}`, { antes: 80 }) : null,
    ...m.clausulas.flatMap((cl) => [p(cl.titulo, { negrito: true, antes: 220, depois: 80 }), ...cl.paragrafos.map((x) => p(x))]),
    p(m.localData, { antes: 300, depois: 500, alinhamento: AlignmentType.RIGHT }),
    tabela([
      new TableRow({ children: m.assinaturas.slice(0, 2).map((a) => assinatura(a)) }),
      new TableRow({ children: m.assinaturas.slice(2).map((a) => assinatura(a)) }),
    ]),
  ].filter(Boolean);

  function assinatura(a) {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      margins: { top: 500, left: 200, right: 200 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_________________________________', size: 20, font: fonte })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.nome, size: 19, font: fonte })] }),
        a.papel ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.papel, bold: true, size: 19, font: fonte })] }) : new Paragraph(''),
      ],
    });
  }

  const doc = new Document({
    creator: m.partes[0].texto.split(',')[0],
    title: `${m.titulo} ${m.numero}`,
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } }, children: filhos }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { montarContrato, gerarDocx };
