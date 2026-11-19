@echo off
setlocal
cd /d "%~dp0"
title Yahoo Unified Report

if not exist "yahoo_unificat.py" (
    echo ERROR: yahoo_unificat.py must be in the same folder as this BAT file.
    pause
    exit /b 1
)

py -3 -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py -3"
    goto ready
)
python -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    goto ready
)
echo ERROR: Python 3.10 or newer is required. Install Python and enable PATH.
pause
exit /b 1

:ready
%PYTHON% -c "import requests, pandas, openpyxl" >nul 2>&1
if not errorlevel 1 goto run
echo ERROR: Required packages are missing. Use a project virtual environment.
echo Install requests pandas openpyxl there; live downloads also require yfinance lxml.
pause
exit /b 1

:run
echo Running the unified report...
%PYTHON% "%~dp0yahoo_unificat.py" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" goto failed
echo.
echo Finished. Excel output is saved in the Output folder.
goto finish
:failed
echo.
echo Program exited with code %RESULT%. Check the messages above.
:finish
pause
exit /b %RESULT%
