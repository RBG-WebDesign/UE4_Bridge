#requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Project,

    [string]$BridgeRoot,

    [switch]$SkipBuild,

    [switch]$SkipPython,

    [switch]$SkipCppPlugin,

    [switch]$SkipMcpConfig,

    [switch]$IncludeUnrealApi,

    [string]$UnrealVersion = "4.27",

    [switch]$CleanManaged
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ExistingPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    try {
        return (Resolve-Path -LiteralPath $Path).Path
    }
    catch {
        throw "$Label does not exist: $Path"
    }
}

function Get-RepoRoot {
    if ($BridgeRoot) {
        return Resolve-ExistingPath -Path $BridgeRoot -Label "Bridge root"
    }

    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function Get-ProjectRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectPath
    )

    $resolved = Resolve-ExistingPath -Path $ProjectPath -Label "Project path"
    $item = Get-Item -LiteralPath $resolved

    if (-not $item.PSIsContainer) {
        if ($item.Extension -ne ".uproject") {
            throw "Project file must be a .uproject file: $resolved"
        }

        return [PSCustomObject]@{
            Root = $item.Directory.FullName
            UProject = $item.FullName
        }
    }

    $uprojectFiles = @(Get-ChildItem -LiteralPath $item.FullName -Filter "*.uproject" -File)
    if ($uprojectFiles.Count -gt 1) {
        $names = ($uprojectFiles | ForEach-Object { $_.Name }) -join ", "
        throw "Project directory contains multiple .uproject files. Pass one explicitly: $names"
    }

    return [PSCustomObject]@{
        Root = $item.FullName
        UProject = if ($uprojectFiles.Count -eq 1) { $uprojectFiles[0].FullName } else { $null }
    }
}

function ConvertTo-JsonPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace("\", "/")
}

function Assert-BridgeLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $requiredPaths = @(
        "package.json",
        "mcp-server/package.json",
        "unreal-plugin/Content/Python/startup.py",
        "unreal-plugin/Content/Python/mcp_bridge",
        "ue4-plugin/BlueprintGraphBuilder/BlueprintGraphBuilder.uplugin"
    )

    foreach ($relativePath in $requiredPaths) {
        $candidate = Join-Path $Root $relativePath
        if (-not (Test-Path -LiteralPath $candidate)) {
            throw "Bridge root is missing required path: $candidate"
        }
    }
}

function Invoke-BridgeBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if ($SkipBuild) {
        Write-Host "Skipping MCP server build."
        return
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm was not found on PATH. Install Node.js 18 or newer, or rerun with -SkipBuild after building manually."
    }

    Push-Location -LiteralPath $Root
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
            if ($PSCmdlet.ShouldProcess($Root, "npm install")) {
                & npm install
            }
        }

        if ($PSCmdlet.ShouldProcess($Root, "npm run build")) {
            & npm run build
        }
    }
    finally {
        Pop-Location
    }
}

function Copy-ManagedDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Source directory does not exist: $Source"
    }

    if ($CleanManaged -and (Test-Path -LiteralPath $Destination)) {
        if ($PSCmdlet.ShouldProcess($Destination, "remove existing managed $Name")) {
            Remove-Item -LiteralPath $Destination -Recurse -Force
        }
    }

    if (-not (Test-Path -LiteralPath $Destination)) {
        if ($PSCmdlet.ShouldProcess($Destination, "create $Name directory")) {
            New-Item -ItemType Directory -Path $Destination | Out-Null
        }
    }

    if ($PSCmdlet.ShouldProcess($Destination, "copy $Name files")) {
        Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
    }
}

function Copy-ManagedFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        if ($PSCmdlet.ShouldProcess($parent, "create directory for $Name")) {
            New-Item -ItemType Directory -Path $parent | Out-Null
        }
    }

    if ($CleanManaged -and (Test-Path -LiteralPath $Destination)) {
        if ($PSCmdlet.ShouldProcess($Destination, "remove existing managed $Name")) {
            Remove-Item -LiteralPath $Destination -Force
        }
    }

    if ($PSCmdlet.ShouldProcess($Destination, "copy $Name")) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Install-PythonListener {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    if ($SkipPython) {
        Write-Host "Skipping Python listener install."
        return
    }

    $source = Join-Path $Root "unreal-plugin/Content/Python"
    $destination = Join-Path $ProjectRoot "Content/Python"
    Copy-ManagedDirectory -Source $source -Destination $destination -Name "Python listener"
}

function Install-BlueprintGraphBuilder {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    if ($SkipCppPlugin) {
        Write-Host "Skipping BlueprintGraphBuilder plugin install."
        return
    }

    $source = Join-Path $Root "ue4-plugin/BlueprintGraphBuilder"
    $destination = Join-Path $ProjectRoot "Plugins/BlueprintGraphBuilder"
    Copy-ManagedDirectory -Source $source -Destination $destination -Name "BlueprintGraphBuilder plugin"
}

