' ============================================================================
'  Scheduling System - silent stop
' ============================================================================
Option Explicit
Dim shell, fso, projectDir, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = projectDir & "\scripts\launcher.mjs"

If Not fso.FileExists(launcher) Then
  MsgBox "Launcher not found: " & launcher, 16, "Scheduling System"
  WScript.Quit 1
End If

command = "node """ & launcher & """ stop"
shell.Run command, 0, True
