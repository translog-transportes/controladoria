# Gera o pacote para levar o ERP Construtoras para outro computador:
# sistema + bibliotecas + configuração (.env) + cópia completa do banco + anexos + instalador.
# Uso: dois cliques em "gerar-pacote-migracao.cmd", na pasta do sistema.
$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$carimbo = Get-Date -Format 'yyyy-MM-dd_HHmm'
$saida = Join-Path $raiz 'migracao'
$zip = Join-Path $saida "ERP-Construtoras-migracao-$carimbo.zip"
$palco = Join-Path $env:TEMP "erp-migracao-$carimbo"

function Ler-Env($arquivo) {
  $v = @{}
  foreach ($linha in Get-Content -LiteralPath $arquivo -Encoding UTF8) {
    if ($linha -match '^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$') { $v[$matches[1]] = $matches[2].Trim() }
  }
  return $v
}

Write-Host ''
Write-Host '=== ERP Construtoras - gerar pacote de migração ===' -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $raiz '.env'))) { throw "Não encontrei o arquivo .env em $raiz" }
$cfg = Ler-Env (Join-Path $raiz '.env')

$dump = Get-ChildItem 'C:\Program Files\MySQL\MySQL Server *\bin\mysqldump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $dump) { throw 'Não encontrei o mysqldump.exe (MySQL Server em C:\Program Files\MySQL).' }

New-Item -ItemType Directory -Force -Path (Join-Path $palco 'erp-construtoras'), (Join-Path $palco 'banco'), $saida | Out-Null

# 1. Arquivos do sistema (inclui node_modules: funciona no PC novo mesmo sem internet)
Write-Host '1/4 Copiando os arquivos do sistema...'
$null = & robocopy $raiz (Join-Path $palco 'erp-construtoras') /E /NFL /NDL /NJH /NJS /NP /XD (Join-Path $raiz 'migracao') (Join-Path $raiz '.git')
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar os arquivos (robocopy $LASTEXITCODE)" }

# anexos guardados fora da pasta do sistema vão para storage\ dentro do pacote
$storage = if ($cfg.STORAGE_DIR) { $cfg.STORAGE_DIR } else { './storage' }
$storageAbs = [IO.Path]::GetFullPath((Join-Path $raiz $storage))
if ((Test-Path $storageAbs) -and -not $storageAbs.StartsWith($raiz, [StringComparison]::OrdinalIgnoreCase)) {
  Write-Host "    anexos em $storageAbs -> storage\ do pacote"
  $null = & robocopy $storageAbs (Join-Path $palco 'erp-construtoras\storage') /E /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar os anexos (robocopy $LASTEXITCODE)" }
  $envPalco = Join-Path $palco 'erp-construtoras\.env'
  $texto = (Get-Content -LiteralPath $envPalco -Encoding UTF8) -replace '^STORAGE_DIR=.*$', 'STORAGE_DIR=./storage'
  [IO.File]::WriteAllLines($envPalco, $texto, (New-Object Text.UTF8Encoding $false))
}
$qtdAnexos = 0
if (Test-Path (Join-Path $palco 'erp-construtoras\storage')) { $qtdAnexos = @(Get-ChildItem (Join-Path $palco 'erp-construtoras\storage') -Recurse -File).Count }

# 2. Cópia do banco
Write-Host "2/4 Exportando o banco '$($cfg.DB_NAME)'..."
$arquivoSql = Join-Path $palco 'banco\erp.sql'
$env:MYSQL_PWD = $cfg.DB_PASSWORD
try {
  & $dump.FullName "--host=$($cfg.DB_HOST)" "--port=$($cfg.DB_PORT)" "--user=$($cfg.DB_USER)" --single-transaction --no-tablespaces --routines --triggers --default-character-set=utf8mb4 --set-gtid-purged=OFF "--result-file=$arquivoSql" $cfg.DB_NAME
  if ($LASTEXITCODE -ne 0) { throw "mysqldump terminou com erro $LASTEXITCODE" }
} finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
$fim = Get-Content -LiteralPath $arquivoSql -Tail 1
if ($fim -notmatch 'Dump completed') { throw 'A exportação do banco ficou incompleta.' }
$tabelas = (Select-String -LiteralPath $arquivoSql -Pattern '^CREATE TABLE' ).Count

# 3. Instalador e instruções
Write-Host '3/4 Incluindo o instalador...'
foreach ($f in 'INSTALAR-NO-NOVO-PC.cmd', 'instalar.ps1', 'LEIA-ME.txt') { Copy-Item (Join-Path $PSScriptRoot $f) $palco }
@(
  "Pacote gerado em: $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
  "Computador de origem: $env:COMPUTERNAME"
  "Banco: $($cfg.DB_NAME) ($tabelas tabelas)"
  "Anexos: $qtdAnexos arquivo(s)"
  "TABELAS=$tabelas"
) | Set-Content -LiteralPath (Join-Path $palco 'versao.txt') -Encoding UTF8

# 4. Compactar
Write-Host '4/4 Compactando...'
if (Test-Path $zip) { Remove-Item $zip -Force }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $palco *
if ($LASTEXITCODE -ne 0) { throw "Falha ao compactar (tar $LASTEXITCODE)" }
Remove-Item $palco -Recurse -Force

$mb = '{0:N1}' -f ((Get-Item $zip).Length / 1MB)
Write-Host ''
Write-Host 'Pacote pronto:' -ForegroundColor Green
Write-Host "  $zip ($mb MB)"
Write-Host "  Banco com $tabelas tabelas, $qtdAnexos anexo(s)."
Write-Host ''
Write-Host 'ATENÇÃO: o pacote contém as senhas do sistema (.env). Leve num pendrive ou' -ForegroundColor Yellow
Write-Host 'pasta só sua e apague as cópias depois de instalar no PC novo.' -ForegroundColor Yellow
Write-Host 'O que for lançado neste PC depois de agora NÃO vai no pacote: gere de novo no dia da troca.' -ForegroundColor Yellow
