# --- CONFIGURATION ---
$projectPath = "C:\Users\clayt\PycharmProjects\MiniGameV3"
$renderServiceId = "srv-d6kv2u5m5p6s7389veag"
$renderApiKey = "rnd_h5AV4uaXG6HYErpoqf0y5fbVQQIU"

# --- SCRIPT ---
Set-Location $projectPath

# Vérifie s'il y a des modifications
$changes = git status --porcelain

if ($changes) {
    Write-Host "Modifications détectées, push en cours..."

    git add .
    git commit -m "Auto update"

    Write-Host "Push vers GitHub..."
    git push origin main

    Write-Host "Déclenchement du redeploy Render..."

    $headers = @{
        "Authorization" = "Bearer $renderApiKey"
    }

    Invoke-RestMethod `
        -Method POST `
        -Uri "https://api.render.com/v1/services/$renderServiceId/deploys" `
        -Headers $headers `
        -ContentType "application/json"

    Write-Host "Redeploy lancé !"
}
else {
    Write-Host "Aucun changement détecté."
}