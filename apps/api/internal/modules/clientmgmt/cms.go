package clientmgmt

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	goldhtml "github.com/yuin/goldmark/renderer/html"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// The marketing site's CMS (migration 038): settings the landing page reads
// at load, and articles the API renders as public pages. Edited from the
// internal console, published under /blog by site.go.

// --- Settings ---------------------------------------------------------

// SiteSettings is the TypeScript SiteSettings. Every field is a string; an
// empty one means "not configured", and the public page treats it so.
type SiteSettings struct {
	SiteName        string `json:"siteName"`
	SiteURL         string `json:"siteUrl"`
	SiteDescription string `json:"siteDescription"`
	// GA4 measurement id, G-XXXXXXXXXX. Empty disables the tag entirely.
	GAMeasurementID string `json:"gaMeasurementId"`
	// The content of Search Console's <meta name="google-site-verification">.
	SearchConsoleToken string `json:"searchConsoleToken"`
	// The name of Search Console's HTML-file verification, googleXXXX.html,
	// served at the site root by site.go.
	SearchConsoleFile string `json:"searchConsoleFile"`
	// The floating WhatsApp button on the landing page: an international
	// number without "+" (6281…), and the label beside the icon. An empty
	// number hides the button.
	WhatsAppNumber string `json:"whatsappNumber"`
	WhatsAppLabel  string `json:"whatsappLabel"`
	UpdatedAt      string `json:"updatedAt"`
	UpdatedBy      string `json:"updatedBy"`
}

// The keys as stored. Kept in one place so the read and the write agree.
var settingKeys = map[string]func(*SiteSettings) *string{
	"site_name":            func(s *SiteSettings) *string { return &s.SiteName },
	"site_url":             func(s *SiteSettings) *string { return &s.SiteURL },
	"site_description":     func(s *SiteSettings) *string { return &s.SiteDescription },
	"ga_measurement_id":    func(s *SiteSettings) *string { return &s.GAMeasurementID },
	"search_console_token": func(s *SiteSettings) *string { return &s.SearchConsoleToken },
	"search_console_file":  func(s *SiteSettings) *string { return &s.SearchConsoleFile },
	"whatsapp_number":      func(s *SiteSettings) *string { return &s.WhatsAppNumber },
	"whatsapp_label":       func(s *SiteSettings) *string { return &s.WhatsAppLabel },
}

func defaultSettings() SiteSettings {
	return SiteSettings{SiteName: "Factory Vision", SiteURL: "https://factoryvision.id",
		SiteDescription: "Manufacturing Execution System untuk manufaktur menengah Indonesia.",
		WhatsAppNumber:  "6281382258620", WhatsAppLabel: "Ask our Team"}
}

func (Repository) SiteSettings(ctx context.Context, tx pgx.Tx) (SiteSettings, error) {
	out := defaultSettings()
	rows, err := tx.Query(ctx, `SELECT key, value, updated_by, updated_at FROM site_setting`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var latest time.Time
	for rows.Next() {
		var key, value string
		var by *string
		var at time.Time
		if err := rows.Scan(&key, &value, &by, &at); err != nil {
			return out, err
		}
		if set, ok := settingKeys[key]; ok {
			*set(&out) = value
		}
		if at.After(latest) {
			latest = at
			out.UpdatedAt, out.UpdatedBy = db.ISO(at), db.StrOr(by, "")
		}
	}
	return out, rows.Err()
}

func (Repository) PutSiteSetting(ctx context.Context, tx pgx.Tx, key, value, by string) error {
	_, err := tx.Exec(ctx, `INSERT INTO site_setting (key, value, updated_by, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`, key, value, by)
	return err
}

var (
	gaIDPattern    = regexp.MustCompile(`^G-[A-Z0-9]{4,16}$`)
	scFilePattern  = regexp.MustCompile(`^google[0-9a-f]{8,32}\.html$`)
	scTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
	waNumberStrip  = regexp.MustCompile(`[^0-9]`)
	waNumberOK     = regexp.MustCompile(`^[1-9][0-9]{7,15}$`)
)

// NormalizeWhatsApp turns what people type (081382258620, +62 813-8225-8620)
// into the digits wa.me wants: an Indonesian leading 0 becomes 62.
func NormalizeWhatsApp(s string) string {
	d := waNumberStrip.ReplaceAllString(s, "")
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	return d
}

// GetSiteSettings reads the settings for the console.
func (s *Service) GetSiteSettings(ctx context.Context) (SiteSettings, error) {
	var out SiteSettings
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.SiteSettings(ctx, tx)
		return err
	})
	return out, err
}

