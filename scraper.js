const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'https://www.amazon.co.jp/ouen';
const OUTPUT_FILE = path.join(__dirname, 'public', 'data.json');
const MAX_PREFECTURES = 47; // Scan all
const MAX_ORGS_PER_PREF = 3;

(async () => {
    console.log('🚀 Starting Scraper (Debug Mode)...');

    const browser = await puppeteer.launch({
        headless: "new", // Must be headless for GitHub Actions
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja-JP']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let allData = [];

    try {
        console.log(`📡 Visiting ${BASE_URL}...`);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('body');

        const targetPrefectures = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];

        const prefectureLinks = await page.evaluate((targets) => {
            const results = [];
            const allLinks = Array.from(document.querySelectorAll('a'));

            targets.forEach(pref => {
                // Find a link that contains the prefecture name
                // We prefer links that look like category links (contain /b/ or /hz/ but usually /b/ for browsing)
                const link = allLinks.find(a =>
                    a.innerText.includes(pref) &&
                    (a.href.includes('/b/') || a.href.includes('node='))
                );
                if (link) {
                    results.push({ name: pref, url: link.href });
                }
            });
            return results;
        }, targetPrefectures);

        const uniquePrefs = [...new Map(prefectureLinks.map(c => [c.url, c])).values()].slice(0, MAX_PREFECTURES);
        console.log(`🔍 Found ${uniquePrefs.length} prefectures to scan.`);

        for (const pref of uniquePrefs) {
            console.log(`📂 Processing: ${pref.name}`);
            try {
                await page.goto(pref.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                try {
                    await page.waitForSelector('a[href*="/hz/wishlist/ls/"]', { timeout: 10000 });
                } catch (e) {
                    console.log('⚠️ Timeout waiting for wishlist selectors. Page might be empty or loading slowly.');
                }

                // Auto-scroll to trigger lazy loading
                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= scrollHeight || totalHeight > 5000) { // Scan top part
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });

                const organizations = await page.evaluate((prefName) => {
                    const links = Array.from(document.querySelectorAll('a[href*="/hz/wishlist/ls/"]'));
                    return links.map((a) => {
                        let name = a.innerText.trim();
                        let foundAuthor = false;

                        let parent = a.parentElement;
                        for (let i = 0; i < 5; i++) {
                            if (!parent) break;
                            const texts = parent.innerText.split('\n');
                            for (const line of texts) {
                                // Enhanced keyword list for Japanese organizations
                                if (line.match(/(作成|by\s|団体|NPO|法人|食堂|支援|クラブ|会|隊|センター|社団|財団|プロジェクト|ネットワーク|委員会|サポーター|塾|の家|園|スクール|協会|連盟)/)) {
                                    if (line !== name && line.length > 1 && line.length < 60) {
                                        let clean = line.replace(/作成[:\s]*|by[:\s]*/g, '').trim();
                                        if (clean.length > 1) {
                                            name = clean;
                                            foundAuthor = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (foundAuthor) break;
                            parent = parent.parentElement;
                        }

                        const genericTerms = ['ほしい物リスト', '応援', 'Amazon', '支援', '作成', 'See More', '詳細', '買い物', '検索', 'ギフト'];
                        if (!foundAuthor && (name.length < 2 || genericTerms.some(t => name.includes(t)))) {
                            const img = a.querySelector('img');
                            if (img && img.alt && img.alt.length > 2) name = img.alt.trim();
                            else name = "名称不明の団体";
                        }

                        return { name: name, url: a.href, prefecture: prefName };
                    });
                }, pref.name);

                // Smart Deduplication: Prefer entries with valid names
                const orgMap = new Map();
                organizations.forEach(o => {
                    const existing = orgMap.get(o.url);
                    const isUnknown = (n) => n === "名称不明の団体";

                    if (!existing) {
                        orgMap.set(o.url, o);
                    } else {
                        // If we have an existing entry but it's "Unknown", and the new one is KNOWN, replace it.
                        if (isUnknown(existing.name) && !isUnknown(o.name)) {
                            orgMap.set(o.url, o);
                        }
                        // If both are known (or both unknown), maybe prefer the longer name?
                        else if (!isUnknown(existing.name) && !isUnknown(o.name)) {
                            if (o.name.length > existing.name.length) orgMap.set(o.url, o);
                        }
                    }
                });
                const uniqueOrgs = [...orgMap.values()].slice(0, MAX_ORGS_PER_PREF);
                console.log(`   Found ${uniqueOrgs.length} organizations in ${pref.name}.`);

                for (const org of uniqueOrgs) {
                    console.log(`   ➡️ Visiting Wishlist: ${org.name.substring(0, 20)}...`);
                    try {
                        await page.goto(org.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForSelector('body');

                        const items = await page.evaluate(() => {
                            const nodes = document.querySelectorAll('li, div.a-section, .g-item-sortable, .a-fixed-left-grid');
                            const results = [];
                            nodes.forEach(node => {
                                const titleEl = node.querySelector('a[id^="itemName_"]'); // More specific selector
                                const priceEl = node.querySelector('.a-price .a-offscreen, .a-color-price, span[id^="itemPrice_"]');

                                // Better image selection: find lazy loaded images too
                                let imgEl = node.querySelector('img:not([src*=".svg"])');
                                if (!imgEl) imgEl = node.querySelector('img');

                                if (titleEl && priceEl) {
                                    const titleText = titleEl.innerText.trim();
                                    // Skip generic UI texts
                                    if (titleText === 'その他' || titleText.includes('クイックビュー')) return;

                                    const priceMatch = priceEl.innerText.match(/([0-9,]+)/);
                                    let priceText = priceMatch ? priceMatch[0] : '0';
                                    let price = parseInt(priceText.replace(/[^0-9]/g, ''));

                                    // Validate Image URL (check data-src for lazy load)
                                    let imgSrc = '';
                                    if (imgEl) {
                                        imgSrc = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-a-dynamic-image') || imgEl.src;
                                        // If dynamic image (JSON), parse it
                                        if (imgSrc.startsWith('{')) {
                                            try {
                                                const json = JSON.parse(imgSrc);
                                                imgSrc = Object.keys(json)[0]; // Get first key (URL)
                                            } catch (e) { }
                                        }
                                    }

                                    if (imgSrc && (imgSrc.includes('.svg') || imgSrc.includes('transparent'))) imgSrc = '';

                                    if (!isNaN(price) && price > 0 && titleText.length > 0) {
                                        results.push({
                                            title: titleText,
                                            link: titleEl.href.startsWith('http') ? titleEl.href : `https://www.amazon.co.jp${titleEl.href}`,
                                            image: imgSrc,
                                            price: price
                                        });
                                    }
                                }
                            });
                            const unique = [];
                            const seen = new Set();
                            results.forEach(r => {
                                if (!seen.has(r.link)) { seen.add(r.link); unique.push(r); }
                            });
                            return unique;
                        });

                        console.log(`Debug: ${org.name.substring(0, 15)}... - Nodes: ${items.length}`);

                        if (items.length > 0) {
                            allData.push({
                                orgName: org.name,
                                orgUrl: org.url,
                                prefecture: pref.name,
                                items: items
                            });
                        }
                    } catch (e) {
                        console.error('Error visiting wishlist:', e);
                    }
                }
            } catch (e) {
                console.error(`   Failed pref: ${pref.name}`);
            }
        }

    } catch (e) {
        console.error('Fatal:', e);
    } finally {
        await browser.close();
        if (allData.length > 0) {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2));
            console.log(`✅ Data Saved. Items collected: ${allData.length} organizations.`);
        } else {
            console.error('⚠️ No data collected. Skipping file write to preserve existing data.');
        }
    }
})();
