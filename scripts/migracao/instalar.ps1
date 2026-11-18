# Instala o ERP Construtoras a partir do pacote de migração, no computador novo.
# Uso: descompacte o .zip e dê dois cliques em "INSTALAR-NO-NOVO-PC.cmd".
$ErrorActionPreference = 'Stop'
$pacote = $PSScriptRoot

function Perguntar($texto, $padrao) {
  $r = Read-Host "$texto [$padrao]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $padrao } else { return $r.Trim() }
}
function Sim($texto) { return (Read-Host "$texto (S/N)") -match '^[sS]' }
function Ler-Env($arquivo) {
  $v = @{}
  foreach ($linha in Get-Content -LiteralPath $arquivo -Encoding UTF8) {
    if ($linha -match '^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$') { $v[$matches[1]] = $matches[2].Trim() }
  }
  return $v
}
function Parar($texto) { Write-Host ''; Write-Host $texto -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '=== ERP Construtoras - instalação no computador novo ===' -ForegroundColor Cyan
if (Test-Path (Join-Path $pacote 'versao.txt')) { Get-Content (Join-Path $pacote 'versao.txt') -Encoding UTF8 | Where-Object { $_ -notmatch '^TABELAS=' } | ForEach-Object { Write-Host "  $_" } }
$origem = Join-Path $pacote 'erp-construtoras'
$arquivoSql = Join-Path $pacote 'banco\erp.sql'
if (-not (Test-Path (Join-Path $origem 'src\server.js')) -or -not (Test-Path $arquivoSql)) {
  Parar 'Pacote incompleto. Descompacte o .zip inteiro (botão direito > Extrair tudo) e rode o instalador de dentro da pasta extraída.'
}
$esperadas = 0
$linhaTab = Get-Content (Join-Path $pacote 'versao.txt') -Encoding UTF8 | Where-Object { $_ -match '^TABELAS=(\d+)' }
if ($linhaTab -match '(\d+)') { $esperadas = [int]$matches[1] }

# ---------- 1. Node.js ----------
Write-Host ''
Write-Host '1/6 Node.js'
function Achar-Node {
  $c = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in "$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe") { if (Test-Path $p) { return $p } }
  return $null
}
$node = Achar-Node
if (-not $node) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget -and (Sim '    O Node.js não está instalado. Instalar agora (versão LTS, pelo winget da Microsoft)?')) {
    & $winget.Source install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $node = Achar-Node
  }
  if (-not $node) { Start-Process 'https://nodejs.org/pt-br/download'; Parar 'Instale o Node.js (versão LTS) pelo site que abriu e rode este instalador de novo.' }
}
$versaoNode = & $node --version
$maior = [int]($versaoNode.TrimStart('v').Split('.')[0])
if ($maior -lt 18) { Parar "Node.js $versaoNode é antigo demais. Instale a versão LTS em https://nodejs.org e rode de novo." }
Write-Host "    ok: Node.js $versaoNode ($node)"

# ---------- 2. MySQL ----------
Write-Host '2/6 MySQL'
$mysql = Get-ChildItem "$env:ProgramFiles\MySQL\MySQL Server *\bin\mysql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $mysql) {
  Write-Host '    O MySQL não está instalado neste computador.' -ForegroundColor Yellow
  Write-Host '    1. Baixe o "MySQL Community Server 8.4 LTS", opção "Windows (x86, 64-bit), MSI Installer".'
  Write-Host '    2. Instale com as opções padrão. No configurador, defina uma senha para o usuário root'
  Write-Host '       (anote!) e deixe marcado "Configure MySQL Server as a Windows Service".'
  Write-Host '    3. Rode este instalador de novo.'
  Start-Process 'https://dev.mysql.com/downloads/mysql/'
  Parar 'Instalação interrompida: falta o MySQL.'
}
$servico = Get-Service | Where-Object { $_.Name -like 'MySQL*' } | Select-Object -First 1
if (-not $servico) { Parar 'O MySQL está instalado, mas não como serviço do Windows. Rode o "MySQL Configurator" e marque "Configure MySQL Server as a Windows Service".' }
if ($servico.Status -ne 'Running') {
  try { Start-Service $servico.Name } catch { Parar "O serviço $($servico.Name) está parado. Rode este instalador como administrador (botão direito > Executar como administrador)." }
}
Write-Host "    ok: $($mysql.Directory.Parent.Name), serviço $($servico.Name)"

# ---------- 3. Pasta do sistema ----------
Write-Host '3/6 Pasta do sistema'
$destino = Perguntar '    Onde instalar?' 'C:\ERP-Construtoras'
$destino = [IO.Path]::GetFullPath($destino)
if (Test-Path (Join-Path $destino 'src\server.js')) {
  if (-not (Sim "    Já existe um ERP em $destino. Substituir os arquivos do sistema?")) { Parar 'Instalação cancelada.' }
}
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$null = & robocopy $origem $destino /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { Parar "Falha ao copiar os arquivos para $destino (robocopy $LASTEXITCODE)." }
Write-Host "    ok: arquivos copiados para $destino"
$cfg = Ler-Env (Join-Path $destino '.env')
$banco = $cfg.DB_NAME; $usuario = $cfg.DB_USER; $senhaApp = $cfg.DB_PASSWORD
if ($banco -notmatch '^[A-Za-z0-9_]+$' -or $usuario -notmatch '^[A-Za-z0-9_]+$') { Parar 'DB_NAME ou DB_USER inválido no .env.' }

