/**
 * BOT CAO DU LIEU CONG VAN DANG - E-OFFICE TAWACO
 * Dung Puppeteer de dang nhap va lay du lieu thuc tu trang CRUD
 * Output: cong_van_dang_data.json (dung cho Dashboard)
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    username: '505',
    password: 'trungan',
    loginUrl: 'https://vpdt.capnuoctrungan.vn/Account/Login',
    docsUrl: 'https://vpdt.capnuoctrungan.vn/CongVanNoiBo/CongVanDenNew?phongbanID=b94d3742-97e5-443d-933f-7f3786226751&trangThaiPB=-1&tieuDe=' + encodeURIComponent('Nội bộ đến > Ban chấp hành Đoàn thanh niên > Tất cả'),
    outputJson: path.join(__dirname, 'cong_van_doan_data.json'),
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function calcStatus(hanXuLy) {
    if (!hanXuLy || hanXuLy === '') return { status: 'chua_xem', daysLeft: null };
    // Parse dd/MM/yyyy
    const parts = hanXuLy.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!parts) return { status: 'chua_xem', daysLeft: null };
    const han = new Date(parseInt(parts[3]), parseInt(parts[2])-1, parseInt(parts[1]));
    const today = new Date();
    today.setHours(0,0,0,0);
    const daysLeft = Math.round((han - today) / 86400000);
    if (daysLeft < 0)  return { status: 'qua_han',  daysLeft };
    if (daysLeft <= 3) return { status: 'gan_han',  daysLeft };
    return { status: 'trong_han', daysLeft };
}

async function run() {
    console.log('=== BOT THEO DOI CONG VAN DANG ===');
    const startTime = Date.now();
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=vi-VN'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });

        // BUOC 1: Dang nhap
        console.log('[1/4] Dang nhap E-Office...');
        await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Nhap username
        await page.waitForSelector('input[name="UserName"], input[type="text"]', { timeout: 10000 });
        const userInput = await page.$('input[name="UserName"]') || await page.$('input[type="text"]');
        await userInput.click({ clickCount: 3 });
        await userInput.type(CONFIG.username);

        // Nhap password
        const passInput = await page.$('input[name="Password"]') || await page.$('input[type="password"]');
        await passInput.click({ clickCount: 3 });
        await passInput.type(CONFIG.password);

        // Click dang nhap
        const loginBtn = await page.$('button[type="submit"]') 
                      || await page.$('input[type="submit"]')
                      || await page.$('.btn-primary');
        if (loginBtn) await loginBtn.click();
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        await wait(2000);

        const currentUrl = page.url();
        if (currentUrl.includes('/Login')) {
            console.error('[LOI] Dang nhap that bai! Kiem tra lai user/pass.');
            process.exit(1);
        }
        console.log('[OK] Dang nhap thanh cong - URL:', currentUrl);

        // BUOC 2: Vao trang Cong van Dang
        console.log('[2/4] Dang tai trang Cong van Dang...');
        await page.goto(CONFIG.docsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await wait(3000);

        // BUOC 3: Parse du lieu tu bang
        console.log('[3/4] Dang doc du lieu bang...');
        
        // Cuon xuong de load het du lieu lazy
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await wait(1500);

        const rawDocs = await page.evaluate(() => {
            const result = [];
            const debugLog = [];
            
            const tables = document.querySelectorAll('table, .table, [class*="table"]');
            debugLog.push('Tables found: ' + tables.length);

            tables.forEach((table, tIdx) => {
                const ths = Array.from(table.querySelectorAll('thead th, tr th'));
                const colMap = { soHieu: -1, loai: -1, trichYeu: -1, noiGui: -1, ngayDen: -1, hanXuLy: -1 };
                ths.forEach((th, i) => {
                    const text = th.innerText.toLowerCase().trim();
                    if (text.includes('kÃ½ hiá»‡u') || text.includes('sá»‘') || text.includes('mÃ£')) colMap.soHieu = i;
                    if (text.includes('loáº¡i')) colMap.loai = i;
                    if (text.includes('trÃ­ch yáº¿u') || text.includes('ná»™i dung')) colMap.trichYeu = i;
                    if (text.includes('nÆ¡i') || text.includes('cÆ¡ quan')) colMap.noiGui = i;
                    if (text.includes('ngÃ y Ä‘áº¿n') || text.includes('ngÃ y nháº­n')) colMap.ngayDen = i;
                    if (text.includes('háº¡n')) colMap.hanXuLy = i;
                });
                
                debugLog.push('Table ' + tIdx + ' colMap: ' + JSON.stringify(colMap));

                const rows = table.querySelectorAll('tbody tr, tr');
                debugLog.push('Table ' + tIdx + ' rows: ' + rows.length);

                rows.forEach((row, rIdx) => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 3) return;

                    const getText = (el) => el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
                    let soHieu = '', loai = '', trichYeu = '', noiGui = '', ngayDen = '', hanXuLy = '', link = '';

                    // Nhan dien the <a> dau tien chua link hoac href /CongVan/ hoac /Doc/
                    const aTags = Array.from(row.querySelectorAll('a'));
                    let targetA = aTags.find(a => a.href && (a.href.toLowerCase().includes('/congvan/') || a.href.toLowerCase().includes('/doc/'))) || aTags.find(a => a.href && !a.href.includes('javascript:'));
                    if (targetA) {
                        link = targetA.href;
                    }

                    if (colMap.trichYeu !== -1 || colMap.soHieu !== -1) {
                        soHieu   = colMap.soHieu   !== -1 ? getText(cells[colMap.soHieu])   : '';
                        loai     = colMap.loai     !== -1 ? getText(cells[colMap.loai])     : '';
                        trichYeu = colMap.trichYeu !== -1 ? getText(cells[colMap.trichYeu]) : '';
                        noiGui   = colMap.noiGui   !== -1 ? getText(cells[colMap.noiGui])   : '';
                        ngayDen  = colMap.ngayDen  !== -1 ? getText(cells[colMap.ngayDen])  : '';
                        hanXuLy  = colMap.hanXuLy  !== -1 ? getText(cells[colMap.hanXuLy])  : '';
                    } else {
                        // fallback index fix
                        if (cells.length >= 6) {
                            soHieu   = getText(cells[0]);
                            loai     = getText(cells[1]);
                            trichYeu = getText(cells[2]);
                            noiGui   = getText(cells[3]);
                            ngayDen  = getText(cells[4]);
                        } else if (cells.length >= 4) {
                            soHieu   = getText(cells[0]);
                            trichYeu = getText(cells[1]);
                            noiGui   = getText(cells[2]);
                            ngayDen  = getText(cells[3]);
                        }
                    }

                    if (!soHieu || soHieu.toUpperCase() === 'KÃ HIá»†U' || soHieu.toUpperCase() === 'STT') return;
                    if (!trichYeu || trichYeu.length < 5) return;

                    const loaiBadge = row.querySelector('.badge, [class*="badge"], [class*="label"]');
                    if (loaiBadge && !loai) loai = loaiBadge.innerText.trim();

                    result.push({ soHieu, loai, trichYeu, noiGui, ngayDen, hanXuLy, link });
                });
            });

            // Neu bang rong, thu tim danh sach card/list view
            if (result.length === 0) {
                const items = document.querySelectorAll('[class*="item"], [class*="row-item"], li[data-id]');
                items.forEach(item => {
                    const text = item.innerText.replace(/\s+/g, ' ').trim();
                    if (text.length > 20) {
                        result.push({
                            soHieu: item.getAttribute('data-id') || '',
                            loai: 'Cong van',
                            trichYeu: text.substring(0, 200),
                            noiGui: '',
                            ngayDen: '',
                            hanXuLy: ''
                        });
                    }
                });
            }

            // Doc so tong tu phan trang
            const paginationEl = document.querySelector('[class*="total"], [class*="pagination"], .paging');
            const totalText = paginationEl ? paginationEl.innerText : '';
            const totalMatch = totalText.match(/(\d+)/);
            const totalCount = totalMatch ? parseInt(totalMatch[1]) : result.length;

            return { rows: result, totalCount, pageSource: document.title };
        });

        console.log(`   -> Tim thay ${rawDocs.rows.length} hang trong bang (tong: ${rawDocs.totalCount})`);
        console.log(`   -> Tieu de trang: ${rawDocs.pageSource}`);

        // BUOC 4: Xu ly va tinh trang thai
        const docs = rawDocs.rows.map(d => {
            const { status, daysLeft } = calcStatus(d.hanXuLy);
            return { ...d, status, daysLeft };
        });

        const soQuaHan  = docs.filter(d => d.status === 'qua_han').length;
        const soGanHan  = docs.filter(d => d.status === 'gan_han').length;
        const soChuaXem = docs.filter(d => d.status !== 'da_xu_ly').length;

        const output = {
            fetchTime:  new Date().toLocaleString('vi-VN'),
            totalDocs:  rawDocs.totalCount || docs.length,
            soQuaHan,
            soGanHan,
            soChuaXem,
            docs
        };

        const jsonStr = JSON.stringify(output, null, 2);
        fs.writeFileSync(CONFIG.outputJson, jsonStr, 'utf8');
        
        // Ghi ra file js de tranh loi CORS
        const outJs = CONFIG.outputJson.replace('.json', '.js');
        fs.writeFileSync(outJs, 'window.CVD_DOAN_DATA = ' + jsonStr + ';', 'utf8');
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[OK] Da ghi: ${CONFIG.outputJson}`);
        console.log(`[OK] Da ghi: ${outJs}`);
        console.log(`[OK] Tong: ${docs.length} van ban | Qua han: ${soQuaHan} | Gan han: ${soGanHan}`);
        console.log(`[OK] Thoi gian: ${elapsed}s`);

    } catch(err) {
        console.error('[LOI]', err.message);
        // Neu loi, giu nguyen du lieu cu
        if (fs.existsSync(CONFIG.outputJson)) {
            console.log('[INFO] Giu nguyen du lieu cu.');
        }
    } finally {
        if (browser) await browser.close();
    }
}

run();