// UpdateSiteSettings writes every key and records the change. Formats are
// checked here because a mistyped measurement id fails silently on the
// public page, where nobody would notice for weeks.
func (s *Service) UpdateSiteSettings(ctx context.Context, in SiteSettings, actor Actor) (SiteSettings, error) {
	in.SiteName, in.SiteURL, in.SiteDescription = strings.TrimSpace(in.SiteName), strings.TrimRight(strings.TrimSpace(in.SiteURL), "/"), strings.TrimSpace(in.SiteDescription)
	in.GAMeasurementID, in.SearchConsoleToken, in.SearchConsoleFile = strings.ToUpper(strings.TrimSpace(in.GAMeasurementID)), strings.TrimSpace(in.SearchConsoleToken), strings.ToLower(strings.TrimSpace(in.SearchConsoleFile))
	var fields []httpx.FieldError
	if in.SiteName == "" {
		fields = append(fields, httpx.FieldError{Field: "siteName", Code: "REQUIRED", Message: "Nama situs wajib diisi."})
	}
	if in.SiteURL != "" && !strings.HasPrefix(in.SiteURL, "https://") && !strings.HasPrefix(in.SiteURL, "http://") {
		fields = append(fields, httpx.FieldError{Field: "siteUrl", Code: "INVALID_FORMAT", Message: "URL situs harus diawali https://."})
	}
	if in.GAMeasurementID != "" && !gaIDPattern.MatchString(in.GAMeasurementID) {
		fields = append(fields, httpx.FieldError{Field: "gaMeasurementId", Code: "INVALID_FORMAT", Message: "Measurement ID GA4 berbentuk G-XXXXXXXXXX."})
	}
	if in.SearchConsoleToken != "" && !scTokenPattern.MatchString(in.SearchConsoleToken) {
		fields = append(fields, httpx.FieldError{Field: "searchConsoleToken", Code: "INVALID_FORMAT", Message: "Isi hanya nilai content dari meta tag google-site-verification."})
	}
	if in.SearchConsoleFile != "" && !scFilePattern.MatchString(in.SearchConsoleFile) {
		fields = append(fields, httpx.FieldError{Field: "searchConsoleFile", Code: "INVALID_FORMAT", Message: "Nama file verifikasi berbentuk google1234abcd.html."})
	}
	in.WhatsAppNumber, in.WhatsAppLabel = NormalizeWhatsApp(in.WhatsAppNumber), strings.TrimSpace(in.WhatsAppLabel)
	if in.WhatsAppNumber != "" && !waNumberOK.MatchString(in.WhatsAppNumber) {
		fields = append(fields, httpx.FieldError{Field: "whatsappNumber", Code: "INVALID_FORMAT", Message: "Nomor WhatsApp dengan kode negara, misalnya 6281382258620."})
	}
	if in.WhatsAppNumber != "" && in.WhatsAppLabel == "" {
		in.WhatsAppLabel = "Ask our Team"
	}
	if len(fields) > 0 {
		return SiteSettings{}, httpx.Validation("Periksa kembali pengaturan situs.", fields...)
	}
	var out SiteSettings
	err := s.tx(ctx, func(tx pgx.Tx) error {
		before, err := s.repo.SiteSettings(ctx, tx)
		if err != nil {
			return err
		}
		for key, get := range settingKeys {
			if err := s.repo.PutSiteSetting(ctx, tx, key, *get(&in), actor.Email); err != nil {
				return err
			}
		}
		out, err = s.repo.SiteSettings(ctx, tx)
		if err != nil {
			return err
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "SITE_SETTINGS_UPDATED", EntityType: "site_setting", IP: actor.IP,
			PreviousValue: before, NewValue: out})
	})
	return out, err
}

