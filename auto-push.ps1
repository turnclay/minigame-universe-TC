# --- CONFIGURATION ---
$projectPath = "C:\Users\clayt\PycharmProjects\MiniGameV2"   # 🔥 Dossier de ta V2
$renderServiceId = "srv-d6kv2u5m5p6s7389veag"                # 🔥 ID de ton service Render (V3 à remplacer)
$renderApiKey = "rnd_h5AV4uaXG6HYErpoqf0y5fbVQQIU"           # 🔥 Clé API Render

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
    Write-Host "🟢 Modifications détectées, push en cours..."

    git add .
    git commit -m "Auto update MiniGameV2"

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
    Write-Host "⚪ Aucun changement détecté. Rien à push."
}
