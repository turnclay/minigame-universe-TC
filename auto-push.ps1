#Cmd : powershell -ExecutionPolicy Bypass -File .\auto-push.ps1
# ⚠️ Ne PAS double-cliquer ce fichier directement (Windows l'ouvre en texte).
# Double-clique plutôt sur auto-push.bat, qui lance ce script correctement.

# --- CONFIGURATION ---
$projectPath     = "C:\Users\clayt\PycharmProjects\MiniGameV2"
$renderServiceId = "srv-d6kv2u5m5p6s7389veag"
$renderApiKey    = "rnd_h5AV4uaXG6HYErpoqf0y5fbVQQIU"

# --- SCRIPT ---
Write-Host "📁 Passage dans le dossier MiniGameV2..."
Set-Location $projectPath

# Vérifie que le dossier contient bien un repo Git
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERREUR : Ce dossier n'est pas un dépôt Git !"
    Read-Host "Appuie sur Entrée pour fermer"
    exit 1
}

# --- GÉNÉRATION ARBO ASCII ---
Write-Host "📄 Génération de arbo.txt (ASCII, exclusions node_modules/.git/.venv)..."

$output   = Join-Path $projectPath 'arbo.txt'
$tmp      = [IO.Path]::GetTempFileName()
$excludes = @('.git', 'node_modules', '.venv')

function Get-Tree {
    param($Path, $Prefix = '')

    $items = Get-ChildItem -LiteralPath $Path -Force |
        Where-Object { $excludes -notcontains $_.Name } |
        Sort-Object { -not $_.PSIsContainer }, Name

    $count = $items.Count

    for ($i = 0; $i -lt $count; $i++) {
        $item   = $items[$i]
        $isLast = ($i -eq $count - 1)

        # PowerShell n'accepte pas if() dans une expression → on calcule AVANT
        if ($isLast) {
            $connector = '└── '
            $childPrefix = $Prefix + '    '
        }
        else {
            $connector = '├── '
            $childPrefix = $Prefix + '│   '
        }

        "$Prefix$connector$($item.Name)" | Out-File -FilePath $tmp -Append -Encoding utf8

        if ($item.PSIsContainer) {
            Get-Tree -Path $item.FullName -Prefix $childPrefix
        }
    }
}

# Header
$repoName = Split-Path $projectPath -Leaf
"$repoName" | Out-File -FilePath $tmp -Encoding utf8

# Build tree
Get-Tree -Path $projectPath -Prefix ''

# --- COMPARE & CRÉE / MET À JOUR arbo.txt ---
$fichierExistait = Test-Path $output

$new = (Get-Content $tmp -Raw) -replace "`r`n", "`n"
$old = if ($fichierExistait) { (Get-Content $output -Raw) -replace "`r`n", "`n" } else { $null }

if (-not $fichierExistait -or $new -ne $old) {
    Move-Item -Force $tmp $output
    if ($fichierExistait) {
        Write-Host "🟢 arbo.txt mis à jour."
    } else {
        Write-Host "🟢 arbo.txt créé (il n'existait pas)."
    }
    $arboChanged = $true
}
else {
    Remove-Item $tmp -Force
    Write-Host "⚪ Aucun changement dans arbo.txt."
    $arboChanged = $false
}

# 🔥 Force un changement pour Render (hack propre)
Set-Content -Path (Join-Path $projectPath '.render-restart') -Value (Get-Date).ToString()

# Vérifie s'il y a des modifications
$changes = git status --porcelain

if ($changes -or $arboChanged) {
    Write-Host "🟢 Modifications détectées → commit..."
    git add -u
    git add .
    git commit -m "Auto update MiniGameV2"
}
else {
    Write-Host "⚪ Aucune modification à committer."
}

Write-Host "⬆️ Tentative de push normal..."
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Push normal impossible → tentative de force push..."
    git push origin main --force

    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Force push impossible. Intervention manuelle requise."
        Read-Host "Appuie sur Entrée pour fermer"
        exit 1
    }
}

Write-Host "🚀 Déclenchement du redeploy Render..."

$headers = @{ "Authorization" = "Bearer $renderApiKey" }

try {
    Invoke-RestMethod -Method POST `
        -Uri "https://api.render.com/v1/services/$renderServiceId/deploys" `
        -Headers $headers `
        -ContentType "application/json" | Out-Null
    Write-Host "🎉 Redeploy lancé sur Render !"
}
catch {
    Write-Host "❌ Échec du déclenchement Render : $($_.Exception.Message)"
}

Read-Host "Terminé — appuie sur Entrée pour fermer"
