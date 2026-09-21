-- The marketing site's CMS: settings the landing page reads at load, and
-- articles the API renders as public HTML pages.
--
-- Both are vendor records edited from the internal console (no tenant, no
-- RLS), like referral_code. Settings are a key/value table because the set
-- is small and grows one key at a time (Google Analytics measurement id,
-- Search Console verification, site name); a column per key would mean a
-- migration per key.

CREATE TABLE IF NOT EXISTS site_setting (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Articles are written in Markdown and rendered on read. The slug is the
-- public URL (/blog/<slug>), so it is unique and never changes once the
-- article is published; the id is what the console edits by.
CREATE TABLE IF NOT EXISTS cms_article (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(160) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  -- Shown in the index and used as the meta description.
  excerpt TEXT,
  cover_image_url TEXT,
  body_markdown TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  author_name VARCHAR(255),
  seo_title VARCHAR(255),
  published_at TIMESTAMP WITH TIME ZONE,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cms_article_published
  ON cms_article (published_at DESC) WHERE status = 'PUBLISHED';
