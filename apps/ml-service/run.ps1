# Run ML service. Prefer Python 3.11 or 3.12 (pydantic has no wheels for 3.14 yet).
# Usage: .\run.ps1   or   pwsh -File run.ps1

$use312 = $false
try {
    $null = & py -3.12 --version 2>&1
    if ($LASTEXITCODE -eq 0) { $use312 = $true }
} catch {}

if ($use312) {
    Write-Host "Using Python 3.12 for ML service (required for pydantic wheels)."
    $venv = ".venv312"
    if (-not (Test-Path $venv)) {
        & py -3.12 -m venv $venv
        & "$venv\Scripts\pip" install -r requirements.txt
    }
    & "$venv\Scripts\python" -m uvicorn main:app --host 0.0.0.0 --port 8000
    exit
}

# Only 3.14 or no py launcher
$pyver = (python --version 2>&1) -replace "Python "
if ($pyver -match "3\.14") {
    Write-Host ""
    Write-Host "Python 3.14 is active; pydantic has no pre-built wheels for 3.14 yet, so pip install will fail." -ForegroundColor Yellow
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  1) Install Python 3.12 from https://www.python.org/downloads/ then run: py -3.12 -m venv .venv312; .\.venv312\Scripts\pip install -r requirements.txt; .\.venv312\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000"
    Write-Host "  2) Run the backend without the ML service (it will use built-in fallback logic)."
    Write-Host ""
    exit 1
}
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
