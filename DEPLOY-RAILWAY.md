# Publicar o ERP no Railway (erp.kmsincorporadora.com.br)

O site institucional continua em **www.kmsincorporadora.com.br** (Locaweb). O ERP vai para o
Railway e fica em **erp.kmsincorporadora.com.br**. O e-mail (@kmsincorporadora.com.br) não
muda: só vamos **acrescentar** um registro no DNS da Locaweb.

O projeto já tem o `railway.json`: o Railway instala as dependências, roda `npm run migrate`
antes de cada publicação (cria/atualiza as tabelas) e confere `/api/saude` antes de liberar.

## 1. Enviar o código para o GitHub

Crie um repositório **privado** no GitHub e envie esta pasta. Confira antes que **não** sobem:
`.env`, `migracao/`, nenhum `.zip` nem cópia do banco (o `.gitignore` já bloqueia esses).

## 2. Criar o projeto no Railway

1. railway.com > **New Project** > **Deploy from GitHub repo** > escolha o repositório.
2. No mesmo projeto: **+ Create** > **Database** > **MySQL**. O serviço se chama `MySQL`.
3. No serviço do ERP > **Settings** > **Volumes** (ou clique com o botão direito no serviço >
   *Attach volume*): crie um volume montado em **`/data`**. É onde ficam os anexos (editais,
   planilhas, certidões); sem ele, os anexos somem a cada publicação.

## 3. Variáveis do serviço do ERP

Em **Variables** > **Raw Editor**, cole (os `${{MySQL...}}` o Railway preenche sozinho):

```
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
JWT_SECRET=<cole aqui o resultado de "npm run segredo">
SESSAO_HORAS=8
HTTPS=true
TRUST_PROXY=1
STORAGE_DIR=/data/storage
TZ=America/Sao_Paulo
```

- Gere um `JWT_SECRET` **novo** para produção (`npm run segredo`), não reaproveite o do PC.
- `PORT` não precisa: o Railway define sozinho e o sistema já usa.
- Salve. O Railway publica de novo; nos logs devem aparecer `Banco atualizado.` e
  `ERP Construtoras ouvindo...`.

## 4. Dados: começar do zero **ou** levar o banco do PC

**Do zero** (primeiro acesso novo): no seu PC, crie um arquivo `.env.railway` com o conteúdo do
`.env`, mas trocando `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e `DB_NAME` pelos dados da
aba **Connect** > *Public Network* do serviço MySQL, e os dados do administrador/empresa. Rode:

```bash
node -r dotenv/config scripts/seed.js dotenv_config_path=.env.railway
```

Apague o `.env.railway` depois (ele tem a senha do banco de produção).

**Levar o banco atual do PC** (Prompt de Comando, na pasta do MySQL `bin`, ex.:
`C:\Program Files\MySQL\MySQL Server 8.4\bin`). Os dados de host/porta/senha estão em
MySQL > **Connect** > *Public Network* no Railway:

```bash
mysqldump -u erp -p --single-transaction --routines --triggers --set-gtid-purged=OFF erp > %USERPROFILE%\Desktop\dump-erp.sql
```

```bash
mysql -h <HOST_PUBLICO> -P <PORTA_PUBLICA> -u root -p railway < %USERPROFILE%\Desktop\dump-erp.sql
```

Depois de importar, **apague o `dump-erp.sql`** (tem todos os dados e senhas criptografadas).

## 5. Domínio erp.kmsincorporadora.com.br

1. Railway > serviço do ERP > **Settings** > **Networking** > **Custom Domain** >
   `erp.kmsincorporadora.com.br`. Ele mostra um destino do tipo `xxxx.up.railway.app`
   (e, às vezes, um registro TXT de verificação).
2. Painel da **Locaweb** > Domínios > kmsincorporadora.com.br > **Zona de DNS** (Editar DNS):
   - **Adicionar** registro **CNAME**: nome `erp`, destino o `xxxx.up.railway.app` informado.
   - Se o Railway pediu TXT, **adicionar** também o TXT com o nome e o valor indicados.
   - **Não altere** os registros existentes (A, `www`, MX, SPF, google-site-verification):
     eles mantêm o site e o e-mail funcionando.
3. Em alguns minutos (até 1 hora, o TTL atual é 3600 s) o Railway mostra o domínio como
   verificado e emite o certificado HTTPS sozinho.

Conferir: `https://erp.kmsincorporadora.com.br/api/saude` deve responder `{"ok":true}`.

## 6. Depois de no ar

- **Backup**: o plano do Railway não substitui backup próprio. Ative os backups do volume do
  MySQL (Settings > Backups) e faça um `mysqldump` periódico pela conexão pública.
- **Anexos**: ficam no volume `/data`; inclua-o nos backups do Railway.
- Mantenha **uma réplica só** do ERP (o limite de tentativas de login fica em memória).
- Cada `git push` na branch principal publica de novo, já com a migração do banco.
