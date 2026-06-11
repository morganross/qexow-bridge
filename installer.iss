[Setup]
AppName=Codex Antigravity Bridge
AppVersion=1.0.0
DefaultDirName={pf}\Codex Antigravity Bridge
DefaultGroupName=Codex Antigravity Bridge
OutputDir=dist
OutputBaseFilename=CodexAntigravityBridgeSetup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=compiler:SetupClassicIcon.ico

[Files]
Source: "dist\codex-antigravity-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\bridge-tray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "Send-AgentMessage.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "cam_integration_instructions.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Codex Antigravity Bridge Tray"; Filename: "{app}\bridge-tray.exe"
Name: "{group}\Uninstall Codex Antigravity Bridge"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Codex Antigravity Bridge Tray"; ValueData: "{app}\bridge-tray.exe"

[Run]
Filename: "{app}\bridge-tray.exe"; Description: "Launch Bridge System Tray Icon"; Flags: postinstall nowait
