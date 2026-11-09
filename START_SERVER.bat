@echo off
title DarkPAKI Full-Stack Server & Admin Console
color 0A
cd /d "D:\darkpaki"
echo ===================================================
echo   Starting DarkPAKI VIP Streaming Server & Admin
echo ===================================================
echo   Website: http://localhost:5000
echo   Admin Console: http://localhost:5000/admin
echo   Master PIN: 7860
echo ===================================================
node src/server.js
pause
