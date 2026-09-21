package clientmgmt

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"html/template"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// The public face of the CMS. The landing page's nginx proxies these paths
// to the API, so /blog/<slug> is served from the site's own origin, rendered
// as plain HTML that a crawler reads without running anything: that is the
// whole point of writing articles for search.

// SiteConfig is what the landing page fetches at load to decide whether to
// load Google Analytics and which Search Console token to announce.
type SiteConfig struct {
	SiteName           string `json:"siteName"`
	SiteURL            string `json:"siteUrl"`
	SiteDescription    string `json:"siteDescription"`
	GAMeasurementID    string `json:"gaMeasurementId"`
	SearchConsoleToken string `json:"searchConsoleToken"`
	WhatsAppNumber     string `json:"whatsappNumber"`
	WhatsAppLabel      string `json:"whatsappLabel"`
}

// MountSite registers the public pages at the root of the API router.
func MountSite(root chi.Router, svc *Service) {
	root.Get("/site/config.json", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		s, err := svc.GetSiteSettings(r.Context())
		if err != nil {
			return err
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		return httpx.OK(w, SiteConfig{SiteName: s.SiteName, SiteURL: s.SiteURL, SiteDescription: s.SiteDescription, GAMeasurementID: s.GAMeasurementID, SearchConsoleToken: s.SearchConsoleToken,
			WhatsAppNumber: s.WhatsAppNumber, WhatsAppLabel: s.WhatsAppLabel})
	}))

	// The tag's bootstrap as a same-origin script, so neither the landing
	// bundle nor an article page needs an inline script the CSP would block.
	root.Get("/site/gtag.js", func(w http.ResponseWriter, r *http.Request) {
		s, err := svc.GetSiteSettings(r.Context())
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		if err != nil || !gaIDPattern.MatchString(s.GAMeasurementID) {
			_, _ = w.Write([]byte("// analytics not configured\n"))
			return
		}
		fmt.Fprintf(w, "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',%q,{anonymize_ip:true});\n", s.GAMeasurementID)
	})

	// The <head> fragment nginx splices into the landing page's index.html
	// with a server-side include, so the Search Console meta tag and the
	// analytics tag are in the raw HTML a crawler reads, not added by script.
	root.Get("/site/head.html", func(w http.ResponseWriter, r *http.Request) {
		s := svc.siteSettings(r.Context())
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		var b strings.Builder
		if scTokenPattern.MatchString(s.SearchConsoleToken) {
			b.WriteString(`<meta name="google-site-verification" content="` + template.HTMLEscapeString(s.SearchConsoleToken) + `">` + "\n")
		}
		if gaIDPattern.MatchString(s.GAMeasurementID) {
			b.WriteString(`<script async src="https://www.googletagmanager.com/gtag/js?id=` + template.HTMLEscapeString(s.GAMeasurementID) + `"></script><script src="/site/gtag.js"></script>` + "\n")
		}
		_, _ = w.Write([]byte(b.String()))
	})

	root.Get("/blog", func(w http.ResponseWriter, r *http.Request) { svc.blogIndex(w, r) })
	root.Get("/blog/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/blog", http.StatusMovedPermanently)
	})
	root.Get("/blog/{slug}", func(w http.ResponseWriter, r *http.Request) { svc.blogArticle(w, r, chi.URLParam(r, "slug")) })
	root.Get("/sitemap.xml", func(w http.ResponseWriter, r *http.Request) { svc.sitemap(w, r) })
	root.Get("/robots.txt", func(w http.ResponseWriter, r *http.Request) { svc.robots(w, r) })
	// Search Console's HTML-file verification, served only for the exact
	// file name configured in Settings.
	root.Get("/{file:google[0-9a-f]+\\.html}", func(w http.ResponseWriter, r *http.Request) { svc.verificationFile(w, r, chi.URLParam(r, "file")) })
}

// The CSP for pages the API renders itself. Google Analytics is the only
// third party; fonts come from Google Fonts like the landing page's do.
const siteCSP = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; " +
	"object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func siteHeaders(w http.ResponseWriter, maxAge int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", siteCSP)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
}

type pageData struct {
	Settings    SiteSettings
	Title       string
	Description string
	Canonical   string
	Article     *Article
	Body        template.HTML
	Published   string
	Articles    []Article
	NotFound    bool
}

