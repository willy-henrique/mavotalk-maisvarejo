param(
    [string]$Url,
    [string]$Token = ""
)

$ErrorActionPreference = "Stop"

function Test-Endpoint {
    param(
        [Parameter(Mandatory = $true)][string]$TargetUrl,
        [string]$BearerToken = ""
    )

    $headers = @{ "Content-Type" = "application/json" }
    if (-not [string]::IsNullOrWhiteSpace($BearerToken)) {
        $headers["Authorization"] = "Bearer $BearerToken"
    }

    $body = '{"probe":"healthcheck"}'
    try {
        $res = Invoke-WebRequest -Uri $TargetUrl -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 8
        return @{
            ok = $true
            status = [int]$res.StatusCode
            message = "HTTP $([int]$res.StatusCode)"
        }
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($response -ne $null) {
            return @{
                ok = $true
                status = [int]$response.StatusCode
                message = "HTTP $([int]$response.StatusCode)"
            }
        }
        return @{
            ok = $false
            status = 0
            message = $_.Exception.Message
        }
    } catch {
        return @{
            ok = $false
            status = 0
            message = $_.Exception.Message
        }
    }
}

$main = Test-Endpoint -TargetUrl $Url -BearerToken $Token
if ($main.ok) {
    Write-Host "OK: $Url -> $($main.message)" -ForegroundColor Green
    exit 0
}

# Para n8n, tenta fallback no endpoint de teste quando a URL e /webhook/...
$fallbackUrl = $null
if ($Url -match "/webhook/") {
    $fallbackUrl = $Url -replace "/webhook/", "/webhook-test/"
    $fallback = Test-Endpoint -TargetUrl $fallbackUrl -BearerToken $Token
    if ($fallback.ok) {
        Write-Host "OK: $fallbackUrl -> $($fallback.message)" -ForegroundColor Yellow
        Write-Host "Aviso: endpoint de producao indisponivel. Endpoint de teste do n8n esta respondendo." -ForegroundColor Yellow
        exit 0
    }
    Write-Host "Falha: $Url -> $($main.message)" -ForegroundColor Red
    Write-Host "Falha: $fallbackUrl -> $($fallback.message)" -ForegroundColor Red
    exit 1
}

Write-Host "Falha: $Url -> $($main.message)" -ForegroundColor Red
exit 1
