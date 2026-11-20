@echo off
rem ASCII only in this file: cmd reads .bat as OEM codepage (GBK on zh-CN),
rem so UTF-8 Chinese here would be mangled and can break parsing.
rem All user-facing text lives in scripts\publish-wizard.mjs (Node reads UTF-8 fine).
chcp 65001 >nul
cd /d "%~dp0"

rem Node 不在 PATH 上的机器（比如打包机的绿色 node），把完整路径写进
rem node-path.txt 一行即可；这个文件是 gitignore 的，不会进仓库。
set "NODE=node"
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"

"%NODE%" scripts\publish-wizard.mjs

echo.
pause
