cd /d C:\willydev\mavotalk-maisvarejo
call npx next build || exit /b 1
start "MavoTalk-API" /min cmd /c "node server.cjs > api.log 2>&1"
cd /d C:\willydev\mavotalk-maisvarejo\frontend
start "MavoTalk-Web" /min cmd /c "npm run dev -- --host 0.0.0.0 --port 4001 > web.log 2>&1"
