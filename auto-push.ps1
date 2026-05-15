#Cmd : powershell -ExecutionPolicy Bypass -File .\auto-push.ps1

# --- CONFIGURATION ---
$projectPath = "C:\Users\clayt\PycharmProjects\MiniGameV2"
$renderServiceId = "srv-d6kv2u5m5p6s7389veag"
$renderApiKey = "rnd_h5AV4uaXG6HYErpoqf0y5fbVQQIU"

# --- SCRIPT ---
Write-Host "📁 Passage dans le dossier MiniGameV2..."
Set-Location $projectPath

# Vérifie que le dossier contient bien un repo Git
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERREUR : Ce dossier n'est pas un dépôt Git !"
    exit 1
}

# 🔥 Force un changement pour Render (hack propre)
Set-Content -Path "$projectPath\.render-restart" -Value (Get-Date).ToString()

# Vérifie s'il y a des modifications
$changes = git status --porcelain

if ($changes) {
    Write-Host "🟢 Modifications détectées → commit..."

    # IMPORTANT : n'ajoute QUE les fichiers suivis (respecte .gitignore)
    git add -u

    # Ajoute les nouveaux fichiers NON ignorés
    git add .

    git commit -m "Auto update MiniGameV2"
}

Write-Host "⬆️ Tentative de push normal..."
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Push normal impossible → tentative de force push..."
    git push origin main --force

    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Force push impossible. Intervention manuelle requise."
        exit 1
    }
}

Write-Host "🚀 Déclenchement du redeploy Render..."

$headers = @{
    "Authorization" = "Bearer $renderApiKey"
}

Invoke-RestMethod `
    -Method POST `
    -Uri "https://api.render.com/v1/services/$renderServiceId/deploys" `
    -Headers $headers `
    -ContentType "application/json"

Write-Host "🎉 Redeploy lancé sur Render !"