$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "HOW_TO_USE.html"
$output = Join-Path $root "Daniel Fire - How to Use.pdf"

if (-not (Test-Path $source)) {
  throw "Source HTML not found: $source"
}

$word = $null
$document = $null

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($source, $false, $true)
  $document.ExportAsFixedFormat($output, 17)
}
finally {
  if ($document -ne $null) {
    $document.Close([ref]0)
  }
  if ($word -ne $null) {
    $word.Quit()
  }
}

Write-Output "Wrote $output"
