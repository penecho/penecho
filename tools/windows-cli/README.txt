PenEcho CLI for Windows x64

Quick start (no installation, Node.js download or administrator required):
1. Extract the entire penecho-win.zip to Downloads or another short writable path.
   Open the extracted folder. Avoid deeply nested extraction folders.
2. Double-click penecho.cmd, or run .\penecho.cmd in a terminal.
3. Open http://localhost:3888 in your browser.
   If the port is occupied, run .\penecho.cmd --port 3999.
4. Use Ctrl+C in the terminal to stop PenEcho.

Optional installation:
Double-click install.cmd. It verifies the package, copies this build to
%LOCALAPPDATA%\PenEchoCLI\versions, and adds its dedicated bin folder to your
user PATH. No administrator permission or internet download is needed.
Open a new terminal and run penecho. If another installation takes precedence,
run %LOCALAPPDATA%\PenEchoCLI\bin\penecho.cmd explicitly.
Existing services, npm installations and user data are not replaced.

This bundle includes Node.js and production dependencies. Windows x64 only.
AI services still require your own connection/login and usually internet.
WorkBuddy history is read from this computer's own user profile; its app must
have conversations in a folder linked to the PenEcho project. Conversation
monitoring is supported; automatically running WorkBuddy is not provided.
No accounts, API keys, conversations or user configuration are bundled.

Portable means the software can be moved. User settings and documents remain
in the normal user profile (~/.penecho) and the project folders you select.
Built-in npm auto-update checks are disabled for this self-contained bundle;
install a newer bundle side by side to update it.

Licenses: app/LICENSE, app/NOTICE, runtime/LICENSE and the license files inside
app/node_modules. build.json records source/build provenance.
