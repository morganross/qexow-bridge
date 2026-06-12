[Setup]
AppName=Qexow Bridge
AppVersion=1.7.1
DefaultDirName={pf}\Qexow Bridge
DefaultGroupName=Qexow Bridge
OutputDir=dist
OutputBaseFilename=QexowBridgeSetup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=compiler:SetupClassicIcon.ico
CloseApplications=no


[Files]
Source: "dist\qexow-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "Send-AgentMessage.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "cam_integration_instructions.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Qexow Bridge"; Filename: "{app}\qexow-bridge.exe"
Name: "{group}\Uninstall Qexow Bridge"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Qexow Bridge"; ValueData: "{app}\qexow-bridge.exe"

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM qexow-bridge.exe"; Flags: runhidden; RunOnceId: "KillBridge"
Filename: "taskkill"; Parameters: "/F /IM bridge-core.exe"; Flags: runhidden; RunOnceId: "KillBridgeCore"

[Run]
Filename: "{app}\qexow-bridge.exe"; Description: "Launch Qexow Bridge Application"; Flags: postinstall nowait

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Force kill any running instances to free file locks
  Exec('taskkill.exe', '/F /IM qexow-bridge.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill.exe', '/F /IM bridge-core.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  
  Result := True;
end;
