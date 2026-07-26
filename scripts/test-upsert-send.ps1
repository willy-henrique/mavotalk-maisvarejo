param(
    [string]$Url,
    [string]$Token,
    [string]$EventId,
    [string]$Phone,
    [string]$ClientName,
    [string]$Message,
    [string]$Mode = "1"
)

# Evita "jÃ¡", emojis quebrados etc. no console do Windows (use com chcp 65001 no .bat).
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
} catch { }

$ErrorActionPreference = 'Stop'

if ($Mode -eq "2") {
    # Modo n8n: envia payload abrangente para facilitar mapeamento no workflow
    # (compatível com workflows que leem campos no root ou em body).
    $payload = @{
        event_id   = $EventId
        id         = $EventId
        ticket_id  = $EventId
        ticket_ref = $EventId
        canal      = 'whatsapp'
        channel    = 'whatsapp'
        cliente    = @{
            nome     = $ClientName
            telefone = $Phone
        }
        cliente_nome     = $ClientName
        cliente_telefone = $Phone
        mensagem   = $Message
        mensagens  = $Message
        texto      = $Message
        conversa   = $Message
        tecnico    = "WillTalk Teste"
        data_evento = (Get-Date).ToString("o")
        metadata   = @{
            origem_fluxo = 'bat-local-n8n'
            ambiente     = 'local'
            dry_run      = $true
        }
    }
    # Alguns templates n8n usam $json.body (Webhook), outros usam $json direto.
    $body = @{
        body = $payload
    } + $payload | ConvertTo-Json -Depth 10
} else {
    $body = @{
        event_id = $EventId
        canal    = 'whatsapp'
        cliente  = @{
            nome     = $ClientName
            telefone = $Phone
        }
        mensagem = $Message
        metadata = @{
            origem_fluxo = 'bat-local'
            ambiente     = 'local'
            dry_run      = $true
        }
    } | ConvertTo-Json -Depth 8
}

$headers = @{
    Authorization  = "Bearer $Token"
    'Content-Type' = 'application/json'
}
if ($Mode -eq "2") {
    # Contrato canônico de ingestão para conectores n8n/chat-inteligente.
    $headers["X-Source-System"] = "willtalk"
    $headers["X-Source-Entity-Id"] = $EventId
    $headers["X-Tenant-Id"] = "org_willtalk_default"
    $headers["X-Ingestion-Id"] = $EventId
}

try {
    $res = Invoke-RestMethod -Method POST -Uri $Url -Headers $headers -Body $body -TimeoutSec 15

    Write-Host ''
    Write-Host '  ═══════════════ RESPOSTA ═══════════════' -ForegroundColor Cyan
    $res | ConvertTo-Json -Depth 10 | Write-Host
    Write-Host ''

    Write-Host '  ═══════════════ RESUMO ════════════════' -ForegroundColor Green
    Write-Host "  mode:            $Mode"
    if ($null -ne $res.action)          { Write-Host "  action:          $($res.action)" }
    if ($null -ne $res.shouldReply)     { Write-Host "  shouldReply:     $($res.shouldReply)" }
    if ($null -ne $res.triageCompleted) { Write-Host "  triageCompleted: $($res.triageCompleted)" }
    if ($null -ne $res.menuAttempts)    { Write-Host "  menuAttempts:    $($res.menuAttempts)" }
    if ($null -ne $res.conversationId)  { Write-Host "  conversationId:  $($res.conversationId)" }
    if ($null -ne $res.ticketId)        { Write-Host "  ticketId:        $($res.ticketId)" }
    Write-Host ''

    if ($res.shouldReply -eq $true) {
        Write-Host '  >>> Bot RESPONDEU (triagem ativa)' -ForegroundColor Green
        if ($res.replyText) {
            Write-Host ''
            Write-Host '  Texto enviado ao WhatsApp:' -ForegroundColor DarkCyan
            Write-Host "  $($res.replyText)" -ForegroundColor White
        }
    } elseif ($Mode -eq "2") {
        Write-Host '  >>> Fluxo n8n executado. Valide no execution log do n8n e no Cerebro.' -ForegroundColor Green
    } else {
        Write-Host '  >>> Bot NAO respondeu (triagem completa / pos-triagem)' -ForegroundColor Yellow
        Write-Host '      Conversa sob responsabilidade do atendente humano.' -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host "  event_id: $EventId" -ForegroundColor DarkGray
} catch {
    Write-Host ''
    Write-Host '  ═══════════════ ERRO ═══════════════' -ForegroundColor Red

    $statusCode = 0
    if ($_.Exception.Response -ne $null) {
        $statusCode = [int]$_.Exception.Response.StatusCode
    }

    Write-Host "  HTTP Status: $statusCode"
    Write-Host "  Erro: $($_.Exception.Message)"

    if ($statusCode -eq 401) {
        Write-Host ''
        Write-Host '  Token invalido!' -ForegroundColor Yellow
        Write-Host '  Verifique WILLTALK_WEBHOOK_TOKEN no .env e no .bat' -ForegroundColor Yellow
    }

    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $respBody = $reader.ReadToEnd()
        if ($respBody) {
            Write-Host "  Body: $respBody"
        }
    } catch {}

    exit 1
}
