# Le chave do .env na raiz do repo (compativel UTF-8).
# Uso padrao (compat): retorna WILLTALK_WEBHOOK_TOKEN.
param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $false)]
    [string]$Key = "WILLTALK_WEBHOOK_TOKEN"
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$envFile = Join-Path $RepoRoot ".env"
if (-not (Test-Path $envFile)) {
    [Console]::Error.WriteLine("Arquivo .env nao encontrado em: $envFile")
    exit 2
}

foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $line = $rawLine.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    if ($line -notmatch "^\s*$([Regex]::Escape($Key))\s*=\s*(.+)$") { continue }

    $value = $Matches[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    elseif ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($value)) {
        Write-Output $value
        exit 0
    }
}

[Console]::Error.WriteLine("$Key nao definido no .env")
exit 3
