const express = require('express');
const fs = require('fs');
const path = require('path');
const yauzl = require("yauzl");
const mime = require("mime-types");

const app = express();

// ---- CONFIG ----
const STATIC_DIR = path.join(__dirname, 'public');
const ASSETS_DIR = path.join(STATIC_DIR, 'assets');

// ---- STATIC FILES ----
app.use(express.static(STATIC_DIR));

// ---- GLOBAL VARIABLES -----
const data = GetConfig();
const artists = [...new Set(data.map(x => x.artist))]

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// ---- /json returns first JSON file ----
app.get('/jsonAll', (req, res) => {
    try {
        return res.json(data)
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/json/:count/:page', (req, res) => {
    try {
        const page = parseInt(req.params.page) || 0;
        const count = parseInt(req.params.count) || 20;

        const start = (page - 1) * count;
        const end = start + count;

        return res.json({
            result: data.slice(start, end),
            reachEnd: end >= data.length
        })
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
})

app.get('/search', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const count = parseInt(req.query.count) || 20;
        const query = req.query.query;
        const artists = [req.query.artists].filter(Boolean).flat(); // deal string or array

        let result = data
        if (query) {
            let queryLower = query.toLowerCase()
            result = result.filter(x => {
                return x.title.toLowerCase().includes(queryLower) ||
                    x.title_jpn?.toLowerCase()?.includes(queryLower)
            })
        }

        if (artists && artists.length > 0) {
            let filterResults = []
            for (const artist of artists) {
                let artistLower = artist.toLowerCase()
                let currentResults = result.filter(x => x.artist.toLowerCase().includes(artistLower))
                for (const currentResult of currentResults) {
                    if (filterResults.find(x => x.title == currentResult.title)) {
                        continue
                    }

                    filterResults.push(currentResult)
                }
            }
            result = filterResults
        }

        const start = (page - 1) * count;
        const end = start + count;

        return res.json({
            result: result.slice(start, end),
            reachEnd: end >= result.length
        })
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/artists', (req, res) => {
    try {
        return res.json(artists)
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/details/:title', (req, res) => {
    const title = req.params.title;
    try {
        let match = data.find(item => item && (item.title === title || item.title_jpn === title));
        if (match) return res.json(match);

        // If nothing found
        return res.status(404).json({ error: "No matching entry found" });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Server error" });
    }
});

app.get("/images/:title/:index/", (req, res) => {
    const { title, index } = req.params;
    const fileIndex = parseInt(index, 10) - 1; // 1-based from user → 0-based

    if (isNaN(fileIndex) || fileIndex < 0) {
        return res.status(400).json({ error: "Invalid index" });
    }

    let match = data.find(item => item && (item.title === title || item.title_jpn === title));
    if (!match) {
        return res.status(400).json({ error: "No match" });
    }

    const zipPath = path.join(ASSETS_DIR, match.localPath.replace(/\\/g, '/'));

    // Open ZIP in streaming mode
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Failed to open zip file" });
        }

        let currentIndex = 0;
        let matched = false;

        zipfile.readEntry();

        zipfile.on("entry", (entry) => {
            // Skip directories
            if (/\/$/.test(entry.fileName)) {
                zipfile.readEntry();
                return;
            }

            // Skip .thumb
            if (entry.fileName.startsWith('.')) {
                zipfile.readEntry();
                return;
            }

            if (currentIndex === fileIndex) {
                matched = true;

                // Determine MIME type
                const ext = path.extname(entry.fileName);
                const mimeType = mime.lookup(ext) || "application/octet-stream";
                res.setHeader("Content-Type", mimeType);

                // Stream the file
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: "Failed reading zip entry" });
                    }

                    readStream.pipe(res);
                });
            } else {
                currentIndex++;
                zipfile.readEntry();
            }
        });

        zipfile.on("end", () => {
            if (!matched) {
                return res
                    .status(404)
                    .json({ error: "File index out of range or no matching file" });
            }
        });
    });
});

function GetConfig () {
    const files = fs.readdirSync(ASSETS_DIR);

    // Filter only files matching p_data_YYYYMMDD.json
    const jsonFiles = files.filter(name =>
        /^p_data_\d{8}\.json$/.test(name)
    );

    if (jsonFiles.length === 0) {
        return res.status(404).json({ error: 'No JSON files found.' });
    }

    // Sort descending by date in filename
    const latestFile = jsonFiles.sort((a, b) => {
        const dateA = a.match(/\d{8}/)[0];
        const dateB = b.match(/\d{8}/)[0];
        return dateB.localeCompare(dateA);
    })[0];

    const filePath = path.join(ASSETS_DIR, latestFile);
    const content = fs.readFileSync(filePath, 'utf8');

    return JSON.parse(content)

}

function ValidateTitle () {
    let hasError = false
    for (const entry of data) {
        if (entry.title.includes('  ')) {
            console.log(`Invalid title: ${entry.title}`)
            hasError = true
        }
        if (entry.title_jpn?.includes('  ')) {
            console.log(`Invalid title: ${entry.title_jpn}`)
            hasError = true
        }
    }

    return hasError
}

// ---- START SERVER ----
const PORT = 3005;
if (ValidateTitle()) {
    console.log(`Try use regex to find invalid titles: ["title.*  ] (remove the brackets)`)
}
else {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
