const { app, BrowserWindow, Tray, Menu, Notification, dialog, ipcMain, desktopCapturer } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let tray = null;
let serverProcess = null;

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Uyarı', message: 'Uygulama zaten çalışıyor.' });
        }
    });

    app.whenReady().then(() => {
        startServer();
        createWindow();
        createTray();

        // CHECK FOR UPDATES
        autoUpdater.checkForUpdatesAndNotify();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}
// --- AUTO UPDATER EVENTS ---
autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update_available');
});
autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update_downloaded');
});
ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});

function startServer() {
    const serverPath = path.join(__dirname, 'server.js');
    console.log("Starting server from:", serverPath);
    serverProcess = fork(serverPath, [], { silent: true });
    serverProcess.stdout.on('data', (data) => {
        console.log(`[Server]: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`[Server Error]: ${data}`);
    });

    serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        icon: path.join(__dirname, 'public/icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            sandbox: false
        }
    });

    // Load local file with absolute path
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    // Minimize to Tray Logic
    mainWindow.on('minimize', function (event) {
        event.preventDefault();
        mainWindow.hide();
        // Notification
        new Notification({
            title: 'Sesli Sohbet',
            body: 'Uygulama arka planda çalışıyor.'
        }).show();
    });

    mainWindow.on('close', function (event) {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'public/icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Göster', click: () => mainWindow.show() },
        {
            label: 'Çıkış', click: () => {
                app.isQuitting = true;
                killServer();
                app.quit();
            }
        }
    ]);
    tray.setToolTip('Sesli Sohbet Uygulaması');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        mainWindow.show();
    });
}

function killServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

app.on('before-quit', () => {
    killServer();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.on('minimize-app', () => mainWindow?.minimize());
ipcMain.on('close-app', () => mainWindow?.close());

// --- REMOTE CONTROL NATIVE LOGIC ---
const fs = require('fs');
const { exec, spawn } = require('child_process');

// 1. Compile C# Tool on Startup
const cscPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"; // Standard path
const sourceFile = path.join(__dirname, 'mouse_control.cs');
const exeFile = path.join(__dirname, 'mouse_control.exe');

if (fs.existsSync(sourceFile) && !fs.existsSync(exeFile)) {
    console.log("Compiling mouse_control.cs...");
    exec(`"${cscPath}" /out:"${exeFile}" "${sourceFile}"`, (err, stdout, stderr) => {
        if (err) {
            console.error("Compilation failed:", err);
            console.error(stderr);
        } else {
            console.log("Compilation success:", exeFile);
        }
    });
}

// 2. Execute Input
ipcMain.on('execute-remote-input', (event, data) => {
    // data: { type, xPercent, yPercent }
    if (!fs.existsSync(exeFile)) return console.error("Mouse control exe not found");

    const screen = electron.screen; // Using 'electron' var from above (requires careful check of variable name)
    // Actually we declared 'const electron = require(...)' at top.

    // Get Primary Display Size
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const x = Math.round(data.xPercent * width);
    const y = Math.round(data.yPercent * height);

    let args = [];
    if (data.type === 'click') {
        args = ['click', x, y];
    } else {
        args = ['move', x, y];
    }

    // Spawn fire-and-forget
    // Using spawn is faster than exec
    const child = spawn(exeFile, args);
    child.on('error', (err) => console.error("Failed to spawn mouse control:", err));
});

ipcMain.handle('get-sources', async (event) => {
    try {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 200, height: 200 } });
        // We cannot send native images via IPC easily in some versions, so let's convert thumbnail to dataURL here?
        // Actually, older Electron might not serialize thumbnails well.
        // Let's map them to JSON-safe objects.
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnailDataUrl: source.thumbnail.toDataURL()
        }));
    } catch (e) {
        console.error("Failed to get sources:", e);
        return [];
    }
});

// --- NATIVE PTT LISTENER ---
const nativeListenSource = path.join(__dirname, 'native_listen.cs');
const nativeListenExe = path.join(__dirname, 'native_listen.exe');

// Compile Listener
if (fs.existsSync(nativeListenSource) && !fs.existsSync(nativeListenExe)) {
    console.log("Compiling native_listen.cs...");
    exec(`"${cscPath}" /out:"${nativeListenExe}" "${nativeListenSource}"`, (err, stdout, stderr) => {
        if (err) console.error("Native Listen Compilation failed:", err);
        else console.log("Native Listen Compilation success");
    });
}

let pttProcess = null;

ipcMain.on('start-native-ptt', (event, keyCode) => {
    if (pttProcess) {
        pttProcess.kill();
        pttProcess = null;
    }

    if (!fs.existsSync(nativeListenExe)) {
        console.error("Native listener exe not found");
        return;
    }

    console.log("Starting PTT Listener for KeyCode:", keyCode);
    pttProcess = spawn(nativeListenExe, [keyCode.toString()]);

    pttProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output === 'D') {
            mainWindow.webContents.send('ptt-status-change', true); // Pressed
        } else if (output === 'U') {
            mainWindow.webContents.send('ptt-status-change', false); // Released
        }
    });

    pttProcess.on('error', (err) => console.error("PTT Process Error:", err));
});

ipcMain.on('stop-native-ptt', () => {
    if (pttProcess) {
        console.log("Stopping PTT Listener");
        pttProcess.kill();
        pttProcess = null;
    }
});

app.on('before-quit', () => {
    if (pttProcess) pttProcess.kill();
    killServer();
});
