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

# Project-local dirs for openclaude (community)
New-Item -ItemType Directory -Force -Path "$ProjectRoot\.nstack\openclaude" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectRoot\.nstack\memory" | Out-Null

# Default OpenClaude config dir
$env:OPENCLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\openclaude"
# Also set CLAUDE_CONFIG_DIR for compatibility
$env:CLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\openclaude"

# Check nstack config for project-home mode
if (Test-Path $ConfigPath) {
    try {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($config.projectHome -eq $true) {
            $env:OPENCLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\openclaude"
            $env:CLAUDE_CONFIG_DIR = "$ProjectRoot\.nstack\openclaude"
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
            if ($name -eq "OPENCLAUDE_CONFIG_DIR" -and -not [System.IO.Path]::IsPathRooted($value)) {
                $value = Join-Path $ProjectRoot $value
            }

            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Force openclaude to run from repo root
Push-Location $ProjectRoot
try {
    openclaude @args
} finally {
    Pop-Location
}
