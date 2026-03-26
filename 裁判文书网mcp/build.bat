@echo off
echo Building project...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    pause
    exit /b 1
)
echo Build completed successfully!
pause
