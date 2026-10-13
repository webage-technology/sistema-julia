# Registra a tarefa agendada do Windows que roda scripts\backup.ps1 todo dia
# às 02:30 (e 10 minutos depois do boot, caso a máquina estivesse desligada).
#
# Rodar UMA vez, como administrador, na raiz do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\registrar-backup.ps1
# Para remover: Unregister-ScheduledTask -TaskName 'Sistema Julia Backup' -Confirm:$false
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$script = Join-Path $raiz 'scripts\backup.ps1'
$nome = 'Sistema Julia Backup'

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $raiz
$gatilhos = @(
  (New-ScheduledTaskTrigger -Daily -At '02:30'),
  (New-ScheduledTaskTrigger -AtStartup)
)
$gatilhos[1].Delay = 'PT10M'
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$usuario = "$env:USERDOMAIN\$env:USERNAME"

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilhos -Settings $config -User $usuario -RunLevel Highest -Force | Out-Null
Write-Host "[backup] tarefa '$nome' registrada: todo dia as 02:30 e 10 min apos o boot."
Write-Host "[backup] rode agora para testar: powershell -ExecutionPolicy Bypass -File `"$script`""
