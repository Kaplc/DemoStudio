#
# splash.ps1 - DemoStudio 独立开屏窗口（PowerShell + WPF，Win10/11 自带，零依赖）
#
# 由 editor.bat 在启动瞬间拉起（start /b，不阻塞控制台），轮询 -StateFile 指向的
# JSON 状态文件刷新进度条。写入方：
#   - bat 阶段:  node scripts/splash-update.mjs <pct> "<status>"
#   - Electron:  electron/main.ts 的 writeSplashState() 接力同一文件
# 关闭（多重保险，任一满足）：
#   1. done:true → 进程级瞬间退出（Environment.Exit，不做淡出动画）
#   2. Electron 主进程 app-ready 后直接 Stop-Process 本进程（读 <StateFile>.pid）
#   3. 父进程（bat 控制台）退出 → 立即关闭（启动链断裂兜底）
#   4. 用户右键点击开屏窗口
#
param([string]$StateFile)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml

# ─── 父进程探测：start /b 拉起本窗口的 cmd 即 editor.bat 控制台 ───
$script:parentPid = 0
try {
  $me = Get-CimInstance -Class Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
  if ($me) { $script:parentPid = [int]$me.ParentProcessId }
} catch { }

function Test-ParentAlive {
  if ($script:parentPid -le 0) { return $true }
  $p = Get-Process -Id $script:parentPid -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# ─── PID 登记：供 Electron 主进程 app-ready 后直接停止本进程（用户要求的确定性关闭） ───
try {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StateFile) | Out-Null
  Set-Content -LiteralPath ($StateFile + '.pid') -Value $PID -ErrorAction Stop
} catch { }

# ─── 状态（跨 DispatcherTick 共享） ───
$script:shown       = 0.0     # 当前显示进度（向 target 缓动）
$script:target      = 0.0     # 最近一次真实里程碑进度（只增不减）
$script:statusText  = '正在启动'
$script:done        = $false
$script:tickCount   = 0

# ─── 界面（与 electron/loading.html 同风格） ───
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="DemoStudio" Width="480" Height="320"
        WindowStyle="None" ResizeMode="NoResize" Topmost="True"
        ShowInTaskbar="False" WindowStartupLocation="CenterScreen"
        Background="#FF1A1A2E">
  <Grid>
    <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">
      <TextBlock Text="DemoStudio" FontSize="28" FontWeight="Bold"
                 Foreground="#FFE0E0E0" HorizontalAlignment="Center" />
      <TextBlock Text="E D I T O R   V 4 . 0 . 0" FontSize="12"
                 Foreground="#FF888888" HorizontalAlignment="Center" Margin="0,6,0,48" />
      <Grid Width="220" Height="3" Background="#FF2A2A4A" HorizontalAlignment="Center" Margin="0,0,0,20">
        <Rectangle x:Name="Bar" HorizontalAlignment="Left" Width="0" Height="3" RadiusX="1.5" RadiusY="1.5">
          <Rectangle.Fill>
            <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
              <GradientStop Color="#FF4A90D9" Offset="0" />
              <GradientStop Color="#FF64B4FF" Offset="1" />
            </LinearGradientBrush>
          </Rectangle.Fill>
        </Rectangle>
      </Grid>
      <TextBlock x:Name="Status" Text="正在启动" FontSize="12" Foreground="#FFAAAAAA"
                 FontFamily="Consolas" HorizontalAlignment="Center" />
    </StackPanel>
  </Grid>
</Window>
'@

$window = [System.Windows.Markup.XamlReader]::Parse($xaml)
$bar    = $window.FindName('Bar')
$status = $window.FindName('Status')

# 状态文字呼吸动画：长步骤（DSH 构建）进度条静止时窗口仍有"活着"的反馈
$pulse = New-Object System.Windows.Media.Animation.DoubleAnimation
$pulse.From           = 1.0
$pulse.To             = 0.35
$pulse.Duration       = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(1200))
$pulse.AutoReverse    = $true
$pulse.RepeatBehavior = 'Forever'
$status.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $pulse)

# 拖动窗口 / 右键关闭
$window.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch { } })
$window.Add_MouseRightButtonDown({ $window.Close() })

# ─── 轮询状态文件（80ms；写入方用 tmp+rename 原子替换，读取竞态由 try/catch 吸收） ───
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(80)

$timer.Add_Tick({
  $script:tickCount++

  if (-not $script:done) {
    try {
      if (Test-Path -LiteralPath $StateFile) {
        $raw = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8)
        $o = $raw | ConvertFrom-Json
        if ($null -ne $o) {
          if ([double]$o.pct -gt $script:target) { $script:target = [double]$o.pct }
          if ($o.status) { $script:statusText = [string]$o.status }
          if ($o.done) {
            # 编辑器就绪：瞬间关闭 —— 清理文件后进程级强杀自退。
            # 注意：Exit(0)/Close() 在 Dispatcher 回调里可能 CLR 卸载挂死导致窗口滞留，
            # Stop-Process（TerminateProcess）是唯一确定性的自退方式。
            $script:done = $true
            try { $timer.Stop() } catch { }
            try { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue } catch { }
            try { Remove-Item -LiteralPath ($StateFile + '.pid') -Force -ErrorAction SilentlyContinue } catch { }
            Stop-Process -Id $PID -Force -ErrorAction SilentlyContinue
            [Environment]::Exit(0)
          }
        }
      }
    } catch { }

    # 父进程（bat 控制台）退出且未收到 done → 启动链已断，立即关闭
    if ((($script:tickCount % 25) -eq 0) -and (-not (Test-ParentAlive))) {
      $window.Close()
      return
    }
  }

  # 进度缓动：只向真实里程碑靠近，不回退、不超过
  $script:shown += ($script:target - $script:shown) * 0.14
  if ([Math]::Abs($script:target - $script:shown) -lt 0.2) { $script:shown = $script:target }
  $bar.Width = 220.0 * $script:shown / 100.0

  if ($status.Text -ne $script:statusText) { $status.Text = $script:statusText }
})

$window.Add_Closing({
  $timer.Stop()
  try { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue } catch { }
  try { Remove-Item -LiteralPath ($StateFile + '.pid') -Force -ErrorAction SilentlyContinue } catch { }
})

$timer.Start()
[void]$window.ShowDialog()
