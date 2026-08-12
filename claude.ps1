# Start from the folder where user ran the command
$StartDir = (Get-Location).Path

# Find Git root from current folder
$ProjectRoot = git -C $StartDir rev-parse --show-toplevel 2>$null

# Fallback if not inside a Git repo
if (-not $ProjectRoot) {
    $ProjectRoot = $StartDir
}

$EnvPath = Join-Path $ProjectRoot ".env"
$ConfigPath = Join-Path $ProjectRoot ".nstack\config.json"

# Create project-local dirs for claude (official Anthropic)
New-Item -ItemType Directory -Force -Path "$ProjectRoot\.nstack\claude" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectRoot\.nstack\memory" | Out-Null

# Default Claude config dir, even if .env is missing
$env:CLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\claude"

# Check nstack config for project-home mode
if (Test-Path $ConfigPath) {
    try {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($config.projectHome -eq $true) {
            $env:CLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\claude"
        }
    } catch {}
}

# Load .env from project root
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")

            if ($name -eq "CLAUDE_CONFIG_DIR" -and -not [System.IO.Path]::IsPathRooted($value)) {
                $value = Join-Path $ProjectRoot $value
            }

            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Force claude to run from repo root
Push-Location $ProjectRoot
try {
    claude @args
} finally {
    Pop-Location
}
