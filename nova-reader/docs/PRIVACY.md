# Privacy

NOVA Reader is built to know as little about you as possible.

- **No accounts, no tracking, no analytics, no ads, no third-party scripts or fonts.** An automated browser test checks that normal use makes **no requests to any other website**.
- **Your reading stays on your device.** Saved articles, offline feed copies, stored full articles and the Personal Knowledge Radar all live in your browser (IndexedDB) and are never uploaded. The radar is calculated on demand and isn't stored.
- **Loading a feed or article** sends its URL to this app's server, which downloads it for you. That's needed because browsers block most cross-site requests. The server doesn't store or log the URL, and the blog sees the server, not you.
- **Local AI is optional and off by default.** Only after you click "Download & enable local AI" does your browser download the model from huggingface.co. That reveals your IP address and the model name to Hugging Face, but nothing about what you read. Summaries are made on your device and aren't stored.
- **No Referer header** is sent when you open an article on its own site.
- **No remote images** are loaded in lists or the reading view, so blogs can't track who reads them.
- **The service worker** stores only this app's own pages and code, so it opens offline. It never stores your feeds or articles; those stay in IndexedDB.

## Deleting your data

- **Saved articles:** press *Remove*.
- **Offline feed copies and stored full articles** (except those of saved articles): use *Clear offline copies*.
- **Local AI model:** use *Delete downloaded model*.
- **Everything:** clear this site's data in your browser settings.
