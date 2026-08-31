@echo off
chcp 65001 >nul
title AI Review Bridge
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0AI-Review-Bridge.ps1"
pause
