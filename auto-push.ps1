# --- CONFIGURATION ---
$projectPath = "C:\Users\clayt\minigame-universe-TC"   # 🔥 Le bon dossier GitHub
$renderServiceId = "srv-d6kv2u5m5p6s7389veag"
$renderApiKey = "rnd_h5AV4uaXG6HYErpoqf0y5fbVQQIU"

# --- SCRIPT ---
Write-Host "📁 Passage dans le dossier du projet GitHub..."
Set-Location $projectPath

# Vérifie que le dossier contient bien un repo Git
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERREUR : Ce dossier n'est pas un dépôt Git !"
    exit 1
}

# 🔥 Force un changement pour Render
Set-Content -Path "$projectPath\.render-restart" -Value (Get-Date).ToString()

# Vérifie s'il y a des modifications
$changes = git status --porcelain

if ($changes) {
    Write-Host "🟢 Modifications détectées, push en cours..."

    git add .
    git commit -m "Auto update"

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

    Write-Host "🎉 Redeploy lancé !"
}
else {
    Write-Host "⚪ Aucun changement détecté. Rien à push."
}