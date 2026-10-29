// A realistic, deliberately messy article page used by the Stage 6 tests.
// It contains navigation, ads, a cookie banner, scripts, tracking images,
// an iframe, event handlers and unsafe links around the real article.

export const ARTICLE_PAGE_URL = "https://blog.example/2026/10/feeds-still-matter/";

const PARAGRAPHS = [
  "Feeds let readers follow independent writers directly, without an algorithm deciding what they are allowed to see. That simple idea has survived for more than twenty years, and it still works on almost every blog.",
  "When you subscribe to a feed, your reader checks it for new posts. Nothing about you is sent to a central company, there are no engagement scores, and nobody ranks the posts for you. You decide what to read and when.",
  "The weak spot has always been discovery. Feed readers assume you already know which blogs you want. That is why projects like NOVA Reader experiment with private, opt-in ways to find new writers without tracking anyone.",
  "Reading views help too. A clean page without menus, pop-ups and adverts makes long articles easier to finish, especially on a small phone screen or a slow connection in a small town.",
];

export const ARTICLE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Why feeds still matter | Example Blog</title>
  <meta property="og:site_name" content="Example Blog">
  <meta property="og:title" content="Why feeds still matter">
  <meta name="author" content="Meera Kaur">
  <meta property="article:published_time" content="2026-10-25T09:00:00Z">
  <base href="https://evil.example/">
  <script>window.__pageScriptRan = true;</script>
  <style>body { background: red }</style>
</head>
<body>
  <header class="site-header">
    <nav class="main-nav"><a href="/">Home</a> <a href="/about">About</a> <a href="/shop">Shop our merch</a></nav>
  </header>
  <div class="cookie-banner">We use cookies. ACCEPT ALL COOKIES</div>
  <aside class="sidebar ad advertisement">BUY CHEAP WIDGETS NOW — sponsored advert</aside>
  <main>
    <article>
      <h1>Why feeds still matter</h1>
      <p class="byline">By Meera Kaur</p>
      ${PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n      ")}
      <p>Read the <a href="/2026/09/history-of-rss/">history of RSS</a> or the
         <a href="https://other.example/atom">Atom spec</a>.
         <a href="javascript:alert('xss')">Click for a prize</a>.</p>
      <p><img src="https://tracker.example/pixel.gif" onerror="window.__imgHandlerRan = true" alt="tracking pixel"></p>
      <iframe src="https://ads.example/frame"></iframe>
      <p onclick="window.__clickRan = true" style="color: red">A paragraph with an inline handler and style, still part of the story about feeds and the open web.</p>
      <table><tr><th>Format</th><th>Year</th></tr><tr><td>RSS 2.0</td><td>2002</td></tr><tr><td>Atom</td><td>2005</td></tr></table>
      <script>document.write("injected");</script>
    </article>
  </main>
  <footer class="site-footer">Copyright Example Blog. Newsletter signup. Terms. Privacy.</footer>
</body>
</html>`;

/** A page with almost no text (e.g. a home page or a video page). */
export const NOT_AN_ARTICLE_HTML = `<!doctype html><html><head><title>Home</title></head>
<body><nav><a href="/a">A</a> <a href="/b">B</a></nav><p>Welcome!</p><footer>Footer</footer></body></html>`;
