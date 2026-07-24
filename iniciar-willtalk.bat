@echo off
echo ========================================
echo  INICIALIZAÇÃO WILLTALK
echo ========================================
echo.

echo 1. PARANDO PROCESSOS EXISTENTES...
echo ----------------------------------------
taskkill /F /IM node.exe 2>nul
if %errorlevel% equ 0 (
    echo ✅ Processos node finalizados
) else (
    echo ℹ️  Nenhum processo node encontrado
)

echo.
echo 2. REMOVENDO LOCKS...
echo ----------------------------------------
del /Q .next\dev\lock 2>nul
if exist .next\dev\lock (
    echo ❌ Não foi possível remover lock
) else (
    echo ✅ Locks removidos
)

echo.
echo 3. VERIFICANDO CONFIGURAÇÃO...
echo ----------------------------------------
echo Porta: 4003
echo DB_PROVIDER: firestore
echo WHATSAPP_PROVIDER: unofficial
echo WILLTALK_N8N_ONLY: false

echo.
echo 4. INICIANDO WILLTALK...
echo ----------------------------------------
echo Aguarde... O servidor iniciará em um novo terminal.
echo.

start "WillTalk Server" cmd /k "cd /d C:\willydev\willtalk && npm run dev"

echo.
echo 5. AGUARDANDO INICIALIZAÇÃO...
echo ----------------------------------------
timeout /t 10 /nobreak > nul

echo.
echo 6. VERIFICANDO STATUS...
echo ----------------------------------------
curl -s http://localhost:4003 > nul
if %errorlevel% equ 0 (
    echo ✅ WillTalk está rodando em http://localhost:4003
    echo.
    echo 📱 Para conectar WhatsApp:
    echo 1. Acesse: http://localhost:4003
    echo 2. Login: admin@willtalk.com / admin123
    echo 3. Configurações -> WhatsApp
    echo 4. Escaneie QR code
) else (
    echo ❌ WillTalk NÃO está respondendo
    echo Verifique o terminal com os logs de erro.
)

echo.
echo ========================================
echo  PRÓXIMOS PASSOS:
echo ========================================
echo 1. Conecte WhatsApp via QR code
echo 2. Envie mensagem do celular
echo 3. Verifique se aparece em "Conversas"
echo 4. Status deve ser "aguardando"
echo.
echo Para teste rápido: teste-rapido-windows.bat
echo.
pause