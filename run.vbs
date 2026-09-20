Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\MarkNewman\acuity-reader"
WshShell.Run """C:\Users\MarkNewman\acuity-reader\node_modules\electron\dist\electron.exe"" ""C:\Users\MarkNewman\acuity-reader""", 0, False
