const { app, BrowserWindow, Tray, Menu, Notification, dialog } = require('electron');
const path = require('path');

let mainWindow;
let tray = null;

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
        createWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
