# Gera 6 JPEGs numerados para smoke test do módulo de vistorias.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot 'tmp-fotos'
New-Item -ItemType Directory -Force $dir | Out-Null
$cores = @(
  @(220, 38, 38), @(22, 163, 74), @(37, 99, 235),
  @(217, 119, 6), @(124, 58, 237), @(8, 145, 178)
)
for ($i = 1; $i -le 6; $i++) {
  $bmp = New-Object System.Drawing.Bitmap(800, 600)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $c = $cores[$i - 1]
  $fundo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($c[0], $c[1], $c[2]))
  $g.FillRectangle($fundo, 0, 0, 800, 600)
  $fonte = New-Object System.Drawing.Font('Segoe UI', 220, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $texto = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF(0, 0, 800, 600)
  $g.DrawString("$i", $fonte, $texto, $rect, $fmt)
  $bmp.Save((Join-Path $dir "foto$i.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose()
  $bmp.Dispose()
}
Get-ChildItem $dir | Select-Object Name, Length
