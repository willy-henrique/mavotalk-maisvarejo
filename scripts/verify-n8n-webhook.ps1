# Verifica se o webhook n8n configurado em WILLTALK_WEBHOOK_URL está registrado (evita 404).
# Uso: na raiz do repo: powershell -ExecutionPolicy Bypass -File scripts/verify-n8n-webhook.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$Key
    )

    if (-not (Test-Path $FilePath)) { return $null }

    foreach ($rawLine in Get-Content $FilePath) {
        $line = $rawLine.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { continue }
        if ($line -notmatch "^\s*$Key\s*=\s*(.*)$") { continue }

        $value = $Matches[1].Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
            return $value.Substring(1, $value.Length - 2)
        }
        if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
            return $value.Substring(1, $value.Length - 2)
        }
        return $value
    }

    return $null
}

$url = Get-EnvValue -FilePath $envFile -Key "WILLTALK_WEBHOOK_URL"
$token = Get-EnvValue -FilePath $envFile -Key "WILLTALK_WEBHOOK_TOKEN"

if (-not $url) { $url = "http://127.0.0.1:5678/webhook/willtalk-ingestao" }
if (-not $token) { $token = "" }

Write-Host "URL: $url" -ForegroundColor Cyan

$headers = @{ "Content-Type" = "application/json" }
if ($token) { $headers["Authorization"] = "Bearer $token" }

$body = '{"ping":"willtalk-verify"}'

$webErr = $null
$resp = Invoke-WebRequest -Uri $url -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue -ErrorVariable webErr

if ($resp) {
    Write-Host "OK - HTTP $($resp.StatusCode). Webhook registrado no n8n." -ForegroundColor Green
    exit 0
}

$code = 0
$message = "Falha ao chamar webhook."
if ($webErr -and $webErr[0].Exception) {
    if ($webErr[0].Exception.Response) {
        $code = [int]$webErr[0].Exception.Response.StatusCode
    }
    $message = $webErr[0].Exception.Message
}

Write-Host "FALHA - HTTP $code" -ForegroundColor Red
Write-Host $message
Write-Host ""
Write-Host "Se for 404: no n8n verifique se o workflow esta ativo (toggle Active no canto superior direito)," -ForegroundColor Yellow
Write-Host "e se o path do webhook e: webhook-test/03651a89-8f3b-4635-a06d-e97157750352" -ForegroundColor Yellow
Write-Host "Ou ajuste WILLTALK_WEBHOOK_URL no .env para a URL correta do webhook." -ForegroundColor Yellow
exit 1
