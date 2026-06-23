# Changelog

Semua perubahan dan update sistem AutoOrder akan dicatat di file ini.

## [v2] - Terbaru
### Ditambahkan
- **Integrasi MedanPedia (SMM Panel)**: Sistem otomatis mem-fetch layanan dari MedanPedia menggunakan apikey. Layanan, harga, dan kategori selalu up-to-date.
- **SMM Checkout & Provisioning**: Pengguna kini bisa memesan SMM secara langsung melalui dashboard marketplace. Fitur SMM terintegrasi dengan saldo pengguna maupun payment gateway QRIS.
- **Admin Meta Editor**: Admin dapat mengubah deskripsi website, ikon, favicon, langsung melalui halaman Admin Panel -> Settings.
- **Edit Pterodactyl Panel**: Admin kini dapat langsung mengedit spesifikasi produk Pterodactyl (CPU, RAM, Disk, dsb) secara langsung dari halaman Produk.
- **Fitur Core/Threads Panel**: Menambahkan dukungan alokasi `threads` opsional (contoh: "0-1" atau "1-2") pada pembuatan server Pterodactyl.

### Diperbarui
- **Tampilan Marketplace Dashboard**: Menambahkan SMM Center khusus agar pengguna bisa memilih layanan secara spesifik dengan menu dropdown per kategori.
- **Sistem Cache (SMM)**: Menambahkan `node-cache` pada `smmService.js` untuk mengurangi beban (lag) pada server dan API provider.
- **Sidebar & Navbar Navigation**: Menambahkan dropdown marketplace categories di Sidebar Dashboard.
- **UI/UX Admin Products**: Perombakan tata letak daftar produk admin menggunakan sistem *card grid* modern, menyertakan tombol pintas untuk Manajemen Stok & Edit Produk.
- **UI Nokos/OTP Marketplace**: Navigasi kategori generik dihapus pada halaman Nokos/OTP agar tampilan lebih elegan dan fokus langsung ke pemilihan *Virtual Number*.

### Diperbaiki
- **Hotfix Global Margin Backend**: Menambal bug di mana keuntungan margin global (sebesar +10%) terlewat di backend pada transaksi SMM dan Nokos. Sekarang sistem memotong saldo secara utuh dan sinkron.
- **Open Graph (SEO) Image**: Memperbaiki sintaks *string concatenation* yang sebelumnya menyebabkan thumbnail website gagal muncul saat tautan dibagikan ke WhatsApp, Twitter, atau Facebook.
- **Pembersihan Workspace**: Menghapus lebih dari 30+ file skrip sisa *testing* dan log *debugging* (`test_*.js`, `update_*.js`) dari akar repositori agar *codebase* kembali bersih.

## [v1] - Rilis Pertama
- Create website auto order Pterodactyl, Nokos (OTP), Script/Premium App.
- Integrasi Payment Gateway Pakasir & Saldo lokal.
- Admin Panel (Products, Users, Orders, Vouchers, Pterodactyl Nodes).
- Sistem Authentikasi & Leveling (Member, Reseller, Admin).
- Auto Provisioning Pterodactyl.
