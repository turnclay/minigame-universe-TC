# ============================================================
# update-agent-state.ps1
# Regenere PROJECT-STATE.md a chaque execution.
# A appeler depuis auto-push.ps1, AVANT le commit final, pour
# que PROJECT-STATE.md parte dans le meme push (cf GUIDE-MISE-EN-PLACE.md).
# Ne touche pas a arbo.txt (deja gere par le pipeline existant).
# ============================================================

param(
    [string]$RepoRoot = (Get-Location).Path
)

Set-Location $RepoRoot

$stateFile     = Join-Path $RepoRoot "PROJECT-STATE.md"
$wsHandlerPath = Join-Path $RepoRoot "server\ws-handler.js"

# ── 1. Commit courant ──────────────────────────────────────
$commitHash = (git rev-parse HEAD 2>$null)
$commitMsg  = (git log -1 --pretty=%B 2>$null)
if ($commitMsg) { $commitMsg = ($commitMsg -join " ").Trim() }
$now = Get-Date -Format "yyyy-MM-dd HH:mm"

# ── 2. Hash precedent (lu dans l'ancien PROJECT-STATE.md) ──
$previousHash = $null
if (Test-Path $stateFile) {
    $match = Select-String -Path $stateFile -Pattern 'Commit\s*:\s*([0-9a-f]{7,40})' -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($match) { $previousHash = $match.Matches[0].Groups[1].Value }
}

# ── 3. Diff depuis le hash precedent ───────────────────────
$diffLines = @()
if ($previousHash -and $commitHash -and ($previousHash -ne $commitHash)) {
    $diffLines = git diff --name-status $previousHash $commitHash 2>$null
} elseif (-not $previousHash) {
    $diffLines = git ls-files | ForEach-Object { "A`t$_" }
}

$MAX_LIGNES  = 40
$diffAffiche = $diffLines | Select-Object -First $MAX_LIGNES
$tronque     = $diffLines.Count -gt $MAX_LIGNES

# ── 4. Jeux enregistres (extraits de JEU_HANDLERS) ─────────
$jeux = @()
if (Test-Path $wsHandlerPath) {
    $content = Get-Content $wsHandlerPath -Raw
    if ($content -match '(?s)const\s+JEU_HANDLERS\s*=\s*\{(.*?)\n\};') {
        $bloc = $Matches[1]
        $jeux = [regex]::Matches($bloc, '(?m)^\s*(\w+)\s*:') |
                ForEach-Object { $_.Groups[1].Value } |
                Where-Object { $_ }
    }
}

# ── 5. Ecriture PROJECT-STATE.md ───────────────────────────
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("PROJECT-STATE.md (auto-genere par update-agent-state.ps1 - ne pas editer a la main)")
$lines.Add("")
$lines.Add("Derniere generation : $now")
$lines.Add("Commit               : $commitHash")
$lines.Add("Message              : $commitMsg")
$lines.Add("")
$lines.Add("JEUX ENREGISTRES DANS JEU_HANDLERS (server/ws-handler.js)")
if ($jeux.Count -eq 0) {
    $lines.Add("Extraction impossible - verifier manuellement server/ws-handler.js.")
} else {
    foreach ($j in $jeux) { $lines.Add("- $j") }
}
$lines.Add("")
$lines.Add("FICHIERS MODIFIES DEPUIS LE PUSH PRECEDENT")
if (-not $diffAffiche -or $diffAffiche.Count -eq 0) {
    $lines.Add("Aucun changement detecte (ou premiere generation).")
} else {
    foreach ($line in $diffAffiche) {
        $parts  = $line -split "`t"
        $status = $parts[0]
        $path   = $parts[-1]
        $label = switch -Regex ($status) {
            '^A' { 'Ajoute' }
            '^M' { 'Modifie' }
            '^D' { 'Supprime' }
            '^R' { 'Renomme' }
            default { $status }
        }
        $lines.Add("- [$label] $path")
    }
    if ($tronque) { $lines.Add("- ... liste tronquee, voir git log pour le detail complet") }
}
$lines.Add("")
$lines.Add("REFERENCES (ne pas dupliquer leur contenu ici)")
$lines.Add("- Dette technique    : DETTE-TECHNIQUE.md")
$lines.Add("- Conventions agents : CONVENTIONS.md")
$lines.Add("- Arborescence       : arbo.txt")
$lines.Add("")
$lines.Add("PROTOCOLE DE LECTURE (agents CLAUDE / JEUX / QA)")
$lines.Add("1. Lire ce fichier en premier, jamais tout le repo par defaut.")
$lines.Add("2. Se limiter aux fichiers listes ci-dessus + ceux vises par la demande.")
$lines.Add("3. Audit complet du repo uniquement si demande explicitement par Clayton.")

Set-Content -Path $stateFile -Value ($lines -join "`r`n") -Encoding UTF8

Write-Host "[STATE] PROJECT-STATE.md regenere (commit $commitHash)" -ForegroundColor Green