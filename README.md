# ERP Construtoras

Sistema de gestão multiempresa para construtoras: financeiro, licitações, contratos e obras
(planilha de execução, medições, notas fiscais) e frota (consumo por km e por hora).
Node.js (Express) + MySQL 8, com as telas servidas pelo próprio Node.

## Instalação

Requisitos: **Node.js 18 ou mais novo** (https://nodejs.org, versão LTS) e **MySQL 8**.

### 1. Banco de dados

Com MySQL já instalado, crie o banco e o usuário (no MySQL Workbench ou no `mysql`):

```sql
CREATE DATABASE erp CHARACTER SET utf8mb4;
CREATE USER 'erp'@'localhost' IDENTIFIED BY 'escolha-uma-senha';
GRANT ALL PRIVILEGES ON erp.* TO 'erp'@'localhost';
```

Ou, se preferir Docker: `docker compose up -d` (sobe um MySQL 8 já com banco e usuário `erp`/`erp123`).

### 2. Sistema

Na pasta do projeto (Prompt de Comando ou PowerShell no Windows):

```bash
npm install
copy .env.example .env        # no Linux/Mac: cp .env.example .env
npm run segredo               # copie o texto gerado para JWT_SECRET no .env
```

Edite o `.env`: senha do banco, `JWT_SECRET`, e os dados do primeiro acesso
(`ADMIN_EMAIL`, `ADMIN_SENHA`, `EMPRESA_RAZAO_SOCIAL`, `EMPRESA_CNPJ`). Depois:

```bash
npm run migrate               # cria as tabelas
npm run seed                  # cria o administrador e a primeira empresa
npm start                     # abre em http://localhost:3000
```

`npm test` roda os testes das regras de cálculo (não precisa de banco).

### Levar para outro computador (Windows)

No computador atual, dois cliques em `gerar-pacote-migracao.cmd`: ele cria em `migracao\` um
.zip com o sistema, as bibliotecas, o `.env`, a cópia completa do banco e os anexos. No
computador novo, instale o MySQL 8.4, extraia o .zip e dê dois cliques em
`INSTALAR-NO-NOVO-PC.cmd` (instruções no `LEIA-ME.txt` do pacote). O pacote contém senhas:
apague-o depois de instalar.

## Módulos

| Módulo | O que faz |
|---|---|
| **Financeiro** | Contas a pagar e a receber, parcelamento, baixas parciais com juros/multa/desconto, estorno, fluxo de caixa realizado e previsto, saldos por conta, DRE da empresa ou de uma obra |
| **Licitações** | Cadastro do edital, funil de situação, anexos (edital em PDF), documentos de habilitação com alerta de vencimento |
| **Contratos e obras** | Importação da planilha de execução (.xlsx), marcação do que foi executado (parcial ou total), vínculo das contas a pagar a cada item ou fase, registro de notas fiscais com vários itens, evolução física, faturada e de custo |
| **Frota** | Veículos (km) e máquinas (horímetro), abastecimentos, média em km/L ou L/h, custo por km ou por hora, planos de manutenção com alerta, apontamento diário de uso e receita perdida com a frota parada |
| **Locação** | Calendário da frota, locação de equipamentos para terceiros (diária, deslocamento, operador, franquia de horas, combustível, caução), contrato para imprimir/PDF e em Word, conta a receber na confirmação e cobrança das horas excedentes na devolução |
| **Administração** | Usuários, perfis de acesso configuráveis, auditoria; para o dono do sistema, cadastro de empresas (clientes) |

### Fluxo de uma obra

1. Cadastre o **contrato** (pode vir de uma licitação). O sistema cria o centro de custo da obra.
2. Na aba **Importar planilha**, envie a planilha orçamentária em Excel. O sistema localiza o
   cabeçalho e as colunas, mostra uma prévia e só grava depois da sua conferência.
   Linhas com código e sem quantidade viram **fases**.
3. Anexe o **edital** e demais documentos na aba **Edital e anexos**.
4. Na **Planilha**, use **Executar** em cada item conforme a obra anda. Não é possível passar
   da quantidade contratada.
5. Use **Custos** no item ou na fase para vincular as **contas a pagar** que pertencem a ele.
   Uma conta pode ser dividida entre vários itens.
6. Em **Notas fiscais**, registre a nota emitida (fora do sistema) marcando os itens executados
   que ela cobre. O sistema gera a conta a receber pelo valor líquido e impede faturar mais do
   que foi executado.

### Contas de combustível

Ao lançar uma conta a pagar de combustível (ex.: a nota quinzenal do posto), use
**⛽ Vincular abastecimentos** e marque os abastecimentos que ela paga. O valor da conta é
sugerido pela soma dos marcados, a lista de contas mostra as placas de cada conta e a busca
encontra a conta pela placa. Nos **Detalhes** da conta aparecem os abastecimentos (placa,
data, litros, valor, obra) e a diferença, se houver, entre a nota e a soma dos abastecimentos.
Um abastecimento só pode estar em uma conta, o que evita pagar o mesmo combustível duas vezes;
ao cancelar a conta, os abastecimentos voltam a ficar livres. Em **Frota > Abastecimentos**, o
filtro "Sem conta a pagar" mostra o que ainda não foi cobrado pelo posto.

### Locação de equipamentos

1. Em **Frota > Veículos e máquinas**, informe a **receita por dia** de cada equipamento
   (é a diária sugerida na locação e a base da receita perdida).
2. Em **Locação > Calendário da frota** (uma linha por equipamento, uma coluna por dia), clique
   num dia livre e use **+ Nova locação**: cliente, endereço da obra, período, diária,
   deslocamento, operador, franquia de horas, combustível, caução e desconto. O total aparece
   enquanto você digita. A locação nasce **Reservada** e já ocupa o calendário; o sistema não
   deixa locar o mesmo equipamento em dias que se sobrepõem.
3. **Contrato**: imprime (ou salva em PDF pelo navegador) e baixa em Word para ajustes.
   É um modelo: revise o texto com seu advogado antes do primeiro uso.
4. **Confirmar** gera a conta a receber (categoria Locação de equipamentos, centro de custo do
   equipamento). Depois disso valores e datas não mudam; para mudar, cancele e faça outra.
5. **Devolução**: informe o horímetro/hodômetro da entrega e da devolução. Se houver franquia e
   o uso passar dela, o sistema gera uma segunda conta a receber com as horas excedentes e
   atualiza a leitura do equipamento.
6. **Cancelar** libera o calendário e cancela a conta a receber (se ainda não houver recebimento).

Uma locação tem um equipamento; para alugar dois, faça duas locações.

### Apontamento diário e receita perdida

No calendário, clique num dia (ou use **Apontar o dia** para marcar a frota toda de uma vez) e
diga o que cada equipamento fez: obra própria, parado, manutenção ou folga. Dias locados são
marcados automaticamente. Em **Frota > Receita perdida**, cada dia útil vale: locado >
apontamento > dia útil sem apontamento (conta como parado). Receita perdida = dias parados ×
receita por dia; a perda em manutenção aparece separada. É um acompanhamento gerencial: não
gera lançamento no financeiro.

## Segurança

- **Isolamento entre empresas**: toda tabela tem `empresa_id` e as chaves estrangeiras são
  compostas (`empresa_id` + `id`). Mesmo com um erro no código, o banco recusa um registro de
  uma empresa apontando para dados de outra. Toda rota filtra pela empresa do usuário.
- **Perfis e permissões**: cada empresa monta seus perfis a partir de 20 permissões
  (consultar/editar por módulo, baixar títulos, lançar execução, lançar abastecimento etc.).
  A permissão é conferida no servidor em cada rota; esconder o botão na tela é só conforto.
  O perfil Administrador é fixo e a empresa nunca fica sem um.
- **Senhas**: guardadas com bcrypt (custo 12), mínimo de 8 caracteres com letras e números.
- **Login**: bloqueio da conta por 15 minutos após 5 senhas erradas, limite de tentativas por
  IP e a mesma mensagem para qualquer falha (não revela quais e-mails existem).
- **Sessão**: token em cookie `httpOnly` + `SameSite=Strict` (o JavaScript da página não o
  lê), com cabeçalho anti-CSRF nas gravações. Sair ou trocar a senha encerra as sessões em
  todos os dispositivos na hora.
- **Navegador**: cabeçalhos de segurança (Helmet) e política CSP que só executa scripts do
  próprio sistema; as telas nunca montam HTML com dados do banco (proteção contra XSS).
- **Banco**: todas as consultas usam parâmetros (sem concatenar valores), e cada rota só
  grava os campos que declarou.
- **Anexos**: só PDF, XLSX, DOCX, PNG e JPG, até 20 MB, com conferência do conteúdo real do
  arquivo; ficam em disco com nome aleatório e só saem por download autenticado.
- **Auditoria**: toda inclusão, alteração e exclusão fica registrada com usuário, data, IP e
  dados enviados (senhas nunca são gravadas), além dos logins aceitos e recusados.
- **Dono do sistema (super admin)**: cria e desativa empresas, mas não enxerga os dados delas.
  O administrador de uma empresa só redefine senha de usuários exclusivos dela.

### Antes de colocar na internet

- Publique atrás de **HTTPS** (nginx, Caddy ou similar) e defina `HTTPS=true` e `TRUST_PROXY=1`.
- Use um usuário do MySQL só para o sistema, com senha forte, e não exponha a porta 3306.
- Faça **backup diário** do banco (`mysqldump`) e da pasta `storage/` (anexos).
- Mantenha as dependências em dia: `npm audit` e `npm update` periodicamente.
- O limite de requisições fica em memória; com mais de um servidor, troque por Redis.
- Contrate um teste de invasão antes de vender em escala: as proteções acima seguem as boas
  práticas, mas nenhuma revisão interna substitui um teste independente.

## API

Todas as telas usam a API em `/api`. Para integrações, faça login em `POST /api/auth/login`
e envie `Authorization: Bearer <token>` e `X-Empresa-Id: <id>` em cada chamada.
Valores em dinheiro trafegam como texto com ponto (`"1234.56"`) e datas como `AAAA-MM-DD`.

| Rota | Conteúdo |
|---|---|
| `/api/auth` | login, logout, me, senha |
| `/api/pessoas`, `/api/categorias`, `/api/centros-custo`, `/api/contas-bancarias` | cadastros |
| `/api/lancamentos` (+ `/:id/baixas`, `/cancelar`, `/reabrir`) | contas a pagar e a receber |
| `/api/relatorios/resumo`, `/saldos`, `/fluxo-caixa`, `/dre` | relatórios financeiros |
| `/api/licitacoes`, `/api/documentos`, `/api/arquivos` | licitações, habilitação e anexos |
| `/api/contratos` (+ `/:id/evolucao`, `/itens`, `/planilha`, `/execucoes`, `/custos`, `/notas`) | obras |
| `/api/equipamentos`, `/api/abastecimentos`, `/api/planos-manutencao`, `/api/manutencoes`, `/api/frota/consumo`, `/api/frota/alertas`, `/api/frota/ociosidade` | frota |
| `/api/locacoes` (+ `/calendario`, `/:id/confirmar`, `/concluir`, `/cancelar`, `/contrato`, `/contrato.docx`), `/api/apontamentos` (+ `/lote`) | locação e apontamento diário |
| `/api/usuarios`, `/api/perfis`, `/api/auditoria`, `/api/admin/empresas` | administração |

## O que ainda não tem

- Conciliação bancária por OFX e transferência entre contas.
- Cronograma previsto (curva S planejada): hoje a evolução mostra só o executado mês a mês.
- Leitura automática dos itens a partir do PDF do edital (o PDF fica anexado; os itens vêm do Excel).
- As retenções da nota reduzem a conta a receber, mas não geram lançamentos de imposto no DRE.
- Recuperação de senha por e-mail (hoje o administrador redefine).
- Emissão de nota fiscal (fora do escopo por decisão de projeto).
- Locação com vários equipamentos no mesmo contrato, prorrogação de uma locação confirmada e devolução da caução pelo financeiro.

## Estrutura

```
sql/            criação do banco, aplicada em ordem pelo "npm run migrate"
scripts/        migrate.js e seed.js
src/            API: config, db, permissoes, middleware/, utils/, routes/
public/         telas (HTML, CSS e JavaScript sem etapa de build)
test/           testes das regras de cálculo
storage/        anexos enviados (criada no primeiro envio)
```
