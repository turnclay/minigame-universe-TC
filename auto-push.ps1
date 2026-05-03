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

# Vérifie si la branche locale est en avance sur origin/main
$aheadInfo = git rev-list --left-right --count origin/main...main 2>$null
$ahead = 0
if ($aheadInfo) {
    $ahead = [int]($aheadInfo.Split()[1])
}

if ($changes -or $ahead -gt 0) {
    Write-Host "🟢 Push nécessaire (modifications ou commits en avance)."

    git add .
    git commit -m "Auto update MiniGameV2" 2>$null

    Write-Host "⬆️ Push vers GitHub..."
    git push origin main

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
}
else {
    Write-Host "⚪ Aucun changement et aucun commit en avance. Rien à push."
}