# ---------- 4. Banco de dados ----------
Write-Host '4/6 Banco de dados'
$base = @("--host=127.0.0.1", "--port=$(if ($cfg.DB_PORT) { $cfg.DB_PORT } else { 3306 })", '--user=root', '--default-character-set=utf8mb4')
function Sql-Root($sql) {
  $saidaSql = $sql | & $mysql.FullName @base --batch --skip-column-names 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($saidaSql | Out-String) }
  return $saidaSql
}
$conectou = $false
for ($i = 1; $i -le 3 -and -not $conectou; $i++) {
  $seg = Read-Host '    Senha do usuário root do MySQL deste computador' -AsSecureString
  $env:MYSQL_PWD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
  try { $null = Sql-Root 'SELECT 1;'; $conectou = $true } catch { Write-Host '    Não conectou (senha errada?).' -ForegroundColor Yellow }
}
if (-not $conectou) { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue; Parar 'Não foi possível entrar no MySQL como root.' }
try {
  $existentes = [int](Sql-Root "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$banco';" | Select-Object -Last 1)
  if ($existentes -gt 0) {
    Write-Host "    O banco '$banco' já existe neste computador com $existentes tabelas." -ForegroundColor Yellow
    $ok = Read-Host '    Para APAGAR esse banco e colocar os dados do pacote no lugar, digite SUBSTITUIR'
    if ($ok -cne 'SUBSTITUIR') { Parar 'Instalação cancelada: o banco existente não foi mexido.' }
    $null = Sql-Root "DROP DATABASE ``$banco``;"
  }
  $senhaSql = $senhaApp.Replace('\', '\\').Replace("'", "''")
  $null = Sql-Root @"
CREATE DATABASE IF NOT EXISTS ``$banco`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$usuario'@'localhost' IDENTIFIED BY '$senhaSql';
ALTER USER '$usuario'@'localhost' IDENTIFIED BY '$senhaSql';
GRANT ALL PRIVILEGES ON ``$banco``.* TO '$usuario'@'localhost';
FLUSH PRIVILEGES;
"@
  Write-Host '    importando os dados (pode levar alguns segundos)...'
  $imp = Start-Process -FilePath $mysql.FullName -ArgumentList ($base + $banco) -RedirectStandardInput $arquivoSql -NoNewWindow -Wait -PassThru
  if ($imp.ExitCode -ne 0) { Parar 'Falha ao importar o banco.' }
  $tabelas = [int](Sql-Root "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$banco';" | Select-Object -Last 1)
  if ($esperadas -and $tabelas -ne $esperadas) { Parar "Importação incompleta: $tabelas de $esperadas tabelas." }
  Write-Host "    ok: banco '$banco' com $tabelas tabelas, usuário '$usuario' criado"
} finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }

# ---------- 5. Conferência ----------
Write-Host '5/6 Conferindo'
Push-Location $destino
try {
  & $node scripts/migrate.js
  if ($LASTEXITCODE -ne 0) { Parar 'O sistema não conseguiu acessar o banco com os dados do .env.' }
} finally { Pop-Location }

# ---------- 6. Atalho ----------
Write-Host '6/6 Atalho'
$porta = if ($cfg.PORT) { $cfg.PORT } else { '3000' }
@(
  '@echo off'
  "rem Inicia o ERP Construtoras em http://localhost:$porta (feche esta janela para parar)"
  'cd /d "%~dp0"'
  "net start $($servico.Name) >nul 2>&1"
  "start `"`" http://localhost:$porta"
  "`"$node`" src\server.js"
  'pause'
) | Set-Content -LiteralPath (Join-Path $destino 'iniciar-erp.cmd') -Encoding ASCII
$atalho = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ERP Construtoras.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($atalho)
$lnk.TargetPath = Join-Path $destino 'iniciar-erp.cmd'
$lnk.WorkingDirectory = $destino
$lnk.Save()
Write-Host "    ok: atalho 'ERP Construtoras' na área de trabalho"

Write-Host ''
Write-Host 'Instalação concluída!' -ForegroundColor Green
Write-Host "  Sistema em $destino"
Write-Host "  Para usar: dois cliques no atalho 'ERP Construtoras' e entre em http://localhost:$porta"
Write-Host '  com o mesmo e-mail e senha do computador antigo.'
Write-Host '  Depois de conferir que está tudo certo, apague o .zip e a pasta extraída (contêm senhas).' -ForegroundColor Yellow
Write-Host ''
if (Sim 'Abrir o sistema agora?') { Start-Process (Join-Path $destino 'iniciar-erp.cmd') -WorkingDirectory $destino }
