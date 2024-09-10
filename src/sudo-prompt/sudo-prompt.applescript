set appletPath to POSIX path of (path to me)
if appletPath ends with ".app/" then
	set appletPath to appletPath & "Contents/Resources/Scripts"
else
	set appletPath to do shell script "dirname " & quoted form of appletPath
end if
set promptScript to appletPath & "/sudo-prompt-script"
do shell script (quoted form of promptScript) with administrator privileges
