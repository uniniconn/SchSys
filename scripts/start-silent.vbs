' ============================================================================
'  Scheduling System - silent background start (no console window)
'  Called by the desktop shortcut. Log: <project>\.run\logs\server.out.log
' ============================================================================
Option Explicit
Dim shell, fso, projectDir, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' this script lives in <project>\scripts\, so the project root is one level up
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = projectDir & "\scripts\launcher.mjs"

If Not fso.FileExists(launcher) Then
  MsgBox "Launcher not found: " & launcher & vbCrLf & "Please make sure the project folder is complete.", 16, "Scheduling System"
  WScript.Quit 1
End If

command = "node """ & launcher & """ start --background --open /admin/login"
' 0 = hidden window
shell.Run command, 0, False
