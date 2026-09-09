@echo off
cd /d C:\willydev\mavotalk-maisvarejo
start "MavoAPI" cmd /k "node server.cjs"
cd /d C:\willydev\mavotalk-maisvarejo\frontend
start "MavoWeb" cmd /k "npm run dev -- --host 0.0.0.0 --port 4001"
