# Runs one tuning configuration over many hands, split across processes, and adds the counts up.
#
#   .\bench\run-tune.ps1 -Name base -Tune '{}' -Slices 6 -HandsPerSlice 350
#   .\bench\run-tune.ps1 -Name w10 -Tune '{"hardWeight":10}'
#
# Every slice plays different hands (BENCH_FROM), so the slices together are one big sample; the
# configurations all play the same hands, so they can be compared without luck of the draw.
# The result is printed and kept in $env:TEMP\okey-tune\<name>.txt.
param(
  [Parameter(Mandatory)][string]$Name,
  [string]$Tune = '{}',
  [int]$Slices = 6,
  [int]$HandsPerSlice = 350,
  [string]$Role = 'hard'
)

$dir = Join-Path $env:TEMP 'okey-tune'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$root = Split-Path -Parent $PSScriptRoot

$jobs = 0..($Slices - 1) | ForEach-Object {
  $slice = $_
  Start-Job -ArgumentList $root, $dir, $Name, $Tune, $slice, $HandsPerSlice, $Role -ScriptBlock {
    param($root, $dir, $name, $tune, $slice, $hands, $role)
    Set-Location $root
    $env:BENCH_HANDS = "$hands"
    $env:BENCH_FROM = "$($slice * $hands)"
    $env:BENCH_ROLE = $role
    $env:BENCH_TUNE = "[$tune]"
    npx vitest run --config vitest.bench.config.ts bench/tune.test.ts 2>&1 | Out-String
  }
}
$outputs = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job

$wins = 0; $finished = 0; $hands = 0; $discards = 0; $hardMs = 0; $hardCalls = 0
foreach ($o in $outputs) {
  foreach ($m in [regex]::Matches($o, 'RAW wins=(\d+) finished=(\d+) hands=(\d+) discards=(\d+) hardMs=(\d+) hardCalls=(\d+)')) {
    $wins += [int]$m.Groups[1].Value; $finished += [int]$m.Groups[2].Value
    $hands += [int]$m.Groups[3].Value; $discards += [int]$m.Groups[4].Value
    $hardMs += [int]$m.Groups[5].Value; $hardCalls += [int]$m.Groups[6].Value
  }
}
if ($hands -eq 0) { Write-Error "no results for $Name"; $outputs | Select-Object -First 3; exit 1 }
$share = $wins / [Math]::Max(1, $finished)
$err = 196 * [Math]::Sqrt($share * (1 - $share) / [Math]::Max(1, $finished))
$cost = if ($hardCalls -gt 0) { '{0:N1}' -f ($hardMs / $hardCalls) } else { '-' }
$line = "{0,-14} {1}: soloWins={2:N1}% +-{3:N1} finished={4:N0}% avgDiscards={5:N1} hardMs/decision={6} ({7} hands)" -f $Name, $Tune, ($share * 100), $err, (100 * $finished / $hands), ($discards / $hands), $cost, $hands
$line
$line | Set-Content (Join-Path $dir "$Name.txt")
