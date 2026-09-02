$ErrorActionPreference='Stop'
$root='E:\DemoStudio\doc'
Get-ChildItem $root -Recurse -Filter *.md | Sort-Object { $_.FullName } | ForEach-Object {
  $lines=[IO.File]::ReadAllLines($_.FullName)
  $rel=$_.FullName.Substring($root.Length+1).Replace('\','/')
  $heads=@()
  foreach($l in $lines){
    if($l -match '^(#{2,3})\s+(.+)$'){
      $lv=$Matches[1].Length
      $t=$Matches[2].Trim()
      if($lv -le 3){ $heads += ('  ' * ($lv-2)) + $t }
    }
  }
  [PSCustomObject]@{
    file=$rel
    lines=$lines.Count
    kb=[Math]::Round($_.Length/1KB,1)
    h2=($lines | Where-Object { $_ -match '^##\s+' }).Count
    heads=($heads -join ' | ')
  }
} | Format-Table -AutoSize -Wrap | Out-String -Width 200
