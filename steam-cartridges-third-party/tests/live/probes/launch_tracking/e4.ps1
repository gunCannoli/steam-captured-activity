# E4 from the shell (outside Steam): can a packaged exe be created as our own child?
$lt = $PSScriptRoot
$p = Join-Path $lt "ltprobe.exe"
$ms = "C:\Program Files\WindowsApps\Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe"
$msFull = "Microsoft.MicrosoftMinesweeper_4.7.9021.0_x64__8wekyb3d8bbwe"
$fm = "C:\Program Files\WindowsApps\QubicGames.FortressMerge_1.0.11.0_x64__e3x7kyz1wvfw4"
$fmFull = "QubicGames.FortressMerge_1.0.11.0_x64__e3x7kyz1wvfw4"
function EndGames { foreach ($n in @("Minesweeper", "Fortress Merge", "GameLaunchHelper")) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force } } }
function Go([string[]]$a) { $pr = Start-Process -FilePath $p -ArgumentList $a -PassThru; $null = $pr.WaitForExit(40000); EndGames; Start-Sleep 1 }
$q = [char]34
Go @("pkg", "--exe", "$q$ms\Minesweeper.exe$q", "--hold", "3")
Go @("pkg", "--full", $msFull, "--exe", "$q$ms\Minesweeper.exe$q", "--hold", "3")
Go @("pkg", "--full", $msFull, "--appcontainer", "microsoft.microsoftminesweeper_8wekyb3d8bbwe", "--exe", "$q$ms\Minesweeper.exe$q", "--hold", "3")
Go @("pkg", "--full", $msFull, "--appcontainer", "microsoft.microsoftminesweeper_8wekyb3d8bbwe", "--exe", "$q$ms\Minesweeper.exe$q", "--args", "-ServerName:App.AppXs0wy29ty2qx433yrp9k4y8r5pt0vdmhe.mca", "--activate", "Microsoft.MicrosoftMinesweeper_8wekyb3d8bbwe!App", "--hold", "5")
Go @("pkg", "--exe", "$q$fm\GameLaunchHelper.exe$q", "--hold", "5")
Go @("pkg", "--full", $fmFull, "--exe", "$q$fm\GameLaunchHelper.exe$q", "--hold", "8")
Go @("pkg", "--full", $fmFull, "--exe", "$q$fm\Fortress Merge.exe$q", "--hold", "8")
Get-Content (Join-Path $lt "ltprobe.log")