function Update-DefaultEngineIni {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    if ($SkipPython) {
        Write-Host "Skipping DefaultEngine.ini update because -SkipPython was used."
        return
    }

    $configDir = Join-Path $ProjectRoot "Config"
    $iniPath = Join-Path $configDir "DefaultEngine.ini"
    $sectionName = "[/Script/PythonScriptPlugin.PythonScriptPluginSettings]"
    $requiredLines = @(
        "bDeveloperMode=True",
        "bRemoteExecution=True",
        "+StartupScripts=/Game/Python/startup.py",
        "+AdditionalPaths=(Path=`"/Game/Python`")"
    )

    if (-not (Test-Path -LiteralPath $configDir)) {
        if ($PSCmdlet.ShouldProcess($configDir, "create Config directory")) {
            New-Item -ItemType Directory -Path $configDir | Out-Null
        }
    }

    $lines = @()
    if (Test-Path -LiteralPath $iniPath) {
        $lines = @(Get-Content -LiteralPath $iniPath)
    }

    $sectionStart = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq $sectionName) {
            $sectionStart = $i
            break
        }
    }

    if ($sectionStart -lt 0) {
        $newLines = @()
        if ($lines.Count -gt 0) {
            $newLines += $lines
            if ($lines[-1].Trim() -ne "") {
                $newLines += ""
            }
        }

        $newLines += $sectionName
        $newLines += $requiredLines
    }
    else {
        $sectionEnd = $lines.Count
        for ($i = $sectionStart + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match "^\s*\[.+\]\s*$") {
                $sectionEnd = $i
                break
            }
        }

        $before = if ($sectionStart -gt 0) { $lines[0..($sectionStart - 1)] } else { @() }
        $section = if ($sectionEnd -gt $sectionStart) { $lines[$sectionStart..($sectionEnd - 1)] } else { @($sectionName) }
        $after = if ($sectionEnd -lt $lines.Count) { $lines[$sectionEnd..($lines.Count - 1)] } else { @() }

        $filteredSection = @($section[0])
        if ($section.Count -gt 1) {
            foreach ($line in $section[1..($section.Count - 1)]) {
                if ($line -match "^\s*bDeveloperMode\s*=") { continue }
                if ($line -match "^\s*bRemoteExecution\s*=") { continue }
                if ($line -match "^\s*\+?StartupScripts\s*=\s*/Game/Python/startup\.py\s*$") { continue }
                if ($line -match "^\s*\+?AdditionalPaths\s*=\s*\(Path=`"/Game/Python`"\)\s*$") { continue }
                $filteredSection += $line
            }
        }

        $newLines = @()
        $newLines += $before
        $newLines += $filteredSection
        $newLines += $requiredLines
        $newLines += $after
    }

    if ($PSCmdlet.ShouldProcess($iniPath, "update Python startup settings")) {
        Set-Content -LiteralPath $iniPath -Value $newLines -Encoding UTF8
    }
}

function Update-McpConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    if ($SkipMcpConfig) {
        Write-Host "Skipping .mcp.json update."
        return
    }

    $mcpPath = Join-Path $ProjectRoot ".mcp.json"
    $serverEntry = [PSCustomObject]@{
        command = "node"
        args = @((ConvertTo-JsonPath -Path (Join-Path $Root "mcp-server/dist/index.js")))
        cwd = ConvertTo-JsonPath -Path $Root
    }

    if (Test-Path -LiteralPath $mcpPath) {
        try {
            $config = Get-Content -LiteralPath $mcpPath -Raw | ConvertFrom-Json
        }
        catch {
            $backupPath = "$mcpPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
            if ($PSCmdlet.ShouldProcess($mcpPath, "backup invalid MCP config to $backupPath")) {
                Copy-Item -LiteralPath $mcpPath -Destination $backupPath -Force
            }
            $config = [PSCustomObject]@{}
        }
    }
    else {
        $config = [PSCustomObject]@{}
    }

    $propertyNames = @($config.PSObject.Properties | ForEach-Object { $_.Name })
    if (-not ($propertyNames -contains "mcpServers")) {
        $config | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value ([PSCustomObject]@{})
    }

    $config.mcpServers | Add-Member -MemberType NoteProperty -Name "unreal-bridge" -Value $serverEntry -Force

    if ($IncludeUnrealApi) {
        $unrealApiEntry = [PSCustomObject]@{
            command = "uvx"
            args = @("unreal-api-mcp")
            env = [PSCustomObject]@{
                UNREAL_VERSION = $UnrealVersion
            }
        }
        $config.mcpServers | Add-Member -MemberType NoteProperty -Name "unreal-api" -Value $unrealApiEntry -Force
    }

    $json = $config | ConvertTo-Json -Depth 12
    if ($PSCmdlet.ShouldProcess($mcpPath, "write MCP config")) {
        Set-Content -LiteralPath $mcpPath -Value $json -Encoding UTF8
    }
}

$repoRoot = Get-RepoRoot
Assert-BridgeLayout -Root $repoRoot

$projectInfo = Get-ProjectRoot -ProjectPath $Project
$projectRoot = $projectInfo.Root

Write-Host "MCP Bridge root: $repoRoot"
Write-Host "Target project:  $projectRoot"
if ($projectInfo.UProject) {
    Write-Host "UProject file:   $($projectInfo.UProject)"
}
else {
    Write-Host "UProject file:   not found in target directory"
}

Invoke-BridgeBuild -Root $repoRoot
Install-PythonListener -Root $repoRoot -ProjectRoot $projectRoot
Install-BlueprintGraphBuilder -Root $repoRoot -ProjectRoot $projectRoot
Update-DefaultEngineIni -ProjectRoot $projectRoot
Update-McpConfig -Root $repoRoot -ProjectRoot $projectRoot

Write-Host ""
Write-Host "MCP Bridge install complete."
Write-Host "Next steps:"
Write-Host "1. Enable the Python Editor Script Plugin in UE4 if it is not already enabled."
Write-Host "2. Restart the Unreal editor so Content/Python/startup.py can start the listener."
Write-Host "3. If BlueprintGraphBuilder was installed, accept the UE4 rebuild prompt."
