const { app, BrowserWindow, Tray, Menu, Notification, dialog, ipcMain, desktopCapturer } = require('electron');
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
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            // If hidden in tray
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();

            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Uyarı',
                message: 'Uygulama şuan çalışıyor. Gizli Simgeleri kontrol edin.'
            });
        }
    });

    app.whenReady().then(() => {
        startServer();
        createWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

function startServer() {
    const serverPath = path.join(__dirname, 'server.js');
    console.log("Starting server from:", serverPath);

    serverProcess = fork(serverPath, [], {
        silent: true
    });

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
