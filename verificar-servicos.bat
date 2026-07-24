@echo off
echo ========================================
echo  VERIFICAÇÃO DE SERVIÇOS WILLTALK
echo ========================================
echo.

echo 1. VERIFICANDO POSTGRESQL...
echo ----------------------------------------
echo Procurando serviços PostgreSQL...
sc query | findstr /i postgres
if %errorlevel% equ 0 (
    echo.
    echo Serviço PostgreSQL encontrado.
    echo Para iniciar: net start postgresql
) else (
    echo Nenhum serviço PostgreSQL encontrado.
)

echo.
echo 2. VERIFICANDO XAMPP (se instalado)...
echo ----------------------------------------
if exist "C:\xampp\mysql\bin\mysqld.exe" (
    echo XAMPP encontrado em C:\xampp
    echo PostgreSQL do XAMPP geralmente roda na porta 5432
) else (
    echo XAMPP não encontrado.
)

echo.
echo 3. VERIFICANDO PORTA 5433...
echo ----------------------------------------
netstat -an | find ":5433"
if %errorlevel% equ 0 (
    echo ✅ Porta 5433 em uso
) else (
    echo ❌ Porta 5433 NÃO em uso
)

echo.
echo 4. VERIFICANDO PORTA 5432...
echo ----------------------------------------
netstat -an | find ":5432"
if %errorlevel% equ 0 (
    echo ✅ Porta 5432 em uso
    echo.
    echo ⚠️  Altere DATABASE_URL no .env para:
    echo    DATABASE_URL="postgresql://postgres:SUA_SENHA@localhost:5432/willtalk"
) else (
    echo ❌ Porta 5432 NÃO em uso
)

echo.
echo 5. SOLUÇÕES:
echo ----------------------------------------
echo.
echo OPÇÃO A: Usar PostgreSQL Portable
echo 1. Baixe PostgreSQL portable
echo 2. Extraia para C:\pgsql
echo 3. Inicie: C:\pgsql\bin\pg_ctl.exe -D C:\pgsql\data start -p 5433
echo.
echo OPÇÃO B: Usar Docker
echo 1. Instale Docker Desktop
echo 2. Execute: docker run -d --name willtalk-postgres -p 5433:5432 -e POSTGRES_PASSWORD=1 -e POSTGRES_DB=willtalk postgres
echo.
echo OPÇÃO C: Alterar para SQLite (mais simples)
echo 1. Instale: npm install better-sqlite3
echo 2. Altere DB_PROVIDER no .env
echo.
echo ========================================
echo  CONFIGURAÇÃO ATUAL .env:
echo ========================================
type .env | findstr /i "DATABASE_URL DB_PROVIDER PORT"
echo.
pause