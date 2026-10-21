@echo off
rem ============================================================================
rem  start-phone.bat -- start the backend for phone testing (Windows entry)
rem ============================================================================
rem  This file is ONLY a thin shell. All real logic lives in tools\serve-phone.mjs
rem  -- no duplicated logic here (a second copy always drifts).
rem  It only does the three things that "double-click" needs on Windows:
rem    1. cd into the script's own folder (double-click starts in System32)
rem    2. check node exists and is new enough (else the error is unreadable)
rem    3. keep the window open on failure (on success node holds it anyway)
rem
rem  ** MUST stay pure ASCII. No CJK, no accents, nothing above 0x7F. **
rem     Reason (measured, not theory): cmd.exe re-reads this file byte-by-byte
rem     and (re)decodes each line with the CURRENT code page. With CJK bytes in
rem     here, the `chcp 65001` below makes the decoder lose sync, and fragments
rem     of comment lines get executed as commands ("... is not recognized").
rem     => All Chinese user-facing text is printed by node instead (it is UTF-8
rem        and correct); chcp 65001 below only exists so THAT output displays.
rem ============================================================================

chcp 65001 >nul
setlocal
title newmud - phone backend
pushd "%~dp0" || goto :no_dir

echo ============================================================
echo   newmud - phone backend
echo   real work is done by tools\serve-phone.mjs
echo ============================================================
echo.

rem -- 1. is node on PATH? --------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :no_node

rem -- 2. is the version new enough? (engines wants 22.15 or newer) ---------
rem    note: the > below sits inside double quotes, so cmd does not redirect.
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=15)?0:1)" >nul 2>nul
if errorlevel 1 goto :old_node

rem -- 3. hand over to the real entry; args pass through (--port 8124 etc) --
node "tools\serve-phone.mjs" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo ------------------------------------------------------------
  echo   FAILED ^(exit code %EXITCODE%^). See the lines ABOVE.
  echo   Common causes:
  echo     port busy    -^> stop `npm run dev`, or: start-phone.bat --port 8124
  echo     build failed -^> read the tsc errors above
  echo     node too old -^> see the message below
  echo ------------------------------------------------------------
  pause
)

popd
rem  ** %EXITCODE% must be expanded BEFORE endlocal erases it **
rem  On two separate lines, endlocal runs first and wipes the variable, so
rem  `exit /b %EXITCODE%` degrades to `exit /b` (returns 0) and the failure
rem  becomes invisible to anything calling this script. Same line = one parse.
endlocal & exit /b %EXITCODE%

:no_node
echo [ERROR] `node` was not found on PATH.
echo.
echo   1^) Install Node 22.15 or newer: https://nodejs.org/
echo   2^) Then OPEN A NEW cmd window before double-clicking this file
echo      ^(PATH is read when the window is created^).
echo.
pause
popd
endlocal
exit /b 1

:old_node
echo [ERROR] node is too old. This project needs 22.15 or newer.
echo.
node -v
echo.
echo   Upgrade: https://nodejs.org/  ^(LTS or 22.x^)
echo.
pause
popd
endlocal
exit /b 1

:no_dir
echo [ERROR] Could not enter the script folder: %~dp0
echo   Keep this file inside the newmud folder ^(it must find tools\serve-phone.mjs^).
pause
endlocal
exit /b 1
