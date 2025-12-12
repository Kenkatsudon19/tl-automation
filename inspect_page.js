const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

const proxy = {
    host: 'us.decodo.com',
    port: 10001,
    user: 'spv8vggn22',
    pass: 'igaYGO6wf1Gai6v8+k'
};

const proxyUrl = `http://${proxy.user}:${encodeURIComponent(proxy.pass)}@${proxy.host}:${proxy.port}`;
const agent = new HttpsProxyAgent(proxyUrl);

async function fetchPage() {
    try {
        const url = 'https://www.techliquidators.com/detail/ptrf29353/home-theater-accessories-home-monitoring-automation-baby-essentials-insignia-best-buy-essentials-rocketfish/';

        console.log('Fetching page through proxy...');
        const response = await axios.get(url, {
            httpsAgent: agent,
            httpAgent: agent,
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // Save full HTML for inspection
        fs.writeFileSync('tl_page.html', response.data);
        console.log('Saved to tl_page.html');

        // Look for key patterns
        const html = response.data;

        console.log('\n=== Looking for H1 tags ===');
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
        if (h1Match) h1Match.forEach((m, i) => console.log(`H1 #${i + 1}:`, m.substring(0, 200)));

        console.log('\n=== Looking for Condition ===');
        const condMatch = html.match(/Condition[^<]*<[^>]*>([^<]+)/gi);
        if (condMatch) condMatch.forEach(m => console.log(m.substring(0, 150)));

        console.log('\n=== Looking for PST time ===');
        const pstMatch = html.match(/PST[^<]{0,50}/gi);
        if (pstMatch) pstMatch.forEach(m => console.log(m));

        console.log('\n=== Looking for Download Manifest ===');
        const manifestMatch = html.match(/[^"]*manifest[^"]*/gi);
        if (manifestMatch) manifestMatch.forEach(m => console.log(m.substring(0, 150)));

    } catch (error) {
        console.error('Error:', error.message);
    }
}

fetchPage();
