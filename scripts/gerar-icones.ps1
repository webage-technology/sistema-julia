# Gera os ícones PNG do PWA (192/512/apple-touch-icon) com GDI+ — sem dependências.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\frontend\public\icons'
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($tam in @(512, 192, 180)) {
  $bmp = New-Object System.Drawing.Bitmap($tam, $tam)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $fundo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 23, 42))
  $g.FillRectangle($fundo, 0, 0, $tam, $tam)
  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 130, 246))
  $g.FillRectangle($accent, 0, [int]($tam * 0.82), $tam, [int]($tam * 0.18))
  $fonte = New-Object System.Drawing.Font('Segoe UI', [int]($tam * 0.42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $texto = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF(0, (-$tam * 0.06), $tam, $tam)
  $g.DrawString('SJ', $fonte, $texto, $rect, $fmt)
  $nome = if ($tam -eq 180) { 'apple-touch-icon.png' } else { "icon-$tam.png" }
  $bmp.Save((Join-Path $dir $nome), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}
Get-ChildItem $dir | Select-Object Name, Length
