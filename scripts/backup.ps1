# Backup do Sistema Julia - banco (pg_dump) + fotos/arquivos (volume uploads_data).
#
# Roda no HOST (Windows), com o stack no ar:
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
#
# Deixa em .\backups:
#   db-AAAA-MM-DD-HHMM.sql.gz       (banco inteiro, compactado)
#   uploads-AAAA-MM-DD-HHMM.tgz     (fotos, plantas, laudos, arquivos do GED)
# e mantem as 14 copias mais recentes de cada. O backend le essa pasta
# (montada so para leitura) e o painel avisa quando a ultima copia passou de
# 2 dias. Para guardar fora da maquina, defina BACKUP_DESTINO_EXTRA
# (disco externo, pasta sincronizada com nuvem) - a copia e replicada la.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$destino = Join-Path $raiz 'backups'
if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }
$carimbo = Get-Date -Format 'yyyy-MM-dd-HHmm'
$manter = 14

# 1) Banco - pg_dump dentro do container do Postgres, compactado la dentro e
# copiado com docker cp. NAO redirecionar a saida com ">" no PowerShell 5.1:
# ele converte o fluxo binario em texto UTF-16 e o .gz sai corrompido.
$db = Join-Path $destino "db-$carimbo.sql.gz"
Write-Host "[backup] banco -> $db"
docker compose exec -T db sh -c "pg_dump -U sysjulia -d sistema_julia | gzip -6 > /tmp/db-backup.sql.gz"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou (stack fora do ar?)' }
docker compose cp db:/tmp/db-backup.sql.gz $db
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $db) -or (Get-Item $db).Length -lt 1024) { throw 'copia do dump falhou' }
docker compose exec -T db rm -f /tmp/db-backup.sql.gz

# 2) Uploads - o volume nomeado e lido por um container descartavel.
$up = Join-Path $destino "uploads-$carimbo.tgz"
Write-Host "[backup] uploads -> $up"
$projeto = 'sistema-julia'
$volume = "${projeto}_uploads_data"
$destDocker = ($destino -replace '\\', '/')
docker run --rm -v "${volume}:/dados:ro" -v "${destDocker}:/saida" alpine sh -c "cd /dados && tar czf /saida/uploads-$carimbo.tgz --exclude='./tmp' ."
if ($LASTEXITCODE -ne 0) { throw 'tar do volume de uploads falhou' }

# 3) Retencao: mantem as N mais recentes de cada tipo.
foreach ($prefixo in @('db-', 'uploads-')) {
  Get-ChildItem $destino -Filter "$prefixo*" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $manter | ForEach-Object {
    Write-Host "[backup] apagando copia antiga $($_.Name)"
    Remove-Item $_.FullName -Force
  }
}

# 4) Copia extra (opcional).
$extra = $env:BACKUP_DESTINO_EXTRA
if ($extra) {
  if (-not (Test-Path $extra)) { New-Item -ItemType Directory -Path $extra -Force | Out-Null }
  Copy-Item $db $extra -Force
  Copy-Item $up $extra -Force
  Write-Host "[backup] replicado em $extra"
}

Write-Host ("[backup] concluido: {0:N0} KB (banco) + {1:N1} MB (uploads)" -f ((Get-Item $db).Length / 1KB), ((Get-Item $up).Length / 1MB))
