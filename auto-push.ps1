# --- CONFIGURATION ---
$projectPath = "C:\Users\clayt\PycharmProjects\MiniGameV3"
$renderServiceId = "A REMPLIR"
$renderApiKey = "A REMPLIR"

# --- SCRIPT ---
Set-Location $projectPath

# Vérifie s'il y a des modifications
$changes = git status --porcelain

if ($changes) {
    Write-Host "🔄 Modifications détectées, push en cours..."

    git add .
    git commit -m "Auto update"
    git push

    Write-Host "📤 Push effectué."

    # Redeploy Render
    Write-Host "🚀 Déclenchement du redeploy Render..."

    $headers = @{
        "Authorization" = "Bearer $renderApiKey"
    }

    $body = @{
        "clearCache" = $true
    } | ConvertTo-Json

    Invoke-RestMethod `
        -Method POST `
        -Uri "https://api.render.com/v1/services/$renderServiceId/deploys" `
        -Headers $headers `
        -Body $body `
        -ContentType "application/json"

    Write-Host "🎉 Redeploy lancé !"
}
else {
    Write-Host "✔️ Aucun changement détecté."
}