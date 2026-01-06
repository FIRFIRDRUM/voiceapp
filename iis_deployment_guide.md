# OmniVoice IIS Kurulum Rehberi

Bu rehber, OmniVoice sunucusunu (**server.js**) kendi Windows Server'ınızda IIS kullanarak nasıl çalıştıracağınızı anlatır.

## Ön Gereksinimler

Sunucunuzda şunların kurulu olması gerekir:
1.  **Node.js LTS**: [Node.js İndir](https://nodejs.org/) (Kurulum bitince cmd'de `node -v` yazıp kontrol edin).
2.  **IIS (Internet Information Services)**: Windows Özelliklerinden "Web Server (IIS)" etkinleştirin.
3.  **IIS URL Rewrite Module**: [İndir ve Kur](https://www.iis.net/downloads/microsoft/url-rewrite)
4.  **IIS Application Request Routing (ARR)**: [İndir ve Kur](https://www.iis.net/downloads/microsoft/application-request-routing)
    *   Kurduktan sonra IIS Manager'ı açın -> Sunucu Adına Tıklayın -> **Application Request Routing Cache** -> Sağ panelden **Server Proxy Settings** -> **Enable proxy** işaretleyin ve Apply deyin.

## Kurulum Adımları

### 1. Dosyaları Sunucuya Atın
Projenizin içindeki şu dosyaları sunucuda bir klasöre (Örn: `C:\inetpub\wwwroot\voiceapp`) kopyalayın:
- `package.json`
- `server.js`
- `public` klasörü (tüm içeriğiyle)
- `web.config` (Az önce oluşturduğumuz dosya)
- `run_server.bat` (Aşağıda oluşturacağız)

### 2. Bağımlılıkları Yükleyin
Klasörün içinde CMD (Komut İstemi) açın ve şu komutu çalıştırın:
```cmd
npm install --production
```

### 3. Node.js Servisini Başlatın
IIS sadece "yönlendirme" yapar. Asıl sunucuyu arka planda çalıştırmamız gerekir. Bunun için `PM2` kullanmanızı öneririm (daha profesyoneldir).

**PM2 ile Çalıştırma (Önerilen):**
```cmd
npm install pm2 -g
pm2 start server.js --name "voiceapp"
pm2 save
pm2 startup
```
*Bu sayede sunucu kapansa bile uygulama otomatik açılır.*

**Basit Yöntem (Test İçin):**
Klasör içinde `run_server.bat` adında bir dosya oluşturun ve içine şunu yazın:
```bat
@echo off
node server.js
pause
```
Bu dosyayı çift tıklayıp açık bırakın (pencereyi kapatmayın).

### 4. IIS Sitesini Oluşturun
1.  IIS Manager'ı açın.
2.  **Sites** -> Sağ Tık -> **Add Website**.
3.  **Site Name**: `VoiceApp`
4.  **Physical Path**: Dosyaları attığınız klasör (`C:\inetpub\wwwroot\voiceapp`).
5.  **Binding**: Port 80 veya 443 (Domaininiz varsa Hostname girin).

### 5. Config Kontrolü
Klasöre attığınız `web.config` dosyası sayesinde IIS, gelen tüm istekleri (WebSocket dahil) otomatik olarak arkada çalışan Node.js (`localhost:3000`) servisine yönlendirecektir.

Tarayıcıdan `http://localhost` (veya sunucu IP'niz) adresine girdiğinizde uygulamanın çalıştığını görmelisiniz.