// --- Articles ---------------------------------------------------------

// Article is the TypeScript CmsArticle.
type Article struct {
	ID            string  `json:"id"`
	Slug          string  `json:"slug"`
	Title         string  `json:"title"`
	Excerpt       *string `json:"excerpt"`
	CoverImageURL *string `json:"coverImageUrl"`
	BodyMarkdown  string  `json:"bodyMarkdown"`
	Status        string  `json:"status"`
	AuthorName    *string `json:"authorName"`
	SEOTitle      *string `json:"seoTitle"`
	PublishedAt   *string `json:"publishedAt"`
	CreatedBy     string  `json:"createdBy"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedBy     *string `json:"updatedBy"`
	UpdatedAt     string  `json:"updatedAt"`
}

const articleColumns = `id, slug, title, excerpt, cover_image_url, body_markdown, status, author_name, seo_title, published_at, created_by, created_at, updated_by, updated_at`

func scanArticle(row pgx.Row) (Article, error) {
	var a Article
	var published *time.Time
	var created, updated time.Time
	if err := row.Scan(&a.ID, &a.Slug, &a.Title, &a.Excerpt, &a.CoverImageURL, &a.BodyMarkdown, &a.Status, &a.AuthorName, &a.SEOTitle, &published, &a.CreatedBy, &created, &a.UpdatedBy, &updated); err != nil {
		return Article{}, err
	}
	a.PublishedAt, a.CreatedAt, a.UpdatedAt = db.ISOPtr(published), db.ISO(created), db.ISO(updated)
	return a, nil
}

func collectArticles(rows pgx.Rows, err error) ([]Article, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Article{}
	for rows.Next() {
		a, err := scanArticle(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Articles lists everything for the console, newest edit first.
func (Repository) Articles(ctx context.Context, tx pgx.Tx) ([]Article, error) {
	rows, err := tx.Query(ctx, `SELECT `+articleColumns+` FROM cms_article ORDER BY updated_at DESC`)
	return collectArticles(rows, err)
}

// PublishedArticles is what the public index and the sitemap show.
func (Repository) PublishedArticles(ctx context.Context, tx pgx.Tx) ([]Article, error) {
	rows, err := tx.Query(ctx, `SELECT `+articleColumns+` FROM cms_article WHERE status = 'PUBLISHED' ORDER BY published_at DESC`)
	return collectArticles(rows, err)
}

func (Repository) ArticleByID(ctx context.Context, tx pgx.Tx, id string) (*Article, error) {
	a, err := scanArticle(tx.QueryRow(ctx, `SELECT `+articleColumns+` FROM cms_article WHERE id = $1`, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// PublishedArticleBySlug is the public page lookup: drafts do not exist to it.
func (Repository) PublishedArticleBySlug(ctx context.Context, tx pgx.Tx, slug string) (*Article, error) {
	a, err := scanArticle(tx.QueryRow(ctx, `SELECT `+articleColumns+` FROM cms_article WHERE slug = $1 AND status = 'PUBLISHED'`, slug))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (Repository) InsertArticle(ctx context.Context, tx pgx.Tx, a Article) (Article, error) {
	return scanArticle(tx.QueryRow(ctx, `INSERT INTO cms_article (id, slug, title, excerpt, cover_image_url, body_markdown, status, author_name, seo_title, created_by, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$9) RETURNING `+articleColumns,
		a.ID, a.Slug, a.Title, a.Excerpt, a.CoverImageURL, a.BodyMarkdown, a.AuthorName, a.SEOTitle, a.CreatedBy))
}

func (Repository) UpdateArticle(ctx context.Context, tx pgx.Tx, a Article, by string) (Article, error) {
	return scanArticle(tx.QueryRow(ctx, `UPDATE cms_article SET slug = $2, title = $3, excerpt = $4, cover_image_url = $5, body_markdown = $6, author_name = $7, seo_title = $8,
		updated_by = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING `+articleColumns,
		a.ID, a.Slug, a.Title, a.Excerpt, a.CoverImageURL, a.BodyMarkdown, a.AuthorName, a.SEOTitle, by))
}

// SetArticleStatus moves an article between DRAFT, PUBLISHED and ARCHIVED.
// The first publication stamps published_at; a later re-publish keeps it,
// so the article's URL and its place in the index do not jump around.
func (Repository) SetArticleStatus(ctx context.Context, tx pgx.Tx, id, status, by string) (Article, error) {
	return scanArticle(tx.QueryRow(ctx, `UPDATE cms_article SET status = $2::varchar,
		published_at = CASE WHEN $2::varchar = 'PUBLISHED' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END,
		updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING `+articleColumns, id, status, by))
}

func (Repository) DeleteArticle(ctx context.Context, tx pgx.Tx, id string) (bool, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM cms_article WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

// ArticleInput is what the console sends on create and update.
type ArticleInput struct {
	Title, Slug, BodyMarkdown                    string
	Excerpt, CoverImageURL, AuthorName, SEOTitle *string
}

var slugStrip = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify makes a URL path segment out of a title: lower-case ASCII words
// joined by dashes, at most 120 characters.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugStrip.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 120 {
		s = strings.Trim(s[:120], "-")
	}
	return s
}

func (in *ArticleInput) normalise() error {
	in.Title = strings.TrimSpace(in.Title)
	if len(in.Title) < 3 {
		return httpx.Validation("Judul artikel minimal 3 karakter.", httpx.FieldError{Field: "title", Code: "TOO_SHORT", Message: "Tuliskan judul artikel."})
	}
	in.Slug = Slugify(in.Slug)
	if in.Slug == "" {
		in.Slug = Slugify(in.Title)
	}
	if in.Slug == "" {
		return httpx.Validation("Slug tidak dapat dibentuk dari judul; isi slug secara manual.", httpx.FieldError{Field: "slug", Code: "INVALID_FORMAT", Message: "Gunakan huruf, angka, dan tanda hubung."})
	}
	trim := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := strings.TrimSpace(*p)
		if v == "" {
			return nil
		}
		return &v
	}
	in.Excerpt, in.CoverImageURL, in.AuthorName, in.SEOTitle = trim(in.Excerpt), trim(in.CoverImageURL), trim(in.AuthorName), trim(in.SEOTitle)
	if in.CoverImageURL != nil && !strings.HasPrefix(*in.CoverImageURL, "https://") && !strings.HasPrefix(*in.CoverImageURL, "/") {
		return httpx.Validation("URL gambar sampul harus https:// atau path di situs ini.", httpx.FieldError{Field: "coverImageUrl", Code: "INVALID_FORMAT", Message: "Gunakan URL https:// atau path /assets/…"})
	}
	return nil
}

func slugConflict(err error) error {
	if db.IsUniqueViolation(err) {
		return httpx.Conflict("Slug tersebut sudah dipakai artikel lain.")
	}
	return err
}

// Articles lists every article for the console.
func (s *Service) Articles(ctx context.Context) ([]Article, error) {
	var out []Article
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.Articles(ctx, tx)
		return err
	})
	return out, err
}

// ArticleByID reads one article for the editor.
func (s *Service) ArticleByID(ctx context.Context, id string) (Article, error) {
	var out Article
	err := s.tx(ctx, func(tx pgx.Tx) error {
		a, err := s.repo.ArticleByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if a == nil {
			return httpx.NotFound("Artikel tidak ditemukan.")
		}
		out = *a
		return nil
	})
	return out, err
}

// CreateArticle writes a draft.
func (s *Service) CreateArticle(ctx context.Context, in ArticleInput, actor Actor) (Article, error) {
	if err := in.normalise(); err != nil {
		return Article{}, err
	}
	var out Article
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.InsertArticle(ctx, tx, Article{ID: newID("art"), Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt, CoverImageURL: in.CoverImageURL,
			BodyMarkdown: in.BodyMarkdown, AuthorName: in.AuthorName, SEOTitle: in.SEOTitle, CreatedBy: actor.Email})
		if err != nil {
			return slugConflict(err)
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "ARTICLE_CREATED", EntityType: "cms_article", EntityID: &out.ID, IP: actor.IP,
			NewValue: map[string]any{"slug": out.Slug, "title": out.Title}})
	})
	return out, err
}

// UpdateArticle rewrites the content; status is changed through
// SetArticleStatus so a save never publishes by accident.
func (s *Service) UpdateArticle(ctx context.Context, id string, in ArticleInput, actor Actor) (Article, error) {
	if err := in.normalise(); err != nil {
		return Article{}, err
	}
	var out Article
	err := s.tx(ctx, func(tx pgx.Tx) error {
		before, err := s.repo.ArticleByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Artikel tidak ditemukan.")
		}
		if before.Status == "PUBLISHED" && before.Slug != in.Slug {
			// A published URL is a promise: Search Console has it, readers
			// have shared it. Unpublish first if the slug really must change.
			return httpx.InvalidState("Slug artikel yang sudah terbit tidak dapat diubah. Tarik dari publikasi dulu.")
		}
		out, err = s.repo.UpdateArticle(ctx, tx, Article{ID: id, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt, CoverImageURL: in.CoverImageURL,
			BodyMarkdown: in.BodyMarkdown, AuthorName: in.AuthorName, SEOTitle: in.SEOTitle}, actor.Email)
		if err != nil {
			return slugConflict(err)
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "ARTICLE_UPDATED", EntityType: "cms_article", EntityID: &id, IP: actor.IP,
			PreviousValue: map[string]any{"slug": before.Slug, "title": before.Title}, NewValue: map[string]any{"slug": out.Slug, "title": out.Title}})
	})
	return out, err
}

// SetArticleStatus publishes, unpublishes or archives an article.
func (s *Service) SetArticleStatus(ctx context.Context, id, status string, actor Actor) (Article, error) {
	switch status {
	case "DRAFT", "PUBLISHED", "ARCHIVED":
	default:
		return Article{}, httpx.Validation("Status artikel tidak dikenal.")
	}
	var out Article
	err := s.tx(ctx, func(tx pgx.Tx) error {
		before, err := s.repo.ArticleByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Artikel tidak ditemukan.")
		}
		if status == "PUBLISHED" && strings.TrimSpace(before.BodyMarkdown) == "" {
			return httpx.InvalidState("Artikel kosong tidak dapat diterbitkan.")
		}
		out, err = s.repo.SetArticleStatus(ctx, tx, id, status, actor.Email)
		if err != nil {
			return err
		}
		action := map[string]string{"PUBLISHED": "ARTICLE_PUBLISHED", "DRAFT": "ARTICLE_UNPUBLISHED", "ARCHIVED": "ARTICLE_ARCHIVED"}[status]
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: action, EntityType: "cms_article", EntityID: &id, IP: actor.IP,
			PreviousValue: map[string]any{"status": before.Status}, NewValue: map[string]any{"status": out.Status, "slug": out.Slug}})
	})
	return out, err
}

// DeleteArticle removes a draft or archived article. A published one is
// unpublished first, deliberately, so a URL never vanishes by a mis-click.
func (s *Service) DeleteArticle(ctx context.Context, id string, actor Actor) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		before, err := s.repo.ArticleByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Artikel tidak ditemukan.")
		}
		if before.Status == "PUBLISHED" {
			return httpx.InvalidState("Tarik artikel dari publikasi sebelum menghapusnya.")
		}
		if _, err := s.repo.DeleteArticle(ctx, tx, id); err != nil {
			return err
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "ARTICLE_DELETED", EntityType: "cms_article", EntityID: &id, IP: actor.IP,
			PreviousValue: map[string]any{"slug": before.Slug, "title": before.Title}})
	})
}

// --- Rendering --------------------------------------------------------

// markdown renders CommonMark plus tables, strikethrough and autolinks.
// Raw HTML in the source is dropped: authors are staff, but an article is
// still the one place where pasted content reaches a public page.
var markdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM, extension.Typographer),
	goldmark.WithRendererOptions(goldhtml.WithHardWraps()),
)

// RenderMarkdown converts an article body to HTML.
func RenderMarkdown(src string) (string, error) {
	var buf bytes.Buffer
	if err := markdown.Convert([]byte(src), &buf); err != nil {
		return "", err
	}
	return buf.String(), nil
}
