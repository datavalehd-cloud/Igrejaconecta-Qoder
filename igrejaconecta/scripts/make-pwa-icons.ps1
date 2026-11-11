# Gera os ícones PWA e a imagem de compartilhamento (Fase 9) a partir da
# geometria do public/favicon.svg, usando System.Drawing (GDI+). Sem Python,
# sem ImageMagick, sem dependência externa — só o que já vem no Windows.
#
# Geometria (espaço 64x64 do favicon):
#   rect 0,0 64x64 rx=14  navy #15345B
#   cruz branca: vertical (32,12)->(32,52), horizontal (20,24)->(44,24), largura 6, caps round
#   ponto verde #16A36A: círculo (32,46) raio 5
#
# Saída (public/): icon-192.png, icon-512.png, maskable-512.png,
#                  apple-touch-icon.png (180), og-image.png (1200x630)
# Rode: powershell -ExecutionPolicy Bypass -File scripts/make-pwa-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$Public = Join-Path $Root 'public'
if (-not (Test-Path $Public)) { throw "public/ não encontrado em $Public" }

$NAVY  = [System.Drawing.Color]::FromArgb(255, 21, 52, 91)   # #15345B
$GREEN = [System.Drawing.Color]::FromArgb(255, 22, 163, 106) # #16A36A
$WHITE = [System.Drawing.Color]::White
$LIGHT = [System.Drawing.Color]::FromArgb(255, 159, 192, 224) # #9FC0E0 (texto de apoio)

function New-RoundedRectPath([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Desenha cruz + ponto verde no espaço 64x64 escalado por $f e deslocado ($ox,$oy).
function Draw-Mark($g, [double]$f, [double]$ox, [double]$oy) {
  $pen = New-Object System.Drawing.Pen($WHITE, (6 * $f))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, ($ox + 32 * $f), ($oy + 12 * $f), ($ox + 32 * $f), ($oy + 52 * $f))
  $g.DrawLine($pen, ($ox + 20 * $f), ($oy + 24 * $f), ($ox + 44 * $f), ($oy + 24 * $f))
  $pen.Dispose()
  $green = New-Object System.Drawing.SolidBrush($GREEN)
  $g.FillEllipse($green, ($ox + 27 * $f), ($oy + 41 * $f), (10 * $f), (10 * $f))
  $green.Dispose()
}

# Ícone de app. $purpose: 'any' (canto arredondado, fundo transparente),
# 'maskable' (fundo cheio, conteúdo na zona segura de 80%), 'apple' (fundo cheio).
function New-AppIcon([string]$outPath, [int]$size, [string]$purpose) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $navyBrush = New-Object System.Drawing.SolidBrush($NAVY)

  if ($purpose -eq 'any') {
    $path = New-RoundedRectPath 0 0 $size $size (14 * $size / 64)
    $g.FillPath($navyBrush, $path)
    $path.Dispose()
    $f = $size / 64; $ox = 0; $oy = 0
  } else {
    $g.FillRectangle($navyBrush, 0, 0, $size, $size)
    if ($purpose -eq 'maskable') { $f = ($size / 64) * 0.8; $ox = $size * 0.1; $oy = $size * 0.1 }
    else { $f = $size / 64; $ox = 0; $oy = 0 }
  }

  Draw-Mark $g $f $ox $oy
  $navyBrush.Dispose()
  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "gerado: $outPath (${size}x${size}, $purpose)"
}

# Cartão de compartilhamento 1200x630: marca à esquerda, nome + tagline à direita.
function New-OgImage([string]$outPath) {
  $w = 1200; $h = 630
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($NAVY)

  # Marca (cruz + ponto) flutuando sobre o navy, à esquerda.
  $mf = 250 / 64; $mx = 110; $my = ($h - 250) / 2
  Draw-Mark $g $mf $mx $my

  $fmt = New-Object System.Drawing.StringFormat
  $fmt.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap

  $titleFont = New-Object System.Drawing.Font('Segoe UI', 88, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $tagFont   = New-Object System.Drawing.Font('Segoe UI', 32, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $titleBrush = New-Object System.Drawing.SolidBrush($WHITE)
  $tagBrush   = New-Object System.Drawing.SolidBrush($LIGHT)
  $greenBrush = New-Object System.Drawing.SolidBrush($GREEN)

  $tx = 420
  $g.DrawString('IgrejaConecta', $titleFont, $titleBrush, [single]$tx, [single]200, $fmt)
  # Divisor verde curto entre o título e a tagline.
  $g.FillRectangle($greenBrush, [single]$tx, [single]330, [single]150, [single]8)
  $g.DrawString('Conectando igrejas e pessoas através de eventos', $tagFont, $tagBrush, [single]$tx, [single]366, $fmt)

  $titleFont.Dispose(); $tagFont.Dispose()
  $titleBrush.Dispose(); $tagBrush.Dispose(); $greenBrush.Dispose()
  $fmt.Dispose(); $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "gerado: $outPath (${w}x${h}, og)"
}

New-AppIcon (Join-Path $Public 'icon-192.png')        192 'any'
New-AppIcon (Join-Path $Public 'icon-512.png')        512 'any'
New-AppIcon (Join-Path $Public 'maskable-512.png')    512 'maskable'
New-AppIcon (Join-Path $Public 'apple-touch-icon.png') 180 'apple'
New-OgImage  (Join-Path $Public 'og-image.png')

Write-Host 'OK — ícones PWA gerados.'
