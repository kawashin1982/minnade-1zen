document.addEventListener('DOMContentLoaded', () => {
    const budgetInput = document.getElementById('budgetInput');
    const prefectureSelect = document.getElementById('prefectureSelect');
    const searchBtn = document.getElementById('searchBtn');
    const resultsContainer = document.getElementById('results');

    let allData = [];

    // Fetch data on load
    fetch('data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Data file not found or invalid');
            }
            return response.json();
        })
        .then(data => {
            allData = data;
            console.log('Data loaded:', allData.length, 'organizations found');
            populatePrefectures(data);
        })
        .catch(err => {
            console.error(err);
            resultsContainer.innerHTML = '<p class="loading">データの読み込みに失敗しました。<br>管理者にお問い合わせください (data.json missing)。</p>';
        });

    const sortSelect = document.getElementById('sortSelect'); // NEW

    function populatePrefectures(data) {
        const prefs = new Set();
        data.forEach(org => {
            if (org.prefecture) {
                prefs.add(org.prefecture);
            }
        });

        const sortedPrefs = Array.from(prefs).sort();
        sortedPrefs.forEach(pref => {
            const option = document.createElement('option');
            option.value = pref;
            option.textContent = pref;
            prefectureSelect.appendChild(option);
        });
    }

    searchBtn.addEventListener('click', () => {
        performSearch();
    });

    budgetInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Also trigger search when sort options change (optional but good UX)
    sortSelect.addEventListener('change', () => {
        performSearch();
    });

    function performSearch() {
        const budget = parseInt(budgetInput.value);
        const selectedPref = prefectureSelect.value;
        const selectedSort = sortSelect.value; // NEW

        if (isNaN(budget) || budget <= 0) {
            alert('有効な金額を入力してください');
            return;
        }

        resultsContainer.innerHTML = '';
        let foundItems = [];

        // Filter and Flatten
        allData.forEach(org => {
            // Filter by Prefecture first
            if (selectedPref !== 'All' && org.prefecture !== selectedPref) {
                return;
            }

            if (org.items && Array.isArray(org.items)) {
                org.items.forEach(item => {
                    if (item.price <= budget) {
                        foundItems.push({
                            ...item,
                            orgName: org.orgName,
                            orgUrl: org.orgUrl,
                            prefecture: org.prefecture || 'その他'
                        });
                    }
                });
            }
        });

        // Sort by price based on selection
        console.log(`Sorting by: ${selectedSort}`);
        foundItems.sort((a, b) => {
            if (selectedSort === 'priceAsc') {
                return a.price - b.price;
            } else {
                return b.price - a.price;
            }
        });

        if (foundItems.length === 0) {
            resultsContainer.innerHTML = '<p class="loading">条件に合う商品が見つかりませんでした。</p>';
            return;
        }

        foundItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card';

            const imgSrc = (item.image && !item.image.includes('.svg')) ? item.image : 'https://placehold.co/200x200?text=No+Image';

            card.innerHTML = `
                <img src="${imgSrc}" alt="${item.title}" loading="lazy" onerror="this.onerror=null; this.src='https://placehold.co/200x200?text=No+Image';">
                <div class="price">¥${item.price.toLocaleString()}</div>
                <h3>${item.title}</h3>
                <div class="org-name">
                    <span style="background:#eee; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-right:5px;">${item.prefecture}</span>
                    ${item.orgName}
                </div>
                <div class="actions">
                    <a href="${item.link}" target="_blank" class="btn-amazon">Amazonで見る</a>
                    <a href="${item.orgUrl}" target="_blank" class="btn-org">団体のリストを見る</a>
                </div>
            `;
            resultsContainer.appendChild(card);
        });
    }
});
