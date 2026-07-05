@echo off
chcp 65001 >nul
REM ===========================================================================
REM data-fire one-click launcher (Windows)
REM -------------------------------------------------------------------------
REM Starts three services so the full chain runs:
REM   1) extension      http://localhost:8080   tsup output for Scratch to load
REM   2) dashboard API  http://localhost:8000   FastAPI, collects data + metrics
REM   3) dashboard web  http://localhost:5173   Vite dev server, /api proxied to 8000
REM Usage: double-click this file, or run  .\start.bat  in the project root.
REM Stop:  close the three popup windows, or press Ctrl+C in this window.
REM Prereq: node_modules and .venv already installed. If not, run npm i / pip install first.
REM ===========================================================================

setlocal enabledelayedexpansion

REM Working directory base: the folder this script lives in (project root)
set "ROOT=%~dp0"

REM Precheck — bail out early if anything is missing, so popup windows don't flash and hide errors
where node >nul 2>&1 || (echo [x] node not found, please install Node.js first & pause & exit /b 1)
where python >nul 2>&1 || (echo [x] python not found, please install Python first & pause & exit /b 1)

if not exist "%ROOT%node_modules" (
  echo [x] root node_modules missing, run: npm install  in the project root
  pause & exit /b 1
)
if not exist "%ROOT%scratcher-dashboard\web\node_modules" (
  echo [x] web node_modules missing, run: npm install  in scratcher-dashboard\web
  pause & exit /b 1
)
if not exist "%ROOT%scratcher-dashboard\server\.venv" (
  echo [x] server .venv missing, run in scratcher-dashboard\server:
  echo     py -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
  pause & exit /b 1
)

echo [1/3] starting extension (http-server, port 8080)...
start "data-fire ext :8080" cmd /k "cd /d %ROOT% && npx http-server ./dist -p 8080 --cors"

echo [2/3] starting dashboard API (uvicorn, port 8000)...
start "data-fire api :8000" cmd /k "cd /d %ROOT%scratcher-dashboard\server && .venv\Scripts\uvicorn.exe main:app --reload --port 8000"

echo [3/3] starting dashboard web (Vite, port 5173)...
start "data-fire web :5173" cmd /k "cd /d %ROOT%scratcher-dashboard\web && npx vite"

echo.
echo ============================================================
echo  All started. Open in browser:
echo    extension url (paste into Scratch/TurboWarp): http://localhost:8080/index.js
echo    dashboard web:                                http://localhost:5173
echo    backend API docs (probe):                     http://localhost:8000/docs
echo  Each runs in its own window; close the window to stop it.
echo ============================================================
echo.
echo This window can be closed without affecting the services.
pause
endlocal