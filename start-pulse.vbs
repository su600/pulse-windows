' Starts Pulse without a console window.
' Rebuilds silently (in the background) only when the build is missing or older than the sources.
Option Explicit
Dim fso, sh, root, built, needBuild, exe, logPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
built = root & "\out\main\index.js"
exe = root & "\node_modules\electron\dist\electron.exe"
logPath = root & "\start-error.txt"

Function NewestIn(folder)
  Dim f, sub1, t, best
  best = CDate(0)
  For Each f In folder.Files
    If f.DateLastModified > best Then best = f.DateLastModified
  Next
  For Each sub1 In folder.SubFolders
    t = NewestIn(sub1)
    If t > best Then best = t
  Next
  NewestIn = best
End Function

If Not fso.FileExists(exe) Then
  ' Dependencies are missing: install them (visible once, can take a minute).
  sh.Run "cmd /c cd /d """ & root & """ && npm install > """ & logPath & """ 2>&1", 0, True
End If

needBuild = Not fso.FileExists(built)
If Not needBuild Then
  If NewestIn(fso.GetFolder(root & "\src")) > fso.GetFile(built).DateLastModified Then needBuild = True
  If fso.GetFile(root & "\package.json").DateLastModified > fso.GetFile(built).DateLastModified Then needBuild = True
End If
If needBuild Then
  sh.Run "cmd /c cd /d """ & root & """ && npx electron-vite build > """ & logPath & """ 2>&1", 0, True
End If

If Not fso.FileExists(built) Or Not fso.FileExists(exe) Then
  MsgBox "Pulse could not start." & vbCrLf & "Details: " & logPath, 16, "Pulse"
  WScript.Quit 1
End If
If fso.FileExists(logPath) Then fso.DeleteFile logPath

' 1 = normal window style; electron.exe is a GUI program, so no console appears.
sh.Run """" & exe & """ """ & root & """", 1, False
