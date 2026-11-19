@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import yfinance, pandas, requests, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo Python cu yfinance, pandas, requests si openpyxl este necesar.
    pause
    exit /b 1
)
py -3 dashboard_server.py
pause
