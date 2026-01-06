    socket.on('remote-control-accepted', (data) => {
        alert("Bağlantı KABUL EDİLDİ! Ekran açılıyor...");
        remoteStatus.innerText = "BAĞLANDI: " + data.targetRemoteId;
        remoteStatus.style.color = "lightgreen";
        isControlling = true;
        controlTargetId = data.targetId;
        
        // Auto-Popout Logic
        const checkVideo = setInterval(() => {
             const vid = document.getElementById('video-' + data.targetId);
             if (vid && vid.srcObject) {
                 clearInterval(checkVideo);
                 openVideoPopout(vid.srcObject);
             }
        }, 1000);
        setTimeout(() => clearInterval(checkVideo), 10000); // Stop checking after 10s
    });

    socket.on('remote-control-error', (msg) => {
        alert("Bağlantı Hatası: " + msg);
        remoteStatus.innerText = "Hata.";
        remoteStatus.style.color = "red";
    });

    // 5. I am being controlled
    socket.on('remote-self-controlled', (data) => {
        // alert("DİKKAT: Bilgisayarınız şu an uzaktan kontrol ediliyor!");
        document.body.style.border = "5px solid red";
        
        // Auto Start Screen Share
        const shareBtn = document.getElementById('share-screen-btn');
        if (shareBtn && !myState.screenStream) {
            console.log("Auto-starting screen share for remote control...");
            shareBtn.click();
        }
    });
