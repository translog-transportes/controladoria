# ERP Construtoras: instruções para o Claude

Este arquivo é lido automaticamente pelo Claude Code de quem trabalha no projeto. Ele vai para o
Git, então vale para todos. O que é preferência pessoal fica no `CLAUDE.local.md` (fora do Git).

## O projeto
ERP multiempresa para construtoras: financeiro, licitações, contratos e obras, frota e locação
de equipamentos. Node.js 18+ (Express) e MySQL 8. As telas são HTML, CSS e JavaScript puro em
`public/`, servidos pelo próprio Node, **sem etapa de build**. Produção: Railway, em
erp.kmsincorporadora.com.br (veja `DEPLOY-RAILWAY.md`). Cada push na branch principal publica.

O `README.md` descreve os módulos, as regras de negócio e a API. Leia antes de mexer num módulo.

## Comandos
- `npm run dev`: servidor com recarga automática (http://localhost:3000)
- `npm test`: testes das regras de cálculo (`test/`, `node --test`, não precisa de banco)
- `npm run migrate`: aplica os arquivos de `sql/` que ainda não rodaram
- `npm run seed`: cria o primeiro administrador e a primeira empresa
- `npm run demo` / `npm run demo:locacao`: dados de demonstração

## Idioma
Tudo em **português do Brasil**: código (nomes de variáveis, funções, tabelas), comentários,
mensagens de erro, textos das telas e mensagens de commit.

## Regras que não podem ser quebradas
1. **Isolamento entre empresas.** Toda tabela tem `empresa_id`; chaves estrangeiras são
   compostas (`empresa_id`, `id`). Toda consulta filtra por `req.empresaId`. Nova tabela segue
   o mesmo padrão.
2. **Permissão conferida no servidor.** Toda rota usa `exigir('<permissao>')`
   (`src/middleware/auth.js`). Permissão nova entra em `src/permissoes.js` e, se fizer sentido,
   nos `PERFIS_PADRAO`. Esconder botão na tela não substitui a checagem.
3. **SQL sempre com parâmetros (`?`).** Só se interpola no SQL o que vem do código (nome de
   tabela e de campo), nunca da requisição.
4. **Gravar só os campos declarados.** Use `validar(req.body, campos)` de
   `src/utils/validate.js` (tipos: texto, inteiro, decimal, data, datahora, enum, bool).
5. **Sem `innerHTML` com dados.** No front, monte a tela com `h()` e `trocar()` de
   `public/js/ui.js`. A CSP só aceita scripts e estilos do próprio sistema: nada de CDN,
   `<script>` inline nem `style=` inline.
6. **Erros** com `throw new ErroApp(status, 'mensagem')` e rotas assíncronas envolvidas em
   `ah(...)` (`src/middleware/errors.js`).

## Padrões
- Cadastro simples: use a fábrica `crud()` de `src/utils/crud.js` em vez de escrever as rotas.
- Rotas registradas em `src/app.js`; as da empresa passam por `daEmpresa`.
- Banco: **nunca altere um `.sql` já aplicado**. Mudança de esquema = novo arquivo numerado
  em `sql/` (`006_assunto.sql`, `007_...`). O Railway roda a migração a cada publicação.
- Dinheiro trafega como texto com ponto (`"1234.56"`), datas como `AAAA-MM-DD`. Na tela,
  formate com `fmt` de `ui.js` (R$ 1.234,56 e dd/mm/aaaa).
- Regra de cálculo nova ganha teste em `test/`. Rode `npm test` antes de commitar.

## O que nunca vai para o Git
`.env` e qualquer `.env.*` (exceto `.env.example`), `storage/` (anexos), `migracao/`, `.zip`,
cópias do banco (`dump-*.sql`) e `CREDENCIAIS*.txt`. O `.gitignore` já bloqueia; confira o
`git status` antes de commitar. Segredos de produção ficam só nas variáveis do Railway.

## Trabalho em dupla
- Cada um trabalha numa branch própria e abre pull request para a principal; não faça push
  direto na principal (ela publica em produção).
- Faça `git pull` antes de começar e commits pequenos, com mensagem dizendo o que mudou.
- Combine antes de criar um novo `sql/00N_...` para não haver dois arquivos com o mesmo número.
- Decisões de projeto que o outro precisa saber: registre aqui ou no `README.md`.
