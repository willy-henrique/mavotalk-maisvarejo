@echo off
echo ========================================
echo  VERIFICACAO DE CONFIGURACAO WEBHOOK N8N
echo ========================================
echo.

echo 1. Verificando WillTalk .env...
echo.
type C:\willydev\willtalk\.env | findstr /i "WILLTALK_WEBHOOK_URL"
echo.

echo 2. Verificando se URL esta correta...
echo URL ESPERADA: http://localhost:5678/webhook-test/03651a89-8f3b-4635-a06d-e97157750352
echo.

echo 3. Testando conexao com n8n...
curl -s http://localhost:5678/healthz > nul
if %errorlevel% equ 0 (
    echo ✅ n8n esta respondendo (porta 5678)
    
    echo.
    echo 4. Testando webhook especifico...
    echo Enviando teste para webhook...
    curl -X POST http://localhost:5678/webhook-test/03651a89-8f3b-4635-a06d-e97157750352 ^
      -H "Content-Type: application/json" ^
      -d "{\"test\":\"webhook verification\",\"timestamp\":\"%date% %time%\"}"
    
    echo.
    echo Se retornou 404: Workflow nao esta ativo no n8n!
    echo Se retornou 200: Webhook esta funcionando!
) else (
    echo ❌ n8n nao esta respondendo na porta 5678
    echo.
    echo Para iniciar n8n:
    echo docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
)

echo.
echo 5. Verificando WillTalk...
curl -s http://localhost:4002/api/health > nul
if %errorlevel% equ 0 (
    echo ✅ WillTalk esta respondendo (porta 4002)
) else (
    echo ❌ WillTalk nao esta respondendo na porta 4002
    echo Execute: npm run dev
)

echo.
echo 6. Verificando MAVO.AI...
curl -s http://localhost:3000/api/health > nul
if %errorlevel% equ 0 (
    echo ✅ MAVO.AI esta respondendo (porta 3000)
) else (
    echo ❌ MAVO.AI nao esta respondendo na porta 3000
    echo Execute na pasta chat-inteligente: npm run dev
)

echo.
echo ========================================
echo  RESUMO DA CONFIGURACAO
echo ========================================
echo.
echo IMPORTANTE: Para o fluxo completo funcionar:
echo 1. n8n deve estar rodando (docker run ...)
echo 2. Workflow deve estar ATIVO (toggle no canto superior direito)
echo 3. WillTalk .env deve ter URL correta
echo 4. Todos servicos devem estar rodando
echo.
echo Para atualizar WillTalk .env:
echo cd C:\willydev\chat-inteligente
echo scripts\atualizar-willtalk-env.bat
echo.
echo Para testar integracao completa:
echo teste-integracao-completa-corrigido.bat
echo.
pause