func (s *Service) render(w http.ResponseWriter, status int, data pageData) {
	var buf bytes.Buffer
	if err := siteTemplate.Execute(&buf, data); err != nil {
		s.log.Warn("site: render failed", "error", err)
		http.Error(w, "Halaman tidak dapat ditampilkan.", http.StatusInternalServerError)
		return
	}
	siteHeaders(w, 300)
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

func (s *Service) siteSettings(ctx context.Context) SiteSettings {
	settings, err := s.GetSiteSettings(ctx)
	if err != nil {
		s.log.Warn("site: settings unavailable, using defaults", "error", err)
		return defaultSettings()
	}
	return settings
}

func (s *Service) blogIndex(w http.ResponseWriter, r *http.Request) {
	settings := s.siteSettings(r.Context())
	var articles []Article
	if err := s.tx(r.Context(), func(tx pgx.Tx) error {
		var err error
		articles, err = s.repo.PublishedArticles(r.Context(), tx)
		return err
	}); err != nil {
		http.Error(w, "Artikel tidak dapat dimuat.", http.StatusInternalServerError)
		return
	}
	s.render(w, http.StatusOK, pageData{Settings: settings, Title: "Artikel — " + settings.SiteName, Description: settings.SiteDescription,
		Canonical: settings.SiteURL + "/blog", Articles: articles})
}

func (s *Service) blogArticle(w http.ResponseWriter, r *http.Request, slug string) {
	settings := s.siteSettings(r.Context())
	var article *Article
	if err := s.tx(r.Context(), func(tx pgx.Tx) error {
		var err error
		article, err = s.repo.PublishedArticleBySlug(r.Context(), tx, slug)
		return err
	}); err != nil {
		http.Error(w, "Artikel tidak dapat dimuat.", http.StatusInternalServerError)
		return
	}
	if article == nil {
		s.render(w, http.StatusNotFound, pageData{Settings: settings, Title: "Artikel tidak ditemukan — " + settings.SiteName, NotFound: true})
		return
	}
	body, err := RenderMarkdown(article.BodyMarkdown)
	if err != nil {
		http.Error(w, "Artikel tidak dapat ditampilkan.", http.StatusInternalServerError)
		return
	}
	title := db.StrOr(article.SEOTitle, article.Title)
	s.render(w, http.StatusOK, pageData{Settings: settings, Title: title + " — " + settings.SiteName, Description: db.StrOr(article.Excerpt, settings.SiteDescription),
		Canonical: settings.SiteURL + "/blog/" + article.Slug, Article: article, Body: template.HTML(body), Published: humanDate(article.PublishedAt)})
}

type urlset struct {
	XMLName xml.Name `xml:"urlset"`
	XMLNS   string   `xml:"xmlns,attr"`
	URLs    []struct {
		Loc     string `xml:"loc"`
		LastMod string `xml:"lastmod,omitempty"`
	} `xml:"url"`
}

func (s *Service) sitemap(w http.ResponseWriter, r *http.Request) {
	settings := s.siteSettings(r.Context())
	var articles []Article
	if err := s.tx(r.Context(), func(tx pgx.Tx) error {
		var err error
		articles, err = s.repo.PublishedArticles(r.Context(), tx)
		return err
	}); err != nil {
		http.Error(w, "sitemap unavailable", http.StatusInternalServerError)
		return
	}
	set := urlset{XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	add := func(loc, lastmod string) {
		set.URLs = append(set.URLs, struct {
			Loc     string `xml:"loc"`
			LastMod string `xml:"lastmod,omitempty"`
		}{loc, lastmod})
	}
	add(settings.SiteURL+"/", "")
	if len(articles) > 0 {
		add(settings.SiteURL+"/blog", articles[0].UpdatedAt[:10])
	}
	for _, a := range articles {
		add(settings.SiteURL+"/blog/"+a.Slug, a.UpdatedAt[:10])
	}
	out, err := xml.MarshalIndent(set, "", "  ")
	if err != nil {
		http.Error(w, "sitemap unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=600")
	_, _ = w.Write([]byte(xml.Header))
	_, _ = w.Write(out)
}

func (s *Service) robots(w http.ResponseWriter, r *http.Request) {
	settings := s.siteSettings(r.Context())
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	fmt.Fprintf(w, "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /site/\n\nSitemap: %s/sitemap.xml\n", settings.SiteURL)
}

var verificationFilePattern = regexp.MustCompile(`^google[0-9a-f]+\.html$`)

func (s *Service) verificationFile(w http.ResponseWriter, r *http.Request, file string) {
	settings := s.siteSettings(r.Context())
	if !verificationFilePattern.MatchString(file) || settings.SearchConsoleFile == "" || file != settings.SearchConsoleFile {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	fmt.Fprintf(w, "google-site-verification: %s", file)
}

var indonesianMonths = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}

func humanDate(iso *string) string {
	if iso == nil {
		return ""
	}
	t, err := time.Parse(time.RFC3339, *iso)
	if err != nil {
		return strings.SplitN(*iso, "T", 2)[0]
	}
	t = t.In(time.FixedZone("WIB", 7*3600))
	return fmt.Sprintf("%d %s %d", t.Day(), indonesianMonths[t.Month()-1], t.Year())
}

// One template for the index, an article and the 404, so the three cannot
// drift apart. Brand values mirror packages/ui/src/fv/palette.css.
var siteTemplate = template.Must(template.New("site").Funcs(template.FuncMap{"date": humanDate, "deref": func(p *string) string { return db.StrOr(p, "") }}).Parse(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
{{if .Description}}<meta name="description" content="{{.Description}}">{{end}}
{{if .Canonical}}<link rel="canonical" href="{{.Canonical}}">{{end}}
{{if .Settings.SearchConsoleToken}}<meta name="google-site-verification" content="{{.Settings.SearchConsoleToken}}">{{end}}
<meta property="og:site_name" content="{{.Settings.SiteName}}">
<meta property="og:title" content="{{.Title}}">
{{if .Description}}<meta property="og:description" content="{{.Description}}">{{end}}
{{if .Canonical}}<meta property="og:url" content="{{.Canonical}}">{{end}}
{{if .Article}}<meta property="og:type" content="article">{{if .Article.CoverImageURL}}<meta property="og:image" content="{{deref .Article.CoverImageURL}}">{{end}}{{else}}<meta property="og:type" content="website">{{end}}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
{{if .Settings.GAMeasurementID}}<script async src="https://www.googletagmanager.com/gtag/js?id={{.Settings.GAMeasurementID}}"></script><script src="/site/gtag.js"></script>{{end}}
<style>
:root{--navy:#071326;--blue:#2454C3;--ink:#050505;--page:#F7F8FA;--steel:#8A93A3;--border:#DCE0E6;--surface:#FFFFFF}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--page);color:var(--ink);line-height:1.65}
a{color:var(--blue)}header{background:var(--navy);color:#fff}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
header a{color:#fff;text-decoration:none;font-weight:700}header .cta{background:var(--blue);padding:8px 14px;border-radius:999px;font-size:14px}
.wrap{max-width:820px;margin:0 auto;padding:16px}main{padding:32px 0 64px}
.eyebrow{color:var(--blue);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(28px,5vw,40px);line-height:1.15;letter-spacing:-.02em;margin:8px 0 12px;color:var(--navy)}
.meta{color:var(--steel);font-size:14px;margin-bottom:24px}.cover{width:100%;border-radius:16px;margin:8px 0 24px;border:1px solid var(--border)}
article{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:clamp(20px,4vw,40px)}
article img{max-width:100%;height:auto;border-radius:12px}article pre{overflow:auto;background:var(--page);padding:12px;border-radius:8px}
article table{border-collapse:collapse;width:100%}article th,article td{border:1px solid var(--border);padding:8px;text-align:left}
article blockquote{margin:0;padding:8px 16px;border-left:3px solid var(--blue);color:#5A626E}
.list{display:grid;gap:16px}.card{display:block;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;text-decoration:none;color:inherit}
.card h2{margin:0 0 6px;font-size:20px;color:var(--navy)}.card p{margin:0;color:#5A626E}.card .meta{margin:8px 0 0}
footer{color:var(--steel);font-size:13px;border-top:1px solid var(--border)}
.wa{position:fixed;right:16px;bottom:16px;display:inline-flex;align-items:center;gap:10px;padding:12px 18px 12px 14px;border-radius:999px;background:#1E7A48;color:#fff;font-weight:700;font-size:14px;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:50}
.wa svg{width:22px;height:22px;fill:#fff}@media (max-width:480px){.wa span{display:none}.wa{padding:14px}}
</style>
</head>
<body>
<header><div class="wrap"><a href="/">{{.Settings.SiteName}}</a><nav><a href="/blog" style="margin-right:16px">Artikel</a><a class="cta" href="/#trial">Coba Gratis</a></nav></div></header>
<main><div class="wrap">
{{if .NotFound}}
<div class="eyebrow">404</div><h1>Artikel tidak ditemukan</h1><p>Artikel yang Anda cari tidak ada atau sudah ditarik. <a href="/blog">Lihat semua artikel</a>.</p>
{{else if .Article}}
<div class="eyebrow">Artikel</div>
<h1>{{.Article.Title}}</h1>
<div class="meta">{{if .Article.AuthorName}}{{deref .Article.AuthorName}} · {{end}}{{.Published}}</div>
{{if .Article.CoverImageURL}}<img class="cover" src="{{deref .Article.CoverImageURL}}" alt="">{{end}}
<article>{{.Body}}</article>
<p style="margin-top:32px"><a href="/blog">← Semua artikel</a></p>
{{else}}
<div class="eyebrow">Artikel</div>
<h1>Catatan dari lantai produksi</h1>
<p class="meta">Tulisan tim {{.Settings.SiteName}} tentang OEE, eksekusi produksi, mutu, dan cara pabrik menengah mendigitalkan lantai produksinya.</p>
<div class="list">
{{range .Articles}}<a class="card" href="/blog/{{.Slug}}"><h2>{{.Title}}</h2>{{if .Excerpt}}<p>{{deref .Excerpt}}</p>{{end}}<div class="meta">{{if .AuthorName}}{{deref .AuthorName}} · {{end}}{{date .PublishedAt}}</div></a>
{{else}}<p>Belum ada artikel yang terbit.</p>{{end}}
</div>
{{end}}
</div></main>
<footer><div class="wrap">© {{.Settings.SiteName}} · <a href="/">Beranda</a> · <a href="/sitemap.xml">Sitemap</a></div></footer>
{{if .Settings.WhatsAppNumber}}<a class="wa" href="https://wa.me/{{.Settings.WhatsAppNumber}}?text={{urlquery "Halo tim Factory Vision, saya ingin bertanya tentang Factory Vision."}}" target="_blank" rel="noopener noreferrer" aria-label="{{.Settings.WhatsAppLabel}} via WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg><span>{{.Settings.WhatsAppLabel}}</span></a>{{end}}
</body>
</html>`))
