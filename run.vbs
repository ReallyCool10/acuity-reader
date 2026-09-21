' Launch Acuity Reader with no console window.
' Paths are derived from this script's own location so the repo can live anywhere.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron is not installed. Run 'npm install' in:" & vbCrLf & appDir, 16, "Acuity Reader"
  WScript.Quit 1
End If

shell.CurrentDirectory = appDir
shell.Run """" & electronExe & """ """ & appDir & """", 0, False
